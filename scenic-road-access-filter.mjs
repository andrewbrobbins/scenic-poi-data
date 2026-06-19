import fs from "fs";
import path from "path";
import { createReadStream } from "fs";
import { pipeline } from "stream/promises";
import { Writable } from "stream";
import { distPointToSegmentM, isDrivableHighway, haversineM } from "./poi-road-network.mjs";
import { padDegForMeters, CLIPS_DIR, runOsmium } from "./scenic-osmium-lib.mjs";
import { pbfFilePath } from "./poi-osm-pbf-config.mjs";

const PATH_HIGHWAYS = new Set(["footway", "path", "cycleway", "bridleway", "pedestrian", "steps", "track"]);

export function isPathHighway(tags) {
  if (!tags?.highway) return false;
  if (!PATH_HIGHWAYS.has(tags.highway)) return false;
  const mv = (tags.motor_vehicle || "").toLowerCase();
  if (mv === "yes" || mv === "destination") return false;
  return true;
}

export function isParkingFeature(tags) {
  if (!tags) return false;
  if (tags.amenity === "parking") return true;
  if (tags.highway === "rest_area") return true;
  if (tags.rest_area === "yes") return true;
  if (tags.parking === "yes" || tags.parking === "surface" || tags.parking === "lane") return true;
  return false;
}

function nearestPointDistanceM(lat, lon, points) {
  let best = Infinity;
  for (const p of points) {
    const d = haversineM(lat, lon, p.lat, p.lon);
    if (d < best) best = d;
  }
  return best === Infinity ? null : Math.round(best * 10) / 10;
}

export function bruteNearestSegmentM(lat, lon, segments, { maxMeasureM = Infinity } = {}) {
  let best = Infinity;
  for (const s of segments) {
    if (Number.isFinite(maxMeasureM) && maxMeasureM < Infinity) {
      const dA = haversineM(lat, lon, s[0], s[1]);
      const dB = haversineM(lat, lon, s[2], s[3]);
      const segLen = haversineM(s[0], s[1], s[2], s[3]);
      const lowerBound = Math.max(0, Math.min(dA, dB) - segLen);
      if (lowerBound > maxMeasureM) continue;
    }
    const d = distPointToSegmentM(lat, lon, s[0], s[1], s[2], s[3]);
    if (d < best) best = d;
  }
  if (best === Infinity) return null;
  return Math.round(best * 10) / 10;
}

export async function parseClipFeatures(pbf) {
  const mod = await import("osm-pbf-parser");
  const parser = mod.default || mod;
  const nodeCoords = new Map();
  const leanSegments = [];
  const wideSegments = [];
  const pathSegments = [];
  const parkingPoints = [];

  await pipeline(
    createReadStream(pbf),
    parser(),
    new Writable({
      objectMode: true,
      write(chunks, _enc, cb) {
        for (const item of chunks) {
          if (item.type === "node") {
            nodeCoords.set(item.id, { lat: item.lat, lon: item.lon });
            if (isParkingFeature(item.tags)) parkingPoints.push({ lat: item.lat, lon: item.lon });
          } else if (item.type === "way") {
            const tags = item.tags || {};
            if (isParkingFeature(tags)) {
              for (const id of item.refs || []) {
                const c = nodeCoords.get(id);
                if (c) parkingPoints.push({ lat: c.lat, lon: c.lon });
              }
            }
            let prev = null;
            for (const id of item.refs || []) {
              const c = nodeCoords.get(id);
              if (!c) { prev = null; continue; }
              if (prev) {
                const seg = [prev.lat, prev.lon, c.lat, c.lon];
                if (isDrivableHighway(tags, { lean: true })) leanSegments.push(seg);
                if (isDrivableHighway(tags, { lean: false })) wideSegments.push(seg);
                if (isPathHighway(tags)) pathSegments.push(seg);
              }
              prev = c;
            }
          }
        }
        cb();
      },
    })
  );
  return { leanSegments, wideSegments, pathSegments, parkingPoints };
}

