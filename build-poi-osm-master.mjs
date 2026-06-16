/**
 * Merge OSM ingest caches into master JSON for playgrounds / scenic viewpoints.
 * Usage: node build-poi-osm-master.mjs [--region=us|ca] [--kind=playground|viewpoint]
 */
import fs from "fs";
import path from "path";
import {
  POI_KINDS,
  ingestDir,
  masterPath,
  readJson,
  writeJson,
} from "./poi-osm-lib.mjs";

function parseArgs() {
  const out = { regions: ["us", "ca"], kinds: Object.keys(POI_KINDS) };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--region=")) out.regions = [arg.slice(9)];
    else if (arg.startsWith("--kind=")) out.kinds = [arg.slice(7)];
  }
  return out;
}

function loadRecords(region, kind) {
  const outDir = ingestDir(region, kind);
  const mergedPath = path.join(outDir, "merged.json");
  const merged = readJson(mergedPath);
  if (merged?.records?.length) return merged.records;

  const all = [];
  if (!fs.existsSync(outDir)) return all;
  for (const f of fs
    .readdirSync(outDir)
    .filter((n) => /^osm-[A-Z]{2}\.json$/.test(n))
    .sort()) {
    const j = readJson(path.join(outDir, f));
    if (j?.records?.length) all.push(...j.records);
  }
  if (!all.length) throw new Error(`No ${kind} ${region} ingest data — run build-poi-osm-ingest-${region}.mjs --kind=${kind}`);
  return all;
}

function dedupeByOsmId(records) {
  const out = [];
  const seen = new Set();
  for (const rec of records) {
    const key = rec.osm ? `${rec.osm.type}:${rec.osm.id}` : rec.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rec);
  }
  return out;
}

function buildMaster(region, kind) {
  const kindCfg = POI_KINDS[kind];
  const records = dedupeByOsmId(loadRecords(region, kind));
  const byState = {};
  for (const r of records) {
    const st = r.state || "?";
    byState[st] = (byState[st] || 0) + 1;
  }
  const payload = {
    generated: new Date().toISOString(),
    kind,
    region,
    recordCount: records.length,
    byState,
    records,
  };
  writeJson(masterPath(region, kind), payload);
  console.log(`Wrote ${kindCfg.masterBasename}-${region}-master.json (${records.length} records)`);
}

const args = parseArgs();
for (const region of args.regions) {
  for (const kind of args.kinds) {
    buildMaster(region, kind);
  }
}
