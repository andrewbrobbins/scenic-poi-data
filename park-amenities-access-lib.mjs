/**
 * Road / trail distance enrichment for campground access mode.
 * Reuses camping-us OSM highway caches when present; builds trail caches on demand.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  ACCESS_ROAD_MAX_M,
  ACCESS_TRAIL_MAX_M,
  applyAccessFields,
  readJson,
  writeJson,
} from "./park-amenities-lib.mjs";
import {
  roadDistanceForRecord,
  listStatesWithRoadCache,
} from "./camping-us-road-enrich.mjs";
import { STATE_BBOXES } from "./camping-us-state-bboxes.mjs";
import { ensureIngestDir as ensureCampingIngest, sleep } from "./camping-us-lib.mjs";
import { inferStateFromCoords } from "./camping-us-geo-utils.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));
const TRAIL_DIR = path.join(tools, "park-amenities-us-ingest", "05-trails");

const OVERPASS_URLS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

/** Hiking-oriented ways — excludes vehicle highways. */
const TRAIL_HIGHWAY_RE = "^(path|footway|track|bridleway|steps)$";

const trailIndexCache = new Map();

function haversineM(a, b) {
  const R = 6371000;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function pointToSegmentM(p, a, b) {
  const lat = p[0];
  const lon = p[1];
  const lat1 = a[0];
  const lon1 = a[1];
  const lat2 = b[0];
  const lon2 = b[1];
  const dx = lat2 - lat1;
  const dy = lon2 - lon1;
  if (dx === 0 && dy === 0) return haversineM(p, a);
  let t = ((lat - lat1) * dx + (lon - lon1) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  return haversineM(p, [lat1 + t * dx, lon1 + t * dy]);
}

function buildTrailIndex(segments) {
  const GRID = 0.05;
  const grid = new Map();
  for (const [a, b] of segments) {
    const midLat = (a[0] + b[0]) / 2;
    const midLon = (a[1] + b[1]) / 2;
    const key = `${Math.floor(midLat / GRID)}:${Math.floor(midLon / GRID)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push([a, b]);
  }
  return { grid, GRID, segments: segments.length };
}

function minTrailDistanceM(point, index) {
  if (!index?.grid?.size) return null;
  const lat = point[0];
  const lon = point[1];
  const ci = Math.floor(lat / index.GRID);
  const cj = Math.floor(lon / index.GRID);
  let best = Infinity;
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      const segs = index.grid.get(`${ci + di}:${cj + dj}`);
      if (!segs) continue;
      for (const [a, b] of segs) {
        const d = pointToSegmentM(point, a, b);
        if (d < best) best = d;
      }
    }
  }
  return best === Infinity ? null : best;
}

function trailCachePath(st) {
  return path.join(TRAIL_DIR, `osm-trails-${st}.json`);
}

function getTrailIndex(st) {
  const key = st.toUpperCase();
  if (trailIndexCache.has(key)) return trailIndexCache.get(key);
  const p = trailCachePath(key);
  if (!fs.existsSync(p)) {
    trailIndexCache.set(key, null);
    return null;
  }
  const j = readJson(p);
  const idx = buildTrailIndex(j.segments || []);
  trailIndexCache.set(key, idx);
  return idx;
}

export function listStatesWithTrailCache() {
  if (!fs.existsSync(TRAIL_DIR)) return [];
  return fs
    .readdirSync(TRAIL_DIR)
    .filter((f) => /^osm-trails-[A-Z]{2}\.json$/i.test(f))
    .map((f) => f.match(/^osm-trails-([A-Z]{2})\.json$/i)[1].toUpperCase())
    .sort();
}

export function trailDistanceForRecord(r) {
  const point = [r.lat, r.lon];
  const st = r.state || inferStateFromCoords(r.lat, r.lon);
  if (!st) return null;
  const idx = getTrailIndex(st);
  if (!idx) return null;
  const d = minTrailDistanceM(point, idx);
  return d == null ? 999999 : d;
}

async function overpassQuery(query, urlIndex = 0) {
  const url = OVERPASS_URLS[urlIndex % OVERPASS_URLS.length];
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "scenic-poi-data/1.0 (park-amenities-trail-enrich)",
    },
    body: "data=" + encodeURIComponent(query),
    signal: AbortSignal.timeout(600000),
  });
  const text = await res.text();
  if (!res.ok) {
    if (urlIndex < OVERPASS_URLS.length - 1) return overpassQuery(query, urlIndex + 1);
    throw new Error(`Overpass HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text);
}

function buildTrailQuery(bbox) {
  const [s, w, n, e] = bbox;
  return `
[out:json][timeout:300];
way["highway"~"${TRAIL_HIGHWAY_RE}"](${s},${w},${n},${e});
out geom;
`;
}

export async function fetchTrailCacheForState(st) {
  fs.mkdirSync(TRAIL_DIR, { recursive: true });
  const bbox = STATE_BBOXES[st];
  if (!bbox) throw new Error("No bbox for state " + st);
  console.log("Trail cache:", st, "...");
  const j = await overpassQuery(buildTrailQuery(bbox));
  const segments = [];
  for (const el of j.elements || []) {
    if (el.type !== "way" || !el.geometry?.length) continue;
    const geom = el.geometry;
    for (let i = 1; i < geom.length; i++) {
      segments.push([
        [geom[i - 1].lat, geom[i - 1].lon],
        [geom[i].lat, geom[i].lon],
      ]);
    }
  }
  const payload = {
    generated: new Date().toISOString(),
    state: st,
    segmentCount: segments.length,
    segments,
  };
  writeJson(trailCachePath(st), payload);
  trailIndexCache.delete(st);
  console.log("  →", segments.length, "trail segments");
  return payload;
}

export async function fetchTrailCaches(states) {
  const out = [];
  for (const st of states) {
    out.push(await fetchTrailCacheForState(st));
    await sleep(2000);
  }
  return out;
}

/**
 * Enrich campground records with road/trail distances and accessMode.
 * @param {object[]} records
 * @param {{ campgroundsOnly?: boolean }} opts
 */
export function enrichAccessOnRecords(records, opts = {}) {
  const campgroundsOnly = opts.campgroundsOnly !== false;
  let enriched = 0;
  const byAccess = { road: 0, trail: 0, unknown: 0 };

  for (const rec of records) {
    if (campgroundsOnly && rec.kind !== "campground") continue;

    if (rec.country === "US" || !rec.country) {
      const rd = roadDistanceForRecord(rec);
      if (rd != null && rd !== undefined) rec.roadDistanceM = rd === 999999 ? null : rd;
      const td = trailDistanceForRecord(rec);
      if (td != null && td !== undefined) rec.trailDistanceM = td === 999999 ? null : td;
    }

    applyAccessFields(rec);
    enriched += 1;
    byAccess[rec.accessMode] = (byAccess[rec.accessMode] || 0) + 1;
  }

  return { enriched, byAccess, roadCaches: listStatesWithRoadCache(), trailCaches: listStatesWithTrailCache() };
}

export { ACCESS_ROAD_MAX_M, ACCESS_TRAIL_MAX_M, ensureCampingIngest };