export async function measureRoadAccessFeatures(region, lat, lon, { padM = 600, srcPbf = null } = {}) {
  const pbf = srcPbf || pbfFilePath(region === "ca" ? "ca" : "us");
  const pad = padDegForMeters(padM, lat);
  const bbox = { minLat: lat - pad.lat, maxLat: lat + pad.lat, minLon: lon - pad.lon, maxLon: lon + pad.lon };
  const clipPath = path.join(CLIPS_DIR, "bench-exp", `${lat.toFixed(5)}-${Math.abs(lon).toFixed(5)}.osm.pbf`);
  fs.mkdirSync(path.dirname(clipPath), { recursive: true });
  runOsmium(`extract -b ${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat} "${pbf}" -o "${clipPath}" --overwrite`);
  const f = await parseClipFeatures(clipPath);
  try { fs.unlinkSync(clipPath); } catch { /* ignore */ }
  return {
    dLean: bruteNearestSegmentM(lat, lon, f.leanSegments),
    dWide: bruteNearestSegmentM(lat, lon, f.wideSegments),
    dPath: bruteNearestSegmentM(lat, lon, f.pathSegments),
    dParking: nearestPointDistanceM(lat, lon, f.parkingPoints),
  };
}

/**
 * Production filter (v3, cache-tolerant):
 * - Lean highway within max(maxM, 135m) — 135m covers parkway nodes offset from OSM centerline.
 * - Close parking (≤100m) → include.
 * - On foot path (dPath === 0) with no close parking → exclude.
 * - Within 50m of lean highway → include (roadside shoulder / pullout).
 * - Otherwise require foot path farther than 45m from viewpoint.
 */
export function scenicRoadAccessInclude(f, maxM = 120) {
  const leanCap = Math.max(maxM, 135);
  if (f.dLean == null || f.dLean > leanCap) return false;
  if (f.dParking != null && f.dParking <= 100) return true;
  if (f.dPath === 0) return false;
  if (f.dPath == null) return true;
  if (f.dLean <= 50) return true;
  return f.dPath > 45;
}

export const FILTER_STRATEGIES = {
  "A-distance-120": (f, maxM) => f.dLean != null && f.dLean <= maxM,
  "B-distance-80": (f) => f.dLean != null && f.dLean <= 80,
  "C-wide-60-and-lean-120": (f, maxM) => f.dLean != null && f.dLean <= maxM && f.dWide != null && f.dWide <= 60,
  "D-parking-within-100m": (f, maxM) => f.dLean != null && f.dLean <= maxM && f.dParking != null && f.dParking <= 100,
  "E-parking-within-150m": (f, maxM) => f.dLean != null && f.dLean <= maxM && f.dParking != null && f.dParking <= 150,
  "F-exclude-path-closer-than-road": (f, maxM) => {
    if (f.dLean == null || f.dLean > maxM) return false;
    if (f.dPath == null) return true;
    return f.dPath > f.dLean;
  },
  "G-exclude-path-within-50m": (f, maxM) => {
    if (f.dLean == null || f.dLean > maxM) return false;
    if (f.dPath == null) return true;
    return f.dPath > 50;
  },
  "H-exclude-path-40-unless-parking-80": (f, maxM) => {
    if (f.dLean == null || f.dLean > maxM) return false;
    if (f.dParking != null && f.dParking <= 80) return true;
    if (f.dPath == null) return true;
    return f.dPath > 40;
  },
  "I-exclude-path-45-unless-parking-100": (f, maxM) => {
    if (f.dLean == null || f.dLean > maxM) return false;
    if (f.dParking != null && f.dParking <= 100) return true;
    if (f.dPath == null) return true;
    return f.dPath > 45;
  },
  "J-path-ratio-0.7": (f, maxM) => {
    if (f.dLean == null || f.dLean > maxM) return false;
    if (f.dPath == null) return true;
    return f.dPath / f.dLean >= 0.7;
  },
  "K-wide-35-or-path-40-parking-80": (f, maxM) => {
    if (f.dLean == null || f.dLean > maxM) return false;
    if (f.dWide != null && f.dWide <= 35) return true;
    if (f.dParking != null && f.dParking <= 80) return true;
    if (f.dPath == null) return true;
    return f.dPath > 40;
  },
  "L-production-filter-v3": scenicRoadAccessInclude,
  "L-production-filter-v2": (f, maxM) => {
    if (f.dLean == null || f.dLean > maxM) return false;
    if (f.dParking != null && f.dParking <= 100) return true;
    if (f.dPath == null) return true;
    return f.dPath > 45;
  },
  "M-wide-required-50": (f, maxM) => f.dLean != null && f.dLean <= maxM && f.dWide != null && f.dWide <= 50,
};