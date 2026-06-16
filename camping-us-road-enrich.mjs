/**
 * Per-state OSM highway cache + point-to-road distance (meters).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ensureIngestDir, readJson, sleep, writeJson } from "./camping-us-lib.mjs";
import { STATE_BBOXES } from "./camping-us-state-bboxes.mjs";
import { OSM_SPLIT } from "./camping-us-osm-split-states.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));
const ROAD_DIR = ensureIngestDir("05-roads");

const OVERPASS_URLS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

/** Vehicle-oriented OSM highways only — excludes path, footway, track, cycleway, bridleway, steps. */
export const VEHICLE_HIGHWAY_RE =
  "^(motorway|trunk|primary|secondary|tertiary|unclassified|service)$";

const HIGHWAY_RE = VEHICLE_HIGHWAY_RE;

const NON_VEHICLE_HIGHWAY = new Set([
  "path",
  "footway",
  "track",
  "cycleway",
  "bridleway",
  "steps",
  "pedestrian",
  "corridor",
]);

function haversineM(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
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

function wayToSegments(way) {
  const hw = way.tags?.highway;
  if (hw && NON_VEHICLE_HIGHWAY.has(hw)) return [];
  const geom = way.geometry;
  if (!geom || geom.length < 2) return [];
  const segs = [];
  for (let i = 1; i < geom.length; i++) {
    segs.push([
      [geom[i - 1].lat, geom[i - 1].lon],
      [geom[i].lat, geom[i].lon],
    ]);
  }
  return segs;
}

function bboxesForState(st) {
  if (OSM_SPLIT[st]) return OSM_SPLIT[st];
  const b = STATE_BBOXES[st];
  return b ? [b] : [];
}

function buildBboxQuery(bbox) {
  const [s, w, n, e] = bbox;
  return `
[out:json][timeout:300];
way["highway"~"${HIGHWAY_RE}"](${s},${w},${n},${e});
out geom;
`;
}

function splitBboxQuarters(bbox) {
  const [s, w, n, e] = bbox;
  const midLat = (s + n) / 2;
  const midLon = (w + e) / 2;
  return [
    [s, w, midLat, midLon],
    [s, midLon, midLat, e],
    [midLat, w, n, midLon],
    [midLat, midLon, n, e],
  ];
}

const FETCH_MS = 900000;

async function overpassQuery(query, urlIndex = 0, attempt = 0) {
  const url = OVERPASS_URLS[urlIndex % OVERPASS_URLS.length];
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "VancouverTripCampingDB/1.0 (road-enrich)",
      },
      body: "data=" + encodeURIComponent(query),
      signal: AbortSignal.timeout(FETCH_MS),
      headersTimeout: FETCH_MS,
      bodyTimeout: FETCH_MS,
    });
  } catch (e) {
    const retryable = /timeout|fetch failed|ECONNRESET|ETIMEDOUT/i.test(String(e.message || e.cause));
    if (retryable && attempt < 3) {
      console.log(`  Overpass retry ${attempt + 1}…`);
      await sleep(8000 * (attempt + 1));
      return overpassQuery(query, urlIndex, attempt + 1);
    }
    if (urlIndex < OVERPASS_URLS.length - 1) return overpassQuery(query, urlIndex + 1, 0);
    throw e;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok) {
    const head = buf.toString("utf8", 0, Math.min(300, buf.length));
    if (urlIndex < OVERPASS_URLS.length - 1) return overpassQuery(query, urlIndex + 1, 0);
    throw new Error(`Overpass HTTP ${res.status}: ${head}`);
  }
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch (e) {
    if (buf.length > 120_000_000) {
      throw new Error(`Overpass response too large (${buf.length} bytes); use smaller bbox`);
    }
    if (urlIndex < OVERPASS_URLS.length - 1) return overpassQuery(query, urlIndex + 1, 0);
    throw new Error(`Overpass invalid JSON: ${e.message}`);
  }
}

async function fetchBboxSegments(bbox, depth = 0) {
  try {
    const j = await overpassQuery(buildBboxQuery(bbox));
    const segments = [];
    for (const el of j.elements || []) {
      if (el.type !== "way") continue;
      for (const seg of wayToSegments(el)) segments.push(seg);
    }
    return segments;
  } catch (e) {
    const tooBig =
      /too large|ERR_STRING_TOO_LONG|string longer/i.test(e.message) ||
      e.code === "ERR_STRING_TOO_LONG";
    if (tooBig && depth < 2) {
      const parts = splitBboxQuarters(bbox);
      console.log(`  sub-split (${parts.length} tiles, depth ${depth + 1})…`);
      const out = [];
      for (let i = 0; i < parts.length; i++) {
        console.log(`  sub-tile ${i + 1}/${parts.length} (depth ${depth + 1})`);
        const segs = await fetchBboxSegments(parts[i], depth + 1);
        for (let j = 0; j < segs.length; j++) out.push(segs[j]);
        console.log(`  sub-tile ${i + 1}: ${segs.length} segments`);
        if (i < parts.length - 1) await sleep(1500);
      }
      return out;
    }
    throw e;
  }
}

