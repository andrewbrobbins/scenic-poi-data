/**
 * Ingest branded fuel stops from local Geofabrik PBF (NOT Overpass).
 * PBF path: tools/osm-pbf/geofabrik/us-latest.osm.pbf
 *
 * Usage: node build-fuel-us-ingest-pbf.mjs
 */
import fs from "fs";
import path from "path";
import { createReadStream } from "fs";
import { pipeline } from "stream/promises";
import { Writable } from "stream";
import { fileURLToPath } from "url";
import { PBF_SOURCES, pbfFilePath } from "./poi-osm-pbf-config.mjs";
import { inferRegionCode } from "./poi-osm-lib.mjs";
import {
  INGEST_DIR,
  coordValid,
  ensureIngestDir,
  loadBrandCatalog,
  matchBrandFromTags,
  slugify,
  writeJson,
} from "./fuel-us-lib.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));

function isFuelCandidate(tags) {
  if (tags.amenity === "fuel" || tags.shop === "fuel") return true;
  if ((tags.highway === "services" || tags.highway === "rest_area") && tags.brand) return true;
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

function recordFromMatch(osmType, osmId, lat, lon, tags, match, state) {
  const name = (tags.name || tags["addr:housename"] || match.displayName).trim();
  return {
    id: `FUEL-${match.brandId.toUpperCase()}-${state || "XX"}-${slugify(name)}-${osmId}`,
    name,
    brand: match.displayName,
    brandId: match.brandId,
    brandTier: match.tier,
    type: match.type,
    mergeWith: match.mergeWith,
    state: state || "",
    lat,
    lon,
    highway: tags.highway || "",
    exit: tags.ref || tags["exit"] || "",
    fuels: {
      gasoline: true,
      diesel: tags["fuel:diesel"] === "yes" || tags.diesel === "yes",
    },
    amenities: {
      restroom: tags.toilets ? String(tags.toilets) : "assumed",
      food: tags.shop === "convenience" ? "yes" : "unknown",
    },
    sources: ["osm-pbf"],
    osm: { type: osmType, id: osmId },
    osmTags: {
      brand: tags.brand || "",
      operator: tags.operator || "",
    },
    mapFlags: [],
    needsReview: false,
    manualVerified: false,
    url: `https://www.openstreetmap.org/${osmType}/${osmId}`,
  };
}

async function loadParser() {
  const mod = await import("osm-pbf-parser");
  return mod.default || mod;
}

export async function ingestFuelFromPbf(sourceKey = "us") {
  const catalog = loadBrandCatalog();
  const pbf = pbfFilePath(sourceKey);
  if (!fs.existsSync(pbf)) {
    throw new Error(`Missing PBF: ${pbf} — run node build-poi-osm-download.mjs`);
  }
  const parser = await loadParser();

  const fuelNodes = [];
  const fuelWays = [];
  const neededNodeIds = new Set();

  console.log(`Scanning ${pbf} for branded fuel...`);
  await pipeline(
    createReadStream(pbf),
    parser(),
    new Writable({
      objectMode: true,
      write(chunks, _enc, cb) {
        try {
          for (const item of chunks) {
            if (item.type === "way") {
              const tags = item.tags || {};
              if (isFuelCandidate(tags)) {
                fuelWays.push({ osmId: item.id, refs: item.refs || [], tags });
                for (const id of item.refs || []) neededNodeIds.add(id);
              }
            } else if (item.type === "node") {
              const tags = item.tags || {};
              if (isFuelCandidate(tags)) {
                fuelNodes.push({ osmId: item.id, lat: item.lat, lon: item.lon, tags });
              }
            }
          }
          cb();
        } catch (err) {
          cb(err);
        }
      },
    })
  );

  const nodeCoords = new Map();
  for (const n of fuelNodes) nodeCoords.set(n.osmId, { lat: n.lat, lon: n.lon });

  if (neededNodeIds.size) {
    const need = neededNodeIds;
    await pipeline(
      createReadStream(pbf),
      parser(),
      new Writable({
        objectMode: true,
        write(chunks, _enc, cb) {
          try {
            for (const item of chunks) {
              if (item.type === "node" && need.has(item.id)) {
                nodeCoords.set(item.id, { lat: item.lat, lon: item.lon });
              }
            }
            cb();
          } catch (err) {
            cb(err);
          }
        },
      })
    );
  }

  const records = [];
  const seen = new Set();
  const byBrand = {};
  let rawCandidates = 0;

  function tryAdd(osmType, osmId, lat, lon, tags) {
    rawCandidates += 1;
    if (!coordValid(lat, lon)) return;
    const match = matchBrandFromTags(tags, catalog);
    if (!match) return;
    const key = `${osmType}:${osmId}`;
    if (seen.has(key)) return;
    seen.add(key);
    const state = inferRegionCode(lat, lon, "US") || "";
    const rec = recordFromMatch(osmType, osmId, lat, lon, tags, match, state);
    records.push(rec);
    byBrand[match.brandId] = (byBrand[match.brandId] || 0) + 1;
  }

  for (const n of fuelNodes) tryAdd("node", n.osmId, n.lat, n.lon, n.tags);
  for (const w of fuelWays) {
    const c = wayCentroid(w.refs, nodeCoords);
    if (!c) continue;
    tryAdd("way", w.osmId, c.lat, c.lon, w.tags);
  }

  const outDir = ensureIngestDir("01-osm");
  const mergedPath = path.join(outDir, "fuel-merged.json");
  writeJson(mergedPath, {
    generated: new Date().toISOString(),
    source: "osm-pbf",
    pbf,
    rawCandidates,
    recordCount: records.length,
    byBrand,
    records,
  });
  console.log(`Wrote ${records.length} branded fuel records (${rawCandidates} OSM candidates)`);
  return { records, byBrand, rawCandidates };
}

if (process.argv[1] && process.argv[1].endsWith("build-fuel-us-ingest-pbf.mjs")) {
  ingestFuelFromPbf("us").catch((e) => {
    console.error(e);
    process.exit(1);
  });
}