/**
 * Phase 1: extract ALL Canada fuel-related OSM features from local PBF into a cache.
 * Re-run only when the PBF updates: node build-fuel-ca-extract-all-pbf.mjs --refresh
 *
 * Output: fuel-ca-ingest/00-all-fuel/fuel-all-ca.json
 */
import fs from "fs";
import path from "path";
import { createReadStream } from "fs";
import { pipeline } from "stream/promises";
import { Writable } from "stream";
import { pbfFilePath } from "./poi-osm-pbf-config.mjs";
import {
  ALL_FUEL_CACHE_PATH,
  buildSearchBlob,
  coordValid,
  ensureIngestDir,
  writeJson,
} from "./fuel-ca-lib.mjs";
import { FUEL_REGIONS, pbfFingerprint, writeManifest } from "./fuel-cache-lib.mjs";

const FUEL_TAG_KEYS = [
  "name",
  "name:fr",
  "alt_name",
  "brand",
  "brand:fr",
  "operator",
  "operator:fr",
  "addr:housename",
  "amenity",
  "shop",
  "highway",
  "fuel:diesel",
  "diesel",
  "ref",
  "exit",
  "toilets",
];

function isFuelCandidate(tags) {
  if (tags.amenity === "fuel" || tags.shop === "fuel") return true;
  if (tags.highway === "services" || tags.highway === "rest_area") return true;
  return false;
}

function slimTags(tags) {
  const out = {};
  for (const k of FUEL_TAG_KEYS) {
    if (tags[k] != null && tags[k] !== "") out[k] = tags[k];
  }
  return out;
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

async function loadParser() {
  const mod = await import("osm-pbf-parser");
  return mod.default || mod;
}

export async function extractAllFuelCaFromPbf(sourceKey = "ca", { force = false } = {}) {
  if (!force && fs.existsSync(ALL_FUEL_CACHE_PATH)) {
    const cached = JSON.parse(fs.readFileSync(ALL_FUEL_CACHE_PATH, "utf8"));
    console.log(`Using cached extract (${cached.recordCount} records): ${ALL_FUEL_CACHE_PATH}`);
    console.log("Pass --refresh to rescan the PBF.");
    return cached;
  }

  const pbf = pbfFilePath(sourceKey);
  if (!fs.existsSync(pbf)) throw new Error(`Missing PBF: ${pbf}`);
  const parser = await loadParser();

  const fuelNodes = [];
  const fuelWays = [];
  const neededNodeIds = new Set();

  console.log(`Scanning ${pbf} for all Canada fuel candidates...`);
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

  function tryAdd(osmType, osmId, lat, lon, tags) {
    if (!coordValid(lat, lon)) return;
    const key = `${osmType}:${osmId}`;
    if (seen.has(key)) return;
    seen.add(key);
    const slim = slimTags(tags);
    records.push({
      osm: { type: osmType, id: osmId },
      lat,
      lon,
      tags: slim,
      searchBlob: buildSearchBlob(slim),
    });
  }

  for (const n of fuelNodes) tryAdd("node", n.osmId, n.lat, n.lon, n.tags);
  for (const w of fuelWays) {
    const c = wayCentroid(w.refs, nodeCoords);
    if (!c) continue;
    tryAdd("way", w.osmId, c.lat, c.lon, w.tags);
  }

  ensureIngestDir("00-all-fuel");
  const payload = {
    generated: new Date().toISOString(),
    source: "osm-pbf-extract-all",
    pbf,
    recordCount: records.length,
    records,
  };
  writeJson(ALL_FUEL_CACHE_PATH, payload);
  writeManifest(FUEL_REGIONS.ca.manifestPath, {
    generated: payload.generated,
    region: "ca",
    pbfSource: sourceKey,
    pbf,
    pbfFingerprint: pbfFingerprint(pbf),
    cacheFile: path.basename(ALL_FUEL_CACHE_PATH),
    cachePath: ALL_FUEL_CACHE_PATH,
    recordCount: records.length,
  });
  console.log(`Wrote ${records.length} fuel records to ${ALL_FUEL_CACHE_PATH}`);
  return payload;
}

if (process.argv[1]?.endsWith("build-fuel-ca-extract-all-pbf.mjs")) {
  const force = process.argv.includes("--refresh");
  extractAllFuelCaFromPbf("ca", { force }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}