/**
 * Stream-parse local Geofabrik PBF for state / provincial park candidates.
 * No Overpass — local osm-pbf/geofabrik/*.osm.pbf only.
 */
import { createReadStream } from "fs";
import { pipeline } from "stream/promises";
import { Writable } from "stream";
import fs from "fs";
import path from "path";
import { pbfFilePath } from "./poi-osm-pbf-config.mjs";
import { pbfFingerprint, writeManifest } from "./fuel-cache-lib.mjs";
import { fileSizeMb } from "./poi-osm-pbf-lib.mjs";
import {
  createProgressTicker,
  formatDuration,
  log,
  logSection,
} from "./pipeline-log.mjs";
import {
  INGEST_DIR,
  coordValid,
  osmRecordFromElement,
  writeJson,
} from "./state-parks-lib.mjs";

const EXTRACT_DIR = path.join(INGEST_DIR, "00-pbf");
const PROGRESS_INTERVAL_MS = 10000;

function isParkFeatureCandidate(tags) {
  if (!tags) return false;
  if (tags.boundary === "protected_area") return true;
  if (tags.leisure === "nature_reserve") return true;
  return false;
}

function wayCentroid(refs, nodeCoords) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const id of refs || []) {
    const c = nodeCoords.get(id);
    if (!c) continue;
    sx += c.lon;
    sy += c.lat;
    n += 1;
  }
  if (!n) return null;
  return { lat: sy / n, lon: sx / n };
}

function relationCentroid(members, wayRefs, nodeCoords) {
  const ways =
    members?.filter((m) => m.type === "way" && (m.role === "outer" || m.role === "" || !m.role)) ||
    [];
  const pool = ways.length ? ways : members?.filter((m) => m.type === "way") || [];
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const m of pool) {
    const refs = wayRefs.get(m.ref);
    if (!refs) continue;
    for (const id of refs) {
      const c = nodeCoords.get(id);
      if (!c) continue;
      sx += c.lon;
      sy += c.lat;
      n += 1;
    }
  }
  if (!n) return null;
  return { lat: sy / n, lon: sx / n };
}

async function loadParser() {
  log("Loading osm-pbf-parser...");
  const mod = await import("osm-pbf-parser");
  log("Parser ready");
  return mod.default || mod;
}

function attachByteProgress(readStream, pbfPath, ticker) {
  const totalBytes = fs.statSync(pbfPath).size;
  let bytesRead = 0;
  readStream.on("data", (chunk) => {
    bytesRead += chunk.length;
    ticker.setBytes(bytesRead, totalBytes);
  });
  return { totalBytes, getBytesRead: () => bytesRead };
}

function makePassTicker(label, startedAt, extraStats) {
  let bytesRead = 0;
  let totalBytes = 0;
  let blocks = 0;

  const ticker = createProgressTicker({
    intervalMs: PROGRESS_INTERVAL_MS,
    onTick: () => {
      const elapsed = formatDuration(Date.now() - startedAt);
      const pct = totalBytes ? Math.min(100, Math.round((bytesRead / totalBytes) * 100)) : 0;
      const readMb = Math.round((bytesRead / (1024 * 1024)) * 10) / 10;
      const totalMb = Math.round((totalBytes / (1024 * 1024)) * 10) / 10;
      const extra = extraStats();
      return `${label}: ${pct}% (${readMb}/${totalMb} MB), ${blocks.toLocaleString()} OSM blocks, ${elapsed} elapsed${extra ? `, ${extra}` : ""}`;
    },
  });

  return {
    ticker,
    setBytes(read, total) {
      bytesRead = read;
      totalBytes = total;
    },
    bumpBlock() {
      blocks += 1;
    },
    get blocks() {
      return blocks;
    },
  };
}

async function runParserPass({ pbfPath, parser, label, passIndex, passTotal, writeFn, extraStats = () => "" }) {
  logSection(`${label} (pass ${passIndex}/${passTotal})`);
  const startedAt = Date.now();
  const pass = makePassTicker(label, startedAt, extraStats);
  pass.ticker.start();
  log(`${label}: starting pass ${passIndex}/${passTotal}...`);

  const readStream = createReadStream(pbfPath);
  attachByteProgress(readStream, pbfPath, pass);

  await pipeline(
    readStream,
    parser(),
    new Writable({
      objectMode: true,
      write(chunks, _enc, cb) {
        try {
          pass.bumpBlock();
          writeFn(chunks, pass);
          cb();
        } catch (err) {
          cb(err);
        }
      },
    })
  );

  pass.ticker.finish(
    `${label} done in ${formatDuration(Date.now() - startedAt)} (${pass.blocks.toLocaleString()} blocks)`
  );
}

