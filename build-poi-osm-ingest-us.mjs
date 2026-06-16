/**
 * Ingest US playgrounds and scenic viewpoints from OSM (per-state Overpass).
 * Usage: node build-poi-osm-ingest-us.mjs [--kind=playground|viewpoint] [--state=TX] [--refresh]
 */
import fs from "fs";
import path from "path";
import { STATE_BBOXES } from "./camping-us-state-bboxes.mjs";
import { OSM_SPLIT } from "./camping-us-osm-split-states.mjs";
import { US_STATES } from "./fuel-us-lib.mjs";
import {
  POI_KINDS,
  coordValidUs,
  elementsToRecords,
  ingestDir,
  overpassQuery,
  readJson,
  sleep,
  writeJson,
} from "./poi-osm-lib.mjs";

function parseArgs() {
  const out = { kinds: Object.keys(POI_KINDS), states: null, refresh: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--refresh") out.refresh = true;
    else if (arg.startsWith("--kind=")) out.kinds = [arg.slice(7)];
    else if (arg.startsWith("--state=")) out.states = [arg.slice(8).toUpperCase()];
  }
  return out;
}

async function ingestKind(kind, states, refresh) {
  const kindCfg = POI_KINDS[kind];
  const outDir = ingestDir("us", kind);
  const stateStats = {};

  for (const st of states) {
    const bboxes = OSM_SPLIT[st] || (STATE_BBOXES[st] ? [STATE_BBOXES[st]] : []);
    if (!bboxes.length) continue;
    const cachePath = path.join(outDir, `osm-${st}.json`);
    const cached = !refresh && readJson(cachePath);
    if (cached?.records?.length) {
      console.log(`${kindCfg.masterBasename} US ${st}: cache hit (${cached.records.length})`);
      stateStats[st] = { cached: true, count: cached.records.length };
      continue;
    }

    console.log(`${kindCfg.masterBasename} US ${st}: querying (${bboxes.length} bbox part(s))...`);
    let elements = [];
    let lastErr = null;
    for (let bi = 0; bi < bboxes.length; bi++) {
      const bbox = bboxes[bi];
      const label = bboxes.length > 1 ? `${st} part ${bi + 1}/${bboxes.length}` : st;
      try {
        const j = await overpassQuery(kindCfg.buildOverpassQuery(bbox));
        elements.push(...(j.elements || []));
        await sleep(4000);
      } catch (e) {
        lastErr = e.message;
        console.warn(`${kindCfg.masterBasename} US ${label}:`, e.message);
      }
    }

    if (!elements.length && lastErr) {
      const prev = readJson(cachePath);
      if (prev?.records?.length) {
        console.warn(`${kindCfg.masterBasename} US ${st}: fetch failed, keeping prior cache (${prev.records.length})`);
        stateStats[st] = { error: lastErr, count: prev.records.length, keptCache: true };
        await sleep(2000);
        continue;
      }
      writeJson(cachePath, { generated: new Date().toISOString(), state: st, error: lastErr, records: [] });
      stateStats[st] = { error: lastErr, count: 0 };
      await sleep(2000);
      continue;
    }

    const seen = new Set();
    const records = elementsToRecords(st, elements, kindCfg, "US", coordValidUs, seen, kind);
    writeJson(cachePath, {
      generated: new Date().toISOString(),
      state: st,
      elementCount: elements.length,
      recordCount: records.length,
      records,
    });
    stateStats[st] = { count: records.length, elements: elements.length };
    console.log(`${kindCfg.masterBasename} US ${st}: ${records.length} records (${elements.length} raw)`);
    await sleep(3000);
  }

  const allRecords = [];
  for (const f of fs.readdirSync(outDir).filter((n) => /^osm-[A-Z]{2}\.json$/.test(n)).sort()) {
    const j = readJson(path.join(outDir, f));
    if (j?.records?.length) allRecords.push(...j.records);
  }
  writeJson(path.join(outDir, "merged.json"), {
    generated: new Date().toISOString(),
    kind,
    region: "us",
    recordCount: allRecords.length,
    stateStats,
    records: allRecords,
  });
  console.log(`${kindCfg.masterBasename} US merged: ${allRecords.length} records`);
  return allRecords.length;
}

const args = parseArgs();
for (const kind of args.kinds) {
  if (!POI_KINDS[kind]) {
    console.error("Unknown kind:", kind);
    process.exit(1);
  }
}
const states = args.states || US_STATES;
for (const kind of args.kinds) {
  await ingestKind(kind, states, args.refresh);
}
