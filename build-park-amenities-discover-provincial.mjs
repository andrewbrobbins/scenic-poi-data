#!/usr/bin/env node
/**
 * Probe provincial park amenity ArcGIS / API candidates.
 *
 * Usage:
 *   node build-park-amenities-discover-provincial.mjs
 *   node build-park-amenities-discover-provincial.mjs --province=AB,BC,ON
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { readJson, writeJson } from "./park-amenities-lib.mjs";
import { CA_PROVINCES } from "./state-parks-lib.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));
const SEEDS_PATH = path.join(tools, "park-amenities-provincial-seeds.json");
const OUT_DIR = path.join(tools, "park-amenities-ca-ingest", "00-research");
const OUT_PATH = path.join(OUT_DIR, "provincial-discovery.json");

function parseProvinces() {
  const m = process.argv.find((a) => a.startsWith("--province="));
  if (!m) return null;
  return m
    .slice(11)
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
    const typeField = candidate.typeField || "properties_ftype";
    const typeCounts = {};
    if (attrs[typeField] != null || Object.keys(attrs).some((k) => /type|ftype|kind/i.test(k))) {
      // optional: skip heavy type breakdown in discovery
    }
    return {
      ok: true,
      count: cj.count ?? 0,
      sampleFields: Object.keys(attrs).slice(0, 25),
      sample: attrs,
      typeCounts,
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

async function main() {
  const seeds = readJson(SEEDS_PATH, { ca: {} });
  const want = parseProvinces();
  const results = { generated: new Date().toISOString(), provinces: {} };

  for (const prov of CA_PROVINCES) {
    if (want && !want.includes(prov)) continue;
    const block = seeds.ca?.[prov] || { agency: prov, candidates: [], lists: [] };
    const row = {
      agency: block.agency,
      lists: block.lists || [],
      candidates: [],
    };

    for (const c of block.candidates || []) {
      if (!c.queryUrl?.includes("/query") && !c.queryUrl?.includes("terrapi")) {
        row.candidates.push({ ...c, ok: false, error: "not an ArcGIS query URL" });
        continue;
      }
      if (c.queryUrl.includes("terrapi")) {
        row.candidates.push({ ...c, ok: false, error: "TerrAPI — needs custom client (baseTerritoire)" });
        continue;
      }
      const probe = await probeArcgis(c);
      row.candidates.push({ label: c.label, queryUrl: c.queryUrl, where: c.where, notes: c.notes, ...probe });
      console.log(prov, c.label, probe.ok ? probe.count : probe.error);
    }

    if (!row.candidates.length) {
      console.log(prov, "— no ArcGIS candidates; lists only:", (block.lists || []).length);
    }
    results.provinces[prov] = row;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  writeJson(OUT_PATH, results);
  console.log("Wrote", OUT_PATH);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