async function scanPbf(pbfPath, country) {
  const parser = await loadParser();
  const sizeMb = fileSizeMb(pbfPath);
  log(`Scanning ${path.basename(pbfPath)} (${sizeMb} MB) for ${country} state/provincial parks`);

  const nodes = [];
  const ways = [];
  const relations = [];
  const relationWayIds = new Set();
  const passTotal = 4;

  await runParserPass({
    pbfPath,
    parser,
    label: "Find park candidates",
    passIndex: 1,
    passTotal,
    writeFn(chunks, pass) {
      for (const item of chunks) {
        const tags = item.tags || {};
        if (!isParkFeatureCandidate(tags)) continue;
        if (item.type === "node") {
          nodes.push({ type: "node", id: item.id, tags, lat: item.lat, lon: item.lon });
        } else if (item.type === "way") {
          ways.push({ type: "way", id: item.id, tags, refs: item.refs || [] });
        } else if (item.type === "relation") {
          relations.push({ type: "relation", id: item.id, tags, members: item.members || [] });
          for (const m of item.members || []) {
            if (m.type === "way") relationWayIds.add(m.ref);
          }
        }
      }
    },
    extraStats: () =>
      `${nodes.length} nodes, ${ways.length} ways, ${relations.length} relations`,
  });

  log(
    `Pass 1 summary: ${nodes.length} nodes, ${ways.length} ways, ${relations.length} relations, ${relationWayIds.size} relation member ways`
  );

  const neededWayIds = new Set(ways.map((w) => w.id));
  for (const id of relationWayIds) neededWayIds.add(id);

  const neededNodeIds = new Set();
  for (const w of ways) {
    for (const id of w.refs) neededNodeIds.add(id);
  }

  const wayRefs = new Map();
  if (neededWayIds.size) {
    await runParserPass({
      pbfPath,
      parser,
      label: "Load way geometry",
      passIndex: 2,
      passTotal,
      writeFn(chunks, pass) {
        for (const item of chunks) {
          if (item.type !== "way" || !neededWayIds.has(item.id)) continue;
          wayRefs.set(item.id, item.refs || []);
          for (const id of item.refs || []) neededNodeIds.add(id);
        }
      },
      extraStats: () => `${wayRefs.size}/${neededWayIds.size} ways loaded`,
    });
    log(`Pass 2 summary: ${wayRefs.size} ways loaded, ${neededNodeIds.size} node refs needed`);
  } else {
    log("Pass 2 skipped (no ways needed)");
  }

  const nodeCoords = new Map();
  for (const n of nodes) nodeCoords.set(n.id, { lat: n.lat, lon: n.lon });

  const missingNodes = [...neededNodeIds].filter((id) => !nodeCoords.has(id));
  if (missingNodes.length) {
    const need = new Set(missingNodes);
    await runParserPass({
      pbfPath,
      parser,
      label: "Load node coordinates",
      passIndex: 3,
      passTotal,
      writeFn(chunks, pass) {
        for (const item of chunks) {
          if (item.type === "node" && need.has(item.id)) {
            nodeCoords.set(item.id, { lat: item.lat, lon: item.lon });
          }
        }
      },
      extraStats: () => `${nodeCoords.size}/${neededNodeIds.size} coords`,
    });
    log(`Pass 3 summary: ${nodeCoords.size} node coordinates (${missingNodes.length} were missing)`);
  } else {
    log("Pass 3 skipped (all node coords already known)");
  }

  logSection("Classify and dedupe candidates (pass 4/4)");
  const classifyStarted = Date.now();
  const records = [];
  const seen = new Set();

  function pushElement(el) {
    const key = `${el.type}/${el.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    const rec = osmRecordFromElement(el, country);
    if (!rec) return;
    if (!coordValid(rec.lat, rec.lon, country)) return;
    records.push(rec);
  }

  for (const n of nodes) pushElement(n);
  log(`  nodes → ${records.length} catalog units so far`);

  let wayAdded = 0;
  for (const w of ways) {
    const c = wayCentroid(w.refs.length ? w.refs : wayRefs.get(w.id), nodeCoords);
    if (!c) continue;
    const before = records.length;
    pushElement({ type: w.type, id: w.id, tags: w.tags, center: c });
    if (records.length > before) wayAdded += 1;
  }
  log(`  ways → +${wayAdded} units (${records.length} total)`);

  let relAdded = 0;
  for (const r of relations) {
    const c = relationCentroid(r.members, wayRefs, nodeCoords);
    if (!c) continue;
    const before = records.length;
    pushElement({ type: r.type, id: r.id, tags: r.tags, center: c });
    if (records.length > before) relAdded += 1;
  }
  log(`  relations → +${relAdded} units (${records.length} total)`);
  log(`Classification done in ${formatDuration(Date.now() - classifyStarted)}`);

  return {
    nodeCount: nodes.length,
    wayCount: ways.length,
    relationCount: relations.length,
    recordCount: records.length,
    records,
  };
}

export async function extractStateParksFromPbf(sourceKey, { force = false } = {}) {
  const country = sourceKey === "ca" ? "CA" : "US";
  const outPath = path.join(EXTRACT_DIR, `state-parks-${sourceKey}.json`);
  const manifestPath = path.join(EXTRACT_DIR, `manifest-${sourceKey}.json`);

  const pbf = pbfFilePath(sourceKey);
  if (!fs.existsSync(pbf)) {
    throw new Error(
      `Missing local PBF: ${pbf}\nDownload first: node build-poi-osm-download.mjs --source=${sourceKey}`
    );
  }

  const fp = pbfFingerprint(pbf);
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : null;

  if (
    !force &&
    fs.existsSync(outPath) &&
    manifest?.pbfFingerprint?.sizeBytes === fp.sizeBytes &&
    manifest?.pbfFingerprint?.mtimeMs === fp.mtimeMs
  ) {
    const cached = JSON.parse(fs.readFileSync(outPath, "utf8"));
    log(`Using cached extract (${cached.recordCount} records): ${outPath}`);
    log(`PBF unchanged (${fp.sizeMb} MB) — pass --refresh to rescan`);
    return cached;
  }

  logSection(`${country} state parks PBF extract (${sourceKey})`);
  log(`Input: ${pbf}`);
  log(`Output: ${outPath}`);
  if (force) log("Refresh requested — rescanning PBF");

  const started = Date.now();
  const result = await scanPbf(pbf, country);

  const payload = {
    generated: new Date().toISOString(),
    source: "osm-pbf",
    country,
    pbfPath: pbf,
    pbfFingerprint: fp,
    nodeCount: result.nodeCount,
    wayCount: result.wayCount,
    relationCount: result.relationCount,
    recordCount: result.recordCount,
    records: result.records,
  };

  log("Writing extract cache...");
  fs.mkdirSync(EXTRACT_DIR, { recursive: true });
  writeJson(outPath, payload);
  writeManifest(manifestPath, {
    generated: payload.generated,
    sourceKey,
    country,
    pbfPath: pbf,
    pbfFingerprint: fp,
    recordCount: payload.recordCount,
  });

  log(
    `Wrote ${outPath}: ${payload.recordCount} units (${result.nodeCount} nodes, ${result.wayCount} ways, ${result.relationCount} relations) in ${formatDuration(Date.now() - started)}`
  );
  return payload;
}

export async function extractAllStateParks({ force = false, source = "all" } = {}) {
  const keys = source === "all" ? ["us", "ca"] : [source];
  const out = {};
  logSection(`State parks PBF extract — ${keys.join(", ")}`);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    log(`Country ${i + 1}/${keys.length}: ${key.toUpperCase()}`);
    out[key] = await extractStateParksFromPbf(key, { force });
  }
  log("All PBF extracts complete");
  return out;
}

if (process.argv[1]?.endsWith("build-state-parks-extract-pbf.mjs")) {
  const force = process.argv.includes("--refresh") || process.argv.includes("--force");
  const sourceArg = process.argv.find((a) => a.startsWith("--source="));
  const source = sourceArg ? sourceArg.split("=")[1] : "all";
  log("build-state-parks-extract-pbf.mjs starting");
  await extractAllStateParks({ force, source });
}