export function roadCachePath(st) {
  return path.join(ROAD_DIR, `osm-roads-${st}.json`);
}

function appendSegments(target, items) {
  for (let i = 0; i < items.length; i++) target.push(items[i]);
}

export function loadRoadCache(st) {
  const cachePath = roadCachePath(st);
  const head = readJson(cachePath);
  if (!head) return null;
  if (head.segments?.length) return head;
  if (!head.parts?.length) return head;
  const dir = path.dirname(cachePath);
  const segments = [];
  for (const partFile of head.parts) {
    const part = readJson(path.join(dir, partFile));
    if (part?.segments?.length) appendSegments(segments, part.segments);
  }
  return segments.length ? { ...head, segments } : head;
}

function roadPartPath(cachePath, partIndex) {
  return cachePath.replace(/\.json$/i, `-p${partIndex}.json`);
}

const MAX_SEGMENTS_PER_PART_FILE = 350_000;

function writeRoadPart(cachePath, partIndex, st, segments) {
  const names = [];
  const chunks =
    segments.length <= MAX_SEGMENTS_PER_PART_FILE
      ? [segments]
      : (() => {
          const out = [];
          for (let i = 0; i < segments.length; i += MAX_SEGMENTS_PER_PART_FILE) {
            out.push(segments.slice(i, i + MAX_SEGMENTS_PER_PART_FILE));
          }
          return out;
        })();
  for (let ci = 0; ci < chunks.length; ci++) {
    const key = chunks.length === 1 ? partIndex : `${partIndex}s${ci}`;
    const partPath = roadPartPath(cachePath, key);
    const payload = {
      generated: new Date().toISOString(),
      state: st,
      part: key,
      segmentCount: chunks[ci].length,
      segments: chunks[ci],
    };
    fs.mkdirSync(path.dirname(partPath), { recursive: true });
    fs.writeFileSync(partPath, JSON.stringify(payload), "utf8");
    names.push(path.basename(partPath));
  }
  return names;
}

