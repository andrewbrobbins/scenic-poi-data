/**
 * OSM verification for NPS visitor centers — local Geofabrik PBF only.
 * Do NOT use Overpass for this layer (rate limits, multi-hour runs).
 */
import fs from "fs";
import { createReadStream } from "fs";
import { pipeline } from "stream/promises";
import { Writable } from "stream";
import path from "path";
import { pbfFilePath } from "./poi-osm-pbf-config.mjs";
import { ensureIngestDir, haversineM, readJson, writeJson } from "./nps-visitor-centers-lib.mjs";

export const OSM_VERIFY_RADIUS_M = 350;
export const OSM_FAR_THRESHOLD_M = 150;

const CACHE_REL = "03-osm-pbf/osm-vc-candidates.json";

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

/** One pass over US PBF — collect VC-like OSM nodes/ways. */
export async function extractOsmVisitorCenterCandidates(pbfPath) {
  const parser = await loadParser();
  const matchingNodes = [];
  const matchingWays = [];
  const neededNodeIds = new Set();

  console.log("OSM PBF scan:", path.basename(pbfPath), "...");
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
              if (item.type === "node" && need.has(item.id) && !nodeCoords.has(item.id)) {
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

  const candidates = [];
  for (const n of matchingNodes) {
    candidates.push({ type: n.type, id: n.id, lat: n.lat, lon: n.lon, tags: n.tags });
  }
  for (const w of matchingWays) {
    const c = wayCentroid(w.refs, nodeCoords);
    if (!c) continue;
    candidates.push({ type: w.type, id: w.id, lat: c.lat, lon: c.lon, tags: w.tags });
  }

  console.log(
    "OSM PBF scan done:",
    candidates.length,
    "candidates (",
    matchingNodes.length,
    "nodes,",
    matchingWays.length,
    "ways )"
  );
  return candidates;
}

/** Grid index for fast radius search (~0.02° cells ≈ 2 km). */
export class OsmCandidateIndex {
  constructor(candidates, cellDeg = 0.02) {
    this.cellDeg = cellDeg;
    this.cells = new Map();
    for (const c of candidates) {
      if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;
      const key = this.cellKey(c.lat, c.lon);
      if (!this.cells.has(key)) this.cells.set(key, []);
      this.cells.get(key).push(c);
    }
  }

  cellKey(lat, lon) {
    return `${Math.floor(lat / this.cellDeg)}:${Math.floor(lon / this.cellDeg)}`;
  }

  nearest(lat, lon, maxM = OSM_VERIFY_RADIUS_M) {
    const latRadius = maxM / 111320;
    const lonRadius = maxM / (111320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
    const latMin = lat - latRadius;
    const latMax = lat + latRadius;
    const lonMin = lon - lonRadius;
    const lonMax = lon + lonRadius;

    let best = null;
    let bestD = Infinity;
    const latCellMin = Math.floor(latMin / this.cellDeg);
    const latCellMax = Math.floor(latMax / this.cellDeg);
    const lonCellMin = Math.floor(lonMin / this.cellDeg);
    const lonCellMax = Math.floor(lonMax / this.cellDeg);

    for (let clat = latCellMin; clat <= latCellMax; clat++) {
      for (let clon = lonCellMin; clon <= lonCellMax; clon++) {
        const bucket = this.cells.get(`${clat}:${clon}`);
        if (!bucket) continue;
        for (const c of bucket) {
          if (c.lat < latMin || c.lat > latMax || c.lon < lonMin || c.lon > lonMax) continue;
          const d = haversineM({ lat, lon }, { lat: c.lat, lon: c.lon });
          if (d <= maxM && d < bestD) {
            bestD = d;
            best = { ...c, distanceM: d };
          }
        }
      }
    }
    return best;
  }
}

export async function loadOsmCandidateIndex({ refresh = false } = {}) {
  const outDir = ensureIngestDir("03-osm-pbf");
  const cachePath = path.join(outDir, "osm-vc-candidates.json");

  if (!refresh && fs.existsSync(cachePath)) {
    const cached = readJson(cachePath, { candidates: [] });
    if (cached.candidates?.length) {
      console.log("OSM verify cache:", cached.candidates.length, "candidates ->", cachePath);
      return new OsmCandidateIndex(cached.candidates);
    }
  }

  const pbfPath = pbfFilePath("us");
  if (!fs.existsSync(pbfPath)) {
    throw new Error(
      `Missing ${pbfPath} — run: node build-poi-osm-download.mjs --region=us (or ensure-fuel-cache.mjs --region=us)`
    );
  }

  const candidates = await extractOsmVisitorCenterCandidates(pbfPath);
  writeJson(cachePath, {
    generated: new Date().toISOString(),
    source: pbfPath,
    candidateCount: candidates.length,
    candidates,
  });
  return new OsmCandidateIndex(candidates);
}

export function nearestOsmFromIndex(index, lat, lon, maxM = OSM_VERIFY_RADIUS_M) {
  return index.nearest(lat, lon, maxM);
}
