/**
 * Drivable road helpers + spatial index for scenic viewpoint road-access filtering.
 */
const EARTH_RADIUS_M = 6371000;

/** OSM highway values treated as drivable for road-access filtering. */
/** Full drivable set (reference). */
export const DRIVABLE_HIGHWAYS = new Set([
  "motorway",
  "motorway_link",
  "trunk",
  "trunk_link",
  "primary",
  "primary_link",
  "secondary",
  "secondary_link",
  "tertiary",
  "tertiary_link",
  "unclassified",
  "residential",
  "living_street",
  "service",
  "road",
]);

/** Lean set for road-index builds (avoids 16M+ node Set on large extracts). */
export const SCENIC_ROAD_INDEX_HIGHWAYS = new Set([
  "motorway",
  "motorway_link",
  "trunk",
  "trunk_link",
  "primary",
  "primary_link",
  "secondary",
  "secondary_link",
  "tertiary",
  "tertiary_link",
]);

const NON_DRIVABLE_HIGHWAYS = new Set([
  "footway",
  "path",
  "cycleway",
  "bridleway",
  "pedestrian",
  "steps",
  "corridor",
  "platform",
  "proposed",
  "construction",
  "elevator",
  "escape",
  "raceway",
]);

export const DEFAULT_ROAD_MAX_DISTANCE_M = 120;

export function isDrivableHighway(tags, { lean = true } = {}) {
  if (!tags) return false;
  const hw = tags.highway;
  if (!hw || NON_DRIVABLE_HIGHWAYS.has(hw)) return false;

  const motorVehicle = (tags.motor_vehicle || "").toLowerCase();
  const access = (tags.access || "").toLowerCase();
  if (motorVehicle === "no" || access === "no") return false;

  if (hw === "track") {
    return motorVehicle === "yes" || motorVehicle === "destination" || motorVehicle === "permissive";
  }

  const allowed = lean ? SCENIC_ROAD_INDEX_HIGHWAYS : DRIVABLE_HIGHWAYS;
  return allowed.has(hw);
}

export function haversineM(aLat, aLon, bLat, bLon) {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Shortest distance from point to line segment (lat/lon), in meters. */
export function distPointToSegmentM(lat, lon, aLat, aLon, bLat, bLon) {
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((lat * Math.PI) / 180);
  const px = lon * mPerDegLon;
  const py = lat * mPerDegLat;
  const ax = aLon * mPerDegLon;
  const ay = aLat * mPerDegLat;
  const bx = bLon * mPerDegLon;
  const by = bLat * mPerDegLat;
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return haversineM(lat, lon, aLat, aLon);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  const qLon = qx / mPerDegLon;
  const qLat = qy / mPerDegLat;
  return haversineM(lat, lon, qLat, qLon);
}

/**
 * @param {Array<[number, number, number, number]>} segments [lat1, lon1, lat2, lon2]
 */
export function buildSegmentGridIndex(segments, cellDeg = 0.0015) {
  const grid = {};
  for (let i = 0; i < segments.length; i++) {
    const [aLat, aLon, bLat, bLon] = segments[i];
    const minLat = Math.min(aLat, bLat);
    const maxLat = Math.max(aLat, bLat);
    const minLon = Math.min(aLon, bLon);
    const maxLon = Math.max(aLon, bLon);
    const i0 = Math.floor(minLat / cellDeg);
    const i1 = Math.floor(maxLat / cellDeg);
    const j0 = Math.floor(minLon / cellDeg);
    const j1 = Math.floor(maxLon / cellDeg);
    for (let gi = i0; gi <= i1; gi++) {
      for (let gj = j0; gj <= j1; gj++) {
        const key = `${gi}:${gj}`;
        if (!grid[key]) grid[key] = [];
        grid[key].push(i);
      }
    }
  }
  return { cellDeg, segments, grid };
}

export function nearestRoadDistanceM(lat, lon, index, opts = 3) {
  if (!index?.segments?.length) return null;
  const options = typeof opts === "number" ? { searchRadiusCells: opts } : opts;
  const { searchRadiusCells = 3, maxMeasureM = Infinity } = options;
  const { cellDeg, segments, grid } = index;
  const gi = Math.floor(lat / cellDeg);
  const gj = Math.floor(lon / cellDeg);
  let best = Infinity;
  const seen = new Set();
  for (let di = -searchRadiusCells; di <= searchRadiusCells; di++) {
    for (let dj = -searchRadiusCells; dj <= searchRadiusCells; dj++) {
      const arr = grid[`${gi + di}:${gj + dj}`];
      if (!arr) continue;
      for (const si of arr) {
        if (seen.has(si)) continue;
        seen.add(si);
        const [aLat, aLon, bLat, bLon] = segments[si];
        const d = distPointToSegmentM(lat, lon, aLat, aLon, bLat, bLon);
        if (d < best) best = d;
      }
    }
  }
  if (best === Infinity) return null;
  return best;
}

export function hasRoadAccess(lat, lon, index, maxDistanceM = DEFAULT_ROAD_MAX_DISTANCE_M) {
  const d = nearestRoadDistanceM(lat, lon, index);
  if (d == null) return false;
  return d <= maxDistanceM;
}