function writeRoadManifest(cachePath, st, partFiles, segmentCount) {
  const payload = {
    generated: new Date().toISOString(),
    state: st,
    segmentCount,
    parts: partFiles,
  };
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

export async function fetchAndCacheStateRoads(st, options = {}) {
  const bboxes = bboxesForState(st);
  if (!bboxes.length) throw new Error(`No bbox for ${st}`);
  const cachePath = roadCachePath(st);
  if (!options.force && fs.existsSync(cachePath)) {
    const head = readJson(cachePath);
    if (head?.segments?.length || head?.parts?.length) return head;
  }
  console.log(`Roads ${st}: ${bboxes.length} tile(s)…`);
  const partFiles = [];
  let segmentCount = 0;
  for (let i = 0; i < bboxes.length; i++) {
    const partPath = roadPartPath(cachePath, i);
    if (!options.force && fs.existsSync(partPath)) {
      const existing = readJson(partPath);
      const n = existing?.segmentCount ?? existing?.segments?.length ?? 0;
      partFiles.push(path.basename(partPath));
      segmentCount += n;
      console.log(`  tile ${i + 1}/${bboxes.length}: reuse ${n} (${segmentCount} total)`);
      continue;
    }
    console.log(`  tile ${i + 1}/${bboxes.length}`);
    const segments = await fetchBboxSegments(bboxes[i]);
    partFiles.push(...writeRoadPart(cachePath, i, st, segments));
    segmentCount += segments.length;
    console.log(`  tile ${i + 1}: ${segments.length} (${segmentCount} total)`);
    if (i < bboxes.length - 1) await sleep(2000);
  }
  const payload = writeRoadManifest(cachePath, st, partFiles, segmentCount);
  console.log(`Roads ${st}: cached ${segmentCount} segments`);
  await sleep(1500);
  return payload;
}

export function buildRoadIndex(segments) {
  const cellDeg = 0.02;
  const grid = new Map();
  for (let si = 0; si < segments.length; si++) {
    const [a, b] = segments[si];
    const minLat = Math.min(a[0], b[0]);
    const maxLat = Math.max(a[0], b[0]);
    const minLon = Math.min(a[1], b[1]);
    const maxLon = Math.max(a[1], b[1]);
    const gx0 = Math.floor(minLat / cellDeg);
    const gx1 = Math.floor(maxLat / cellDeg);
    const gy0 = Math.floor(minLon / cellDeg);
    const gy1 = Math.floor(maxLon / cellDeg);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gy = gy0; gy <= gy1; gy++) {
        const key = `${gx},${gy}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(si);
      }
    }
  }
  return { segments, grid, cellDeg };
}

function minRoadDistanceSingle(point, index) {
  const { segments, grid, cellDeg } = index;
  if (!segments.length) return null;
  const gx = Math.floor(point[0] / cellDeg);
  const gy = Math.floor(point[1] / cellDeg);
  let best = Infinity;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const list = grid.get(`${gx + dx},${gy + dy}`);
      if (!list) continue;
      for (const si of list) {
        const [a, b] = segments[si];
        const d = pointToSegmentM(point, a, b);
        if (d < best) best = d;
      }
    }
  }
  return best === Infinity ? null : Math.round(best);
}

function pauseMs(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    /* Google Drive read errors are often transient */
  }
}

function readJsonRetry(filePath, attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    try {
      return readJson(filePath);
    } catch (e) {
      if (i === attempts - 1) throw e;
      console.warn(`  read retry ${i + 1} for ${path.basename(filePath)}…`);
      pauseMs(2000 * (i + 1));
    }
  }
}

function minRoadDistanceLazy(point, meta) {
  let best = Infinity;
  for (const partFile of meta.parts) {
    const part = readJsonRetry(path.join(meta.dir, partFile));
    if (!part?.segments?.length) continue;
    const d = minRoadDistanceSingle(point, buildRoadIndex(part.segments));
    if (d != null && d < best) best = d;
  }
  return best === Infinity ? null : best;
}

export function minRoadDistanceM(point, index) {
  if (!index) return null;
  if (index.lazy) return minRoadDistanceLazy(point, index);
  if (index.parts) {
    let best = Infinity;
    for (const partIndex of index.parts) {
      const d = minRoadDistanceSingle(point, partIndex);
      if (d != null && d < best) best = d;
    }
    return best === Infinity ? null : best;
  }
  return minRoadDistanceSingle(point, index);
}

const stateIndexes = new Map();

export function getStateRoadIndex(st) {
  if (stateIndexes.has(st)) return stateIndexes.get(st);
  const cachePath = roadCachePath(st);
  const head = readJson(cachePath);
  if (!head) return null;

  if (head.segments?.length) {
    const index = buildRoadIndex(head.segments);
    stateIndexes.set(st, index);
    return index;
  }

  if (head.parts?.length) {
    const meta = { lazy: true, dir: path.dirname(cachePath), parts: head.parts };
    stateIndexes.set(st, meta);
    return meta;
  }

  return null;
}

export function clearRoadIndexCache() {
  stateIndexes.clear();
}

/** Try neighboring / cached states when ingest state has no road file (e.g. ID site near MT highways). */
export const ROAD_FALLBACK_STATES = {
  ID: ["MT", "WA", "OR", "NV", "UT", "WY"],
  MT: ["ID", "WY", "ND", "SD"],
  WA: ["ID", "OR", "MT"],
  OR: ["ID", "WA", "CA", "NV"],
  WY: ["ID", "MT", "CO", "UT", "SD", "NE"],
  ND: ["MT", "SD", "MN"],
  SD: ["MT", "ND", "WY", "NE"],
  NV: ["ID", "CA", "OR", "UT", "AZ"],
  UT: ["ID", "NV", "AZ", "CO", "WY"],
  CO: ["WY", "UT", "NM", "OK", "KS", "NE"],
};

export function listStatesWithRoadCache() {
  if (!fs.existsSync(ROAD_DIR)) return [];
  const out = new Set();
  for (const f of fs.readdirSync(ROAD_DIR)) {
    const m = f.match(/^osm-roads-([A-Z]{2})\.json$/i);
    if (m) out.add(m[1].toUpperCase());
  }
  return [...out].sort();
}

function distanceFromStateIndex(point, st) {
  const idx = getStateRoadIndex(st);
  if (!idx) return undefined;
  const d = minRoadDistanceM(point, idx);
  return d == null ? null : d;
}

/**
 * Minimum distance to a vehicle highway (m).
 * null = no road cache for this state (and no fallback produced a distance).
 * 999999 = home-state cache exists but no highway within the search grid (remote).
 */
export function roadDistanceForRecord(r) {
  const point = [r.lat, r.lon];
  const home = distanceFromStateIndex(point, r.state);
  if (home != null && home !== undefined) return home;
  if (home === null) return 999999;

  let best = null;
  for (const st of ROAD_FALLBACK_STATES[r.state] || []) {
    const d = distanceFromStateIndex(point, st);
    if (d != null && d !== undefined && (best == null || d < best)) best = d;
  }
  return best;
}
