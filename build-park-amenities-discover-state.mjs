#!/usr/bin/env node
/**
 * Probe US state park amenity ArcGIS candidates.
 *
 * Usage:
 *   node build-park-amenities-discover-state.mjs
 *   node build-park-amenities-discover-state.mjs --state=CA,WY
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { readJson, writeJson } from "./park-amenities-lib.mjs";
import { INGEST_DIR } from "./park-amenities-us-lib.mjs";
import { US_STATES } from "./state-parks-lib.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));
const SEEDS_PATH = path.join(tools, "park-amenities-state-seeds.json");
const OUT_DIR = path.join(INGEST_DIR, "00-research");
const OUT_PATH = path.join(OUT_DIR, "state-amenity-discovery.json");

function parseStates() {
  const m = process.argv.find((a) => a.startsWith("--state="));
  if (!m) return null;
  return m
    .slice(8)
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

async function probeArcgis(candidate) {
  const where = candidate.where || "1=1";
  const countUrl = `${candidate.queryUrl}?where=${encodeURIComponent(where)}&returnCountOnly=true&f=json`;
  const sampleUrl = `${candidate.queryUrl}?where=${encodeURIComponent(where)}&outFields=${encodeURIComponent(candidate.outFields || "*")}&returnGeometry=true&resultRecordCount=2&f=json`;
  try {
    const [cr, sr] = await Promise.all([
      fetch(countUrl, { signal: AbortSignal.timeout(60000) }),
      fetch(sampleUrl, { signal: AbortSignal.timeout(60000) }),
    ]);
    const cj = await cr.json();
    if (cj.error) return { ok: false, error: cj.error.message || JSON.stringify(cj.error) };
    const sj = await sr.json();
    const attrs = sj.features?.[0]?.attributes || {};
    const geom = sj.features?.[0]?.geometry || null;
    return {
      ok: true,
      count: cj.count ?? 0,
      geometryType: sj.geometryType || (geom?.rings ? "polygon" : geom ? "point" : null),
      sampleFields: Object.keys(attrs).slice(0, 20),
      sample: attrs,
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

async function main() {
  const seeds = readJson(SEEDS_PATH, { us: {} });
  const want = parseStates();
  const results = { generated: new Date().toISOString(), states: {} };

  for (const st of US_STATES) {
    if (want && !want.includes(st)) continue;
    const block = seeds.us?.[st];
    if (!block) continue;

    const row = {
      agency: block.agency,
      server: block.server || null,
      boundaries: [],
      candidates: [],
    };

    for (const c of block.boundaries || []) {
      row.boundaries.push({ ...c, ...(await probeArcgis(c)) });
    }
    for (const c of block.candidates || []) {
      row.candidates.push({ ...c, ...(await probeArcgis(c)) });
    }

    results.states[st] = row;
    const ok = [...row.boundaries, ...row.candidates].filter((x) => x.ok).length;
    const total = row.boundaries.length + row.candidates.length;
    console.log(st, ok + "/" + total, "layers probed");
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  writeJson(OUT_PATH, results);
  console.log("Wrote", OUT_PATH);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
