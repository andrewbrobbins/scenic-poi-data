/**
 * Ingest Canada playgrounds and scenic viewpoints from OSM (per-province Overpass).
 * Usage: node build-poi-osm-ingest-ca.mjs [--kind=playground|viewpoint] [--province=BC] [--refresh]
 */
import fs from "fs";
import path from "path";
import { PROVINCE_BBOXES, CA_PROVINCES } from "./camping-ca-province-bboxes.mjs";

/** Split large provinces so Overpass does not timeout. */
const OSM_SPLIT = {
  AB: [
    [49, -120, 54, -114],
    [49, -114, 54, -110],
    [54, -120, 60, -114],
    [54, -114, 60, -110],
  ],
  BC: [
    [48.3, -139, 52, -125],
    [48.3, -125, 52, -114],
    [52, -139, 56, -125],
    [52, -125, 56, -114],
    [56, -132, 60, -114],
  ],
  ON: [
    [41.5, -95.5, 49, -84],
    [41.5, -84, 49, -74],
    [49, -95.5, 57, -84],
    [49, -84, 57, -74],
  ],
};
import {
  POI_KINDS,
  coordValidCa,
  elementsToRecords,
  ingestDir,
  overpassQuery,
  readJson,
  sleep,
  writeJson,
} from "./poi-osm-lib.mjs";

function parseArgs() {
  const out = { kinds: Object.keys(POI_KINDS), provinces: null, refresh: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--refresh") out.refresh = true;
    else if (arg.startsWith("--kind=")) out.kinds = [arg.slice(7)];
    else if (arg.startsWith("--province=")) out.provinces = [arg.slice(11).toUpperCase()];
  }
  return out;
}

async function ingestKind(kind, provinces, refresh) {
  const kindCfg = POI_KINDS[kind];
  const outDir = ingestDir("ca", kind);
  const stateStats = {};

  for (const pr of provinces) {
    const bboxes = OSM_SPLIT[pr] || (PROVINCE_BBOXES[pr] ? [PROVINCE_BBOXES[pr]] : []);
    if (!bboxes.length) continue;
    const cachePath = path.join(outDir, `osm-${pr}.json`);
    const cached = !refresh && readJson(cachePath);
    if (cached?.records?.length) {
      console.log(`${kindCfg.masterBasename} CA ${pr}: cache hit (${cached.records.length})`);
      stateStats[pr] = { cached: true, count: cached.records.length };
      continue;
    }

    console.log(`${kindCfg.masterBasename} CA ${pr}: querying (${bboxes.length} bbox part(s))...`);
    let elements = [];
    let lastErr = null;
    for (let bi = 0; bi < bboxes.length; bi++) {
      const bbox = bboxes[bi];
      const label = bboxes.length > 1 ? `${pr} part ${bi + 1}/${bboxes.length}` : pr;
      try {
        const j = await overpassQuery(kindCfg.buildOverpassQuery(bbox));
        elements.push(...(j.elements || []));
        await sleep(4000);
      } catch (e) {
        lastErr = e.message;
        console.warn(`${kindCfg.masterBasename} CA ${label}:`, e.message);
      }
    }

    if (!elements.length && lastErr) {
      const prev = readJson(cachePath);
      if (prev?.records?.length) {
        console.warn(`${kindCfg.masterBasename} CA ${pr}: fetch failed, keeping prior cache (${prev.records.length})`);
        stateStats[pr] = { error: lastErr, count: prev.records.length, keptCache: true };
        await sleep(2000);
        continue;
      }
      writeJson(cachePath, { generated: new Date().toISOString(), state: pr, error: lastErr, records: [] });
      stateStats[pr] = { error: lastErr, count: 0 };
      await sleep(2000);
      continue;
    }

    const seen = new Set();
    const records = elementsToRecords(pr, elements, kindCfg, "CA", coordValidCa, seen, kind);
    writeJson(cachePath, {
      generated: new Date().toISOString(),
      state: pr,
      elementCount: elements.length,
      recordCount: records.length,
      records,
    });
    stateStats[pr] = { count: records.length, elements: elements.length };
    console.log(`${kindCfg.masterBasename} CA ${pr}: ${records.length} records (${elements.length} raw)`);
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
    region: "ca",
    recordCount: allRecords.length,
    stateStats,
    records: allRecords,
  });
  console.log(`${kindCfg.masterBasename} CA merged: ${allRecords.length} records`);
  return allRecords.length;
}

const args = parseArgs();
for (const kind of args.kinds) {
  if (!POI_KINDS[kind]) {
    console.error("Unknown kind:", kind);
    process.exit(1);
  }
}
const provinces = args.provinces || CA_PROVINCES;
for (const kind of args.kinds) {
  await ingestKind(kind, provinces, args.refresh);
}
