/**
 * OSM verification for Parks Canada visitor centers — local Canada Geofabrik PBF only.
 */
import fs from "fs";
import { createReadStream } from "fs";
import { pipeline } from "stream/promises";
import { Writable } from "stream";
import path from "path";
import { pbfFilePath } from "./poi-osm-pbf-config.mjs";
import { ensureIngestDir, haversineM, readJson, writeJson } from "./parks-canada-visitor-centers-lib.mjs";

export const OSM_VERIFY_RADIUS_M = 350;
export const OSM_FAR_THRESHOLD_M = 150;

const CACHE_REL = "02-osm-pbf/osm-vc-candidates.json";

function matchesOsmVisitorCenterTags(tags) {
  if (!tags) return false;
  if (tags.amenity === "ranger_station") return true;
  if (tags.tourism === "information") return true;
  if (tags.information === "visitor_centre" || tags.information === "visitor_center") return true;
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

async function loadParser() {
  const mod = await import("osm-pbf-parser");
  return mod.default || mod;
}

export async function extractOsmVisitorCenterCandidates(pbfPath) {
  const parser = await loadParser();
  const matchingNodes = [];
  const matchingWays = [];
  const neededNodeIds = new Set();

  console.log("OSM PBF scan (CA):", path.basename(pbfPath), "...");
  await pipeline(
    createReadStream(pbfPath),
    parser(),
    new Writable({
      objectMode: true,
      write(chunks, _enc, cb) {
        try {
          for (const item of chunks) {
            if (item.type === "node") {
              if (matchesOsmVisitorCenterTags(item.tags)) {
                matchingNodes.push({
                  type: "node",
                  id: item.id,
                  lat: item.lat,
                  lon: item.lon,
                  tags: item.tags || {},
                });
              }
            } else if (item.type === "way") {
              if (matchesOsmVisitorCenterTags(item.tags)) {
                matchingWays.push({
                  type: "way",
                  id: item.id,
                  tags: item.tags || {},
                  refs: item.refs || [],
                });
                for (const id of item.refs || []) neededNodeIds.add(id);
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
  for (const n of matchingNodes) nodeCoords.set(n.id, { lat: n.lat, lon: n.lon });

  if (neededNodeIds.size) {
    const need = neededNodeIds;
    await pipeline(
      createReadStream(pbfPath),
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

  const candidates = [...matchingNodes];
  for (const w of matchingWays) {
    const c = wayCentroid(w.refs, nodeCoords);
    if (c) candidates.push({ type: "way", id: w.id, lat: c.lat, lon: c.lon, tags: w.tags });
  }
  console.log("OSM VC candidates (CA):", candidates.length);
  return candidates;
}

export function nearestOsmFromIndex(index, lat, lon, maxM) {
  let best = null;
  let bestD = Infinity;
  for (const c of index) {
    const d = haversineM({ lat, lon }, { lat: c.lat, lon: c.lon });
    if (d <= maxM && d < bestD) {
      best = { ...c, distanceM: d };
      bestD = d;
    }
  }
  return best;
}

export async function loadOsmCandidateIndex({ refresh = false } = {}) {
  const cachePath = path.join(ensureIngestDir("02-osm-pbf"), "osm-vc-candidates.json");
  if (!refresh && fs.existsSync(cachePath)) {
    const cached = readJson(cachePath, { candidates: [] });
    return cached.candidates || [];
  }
  const pbfPath = pbfFilePath("ca");
  if (!fs.existsSync(pbfPath)) {
    console.warn("Canada PBF missing — skip OSM verify:", pbfPath);
    return [];
  }
  const candidates = await extractOsmVisitorCenterCandidates(pbfPath);
  writeJson(cachePath, { generated: new Date().toISOString(), pbf: pbfPath, candidates });
  return candidates;
}
