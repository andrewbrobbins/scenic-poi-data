/**
 * Map pin placement from park boundary polygons.
 * Default: bbox centroid per boundary section; distant sections → multiple pins.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const tools = path.dirname(fileURLToPath(import.meta.url));
export const BOUNDARIES_PATH = path.join(tools, "park-boundaries.geojson");
export const NPS_PIN_OVERRIDES_PATH = path.join(tools, "nps-park-pin-overrides.json");

/** Drop specks below this bbox-area (deg²) — keep in sync with build-park-boundaries.mjs */
export const MIN_SECTION_AREA_DEG2 = 0.000003;
/** Secondary section must be at least this share of the largest section area. */
export const MIN_SECTION_AREA_RATIO = 0.035;
/** Sections/clusters farther apart than this (km) get separate map pins. */
export const MULTI_PIN_MIN_DISTANCE_KM = 18;

export function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function ringBboxArea(ring) {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const [lon, lat] of ring) {
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lon < west) west = lon;
    if (lon > east) east = lon;
  }
  if (!Number.isFinite(south)) return 0;
  return (north - south) * (east - west);
}

/** Bbox center of the outer ring (matches Parks Canada catalog convention). */
export function sectionCentroid(polyCoords) {
  const ring = polyCoords?.[0];
  if (!ring?.length) return null;
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const [lon, lat] of ring) {
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lon < west) west = lon;
    if (lon > east) east = lon;
  }
  if (!Number.isFinite(south)) return null;
  return { lat: (south + north) / 2, lon: (west + east) / 2, areaDeg2: ringBboxArea(ring) };
}

export function sectionsFromGeometry(geometry) {
  if (!geometry) return [];
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates || [];
  const raw = [];
  for (let i = 0; i < polys.length; i++) {
    const cen = sectionCentroid(polys[i]);
    if (!cen || cen.areaDeg2 < MIN_SECTION_AREA_DEG2) continue;
    raw.push({ sectionIndex: i, ...cen });
  }
  if (!raw.length) return [];
  raw.sort((a, b) => b.areaDeg2 - a.areaDeg2);
  const mainArea = raw[0].areaDeg2;
  return raw.filter((s) => s.areaDeg2 >= mainArea * MIN_SECTION_AREA_RATIO || s.areaDeg2 === mainArea);
}

function clusterSections(sections, minDistanceKm) {
  if (sections.length <= 1) return sections.length ? [sections] : [];
  const sorted = [...sections].sort((a, b) => b.areaDeg2 - a.areaDeg2);
  const clusters = [];
  for (const sec of sorted) {
    let placed = false;
    for (const cluster of clusters) {
      if (cluster.some((c) => haversineKm(sec, c) < minDistanceKm)) {
        cluster.push(sec);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([sec]);
  }
  return clusters;
}

function weightedCentroid(cluster) {
  let w = 0;
  let lat = 0;
  let lon = 0;
  for (const s of cluster) {
    w += s.areaDeg2;
    lat += s.lat * s.areaDeg2;
    lon += s.lon * s.areaDeg2;
  }
  if (!w) return { lat: cluster[0].lat, lon: cluster[0].lon };
  return { lat: lat / w, lon: lon / w };
}

const UNIT_LABEL_RE =
  /\b(north|south|east|west|central)\s+unit\b|\belkhorn(?:\s+ranch)?\b|\bisland\b|\bmainland\b|\bma(?:in)?\s+island\b/i;

function labelFromVcName(name) {
  const n = (name || "").trim();
  const m = n.match(UNIT_LABEL_RE);
  if (m) {
    const hit = m[0].replace(/\s+/g, " ");
    return hit.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (/north unit/i.test(n)) return "North Unit";
  if (/south unit/i.test(n)) return "South Unit";
  if (/elkhorn/i.test(n)) return "Elkhorn Ranch Unit";
  return "";
}

function assignClusterLabels(clusters, visitorCenters, overrideLabels) {
  const labels = clusters.map((_, i) => overrideLabels?.[String(i)] || overrideLabels?.[i] || "");
  const used = new Set(labels.filter(Boolean));

  if (visitorCenters?.length) {
    const named = visitorCenters
      .map((vc) => ({
        label: labelFromVcName(vc.name),
        lat: vc.lat ?? vc.latitude,
        lon: vc.lon ?? vc.longitude,
      }))
      .filter((v) => v.label && Number.isFinite(v.lat) && Number.isFinite(v.lon));

    for (const vc of named) {
      let bestIdx = -1;
      let bestD = Infinity;
      for (let i = 0; i < clusters.length; i++) {
        if (labels[i]) continue;
        const c = weightedCentroid(clusters[i]);
        const d = haversineKm(vc, c);
        if (d < bestD && d <= 80) {
          bestD = d;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0 && !used.has(vc.label)) {
        labels[bestIdx] = vc.label;
        used.add(vc.label);
      }
    }
  }

  const sortedIdx = clusters
    .map((cl, i) => ({ i, lat: weightedCentroid(cl).lat }))
    .sort((a, b) => b.lat - a.lat);
  let areaNum = 1;
  for (const { i } of sortedIdx) {
    if (!labels[i]) {
      labels[i] = clusters.length > 1 ? `Area ${areaNum}` : "";
      areaNum++;
    }
  }
  return labels;
}

/**
 * @param {object} feature GeoJSON boundary feature
 * @param {object} [opts]
 * @param {string} [opts.parkCode]
 * @param {object} [opts.overrides] entry from nps-park-pin-overrides.json
 * @param {object[]} [opts.visitorCenters]
 */
export function computeMapPinsFromFeature(feature, opts = {}) {
  const parkCode = (opts.parkCode || feature?.properties?.parkCode || "").toLowerCase();
  const overrides = opts.overrides || {};
  const sections = sectionsFromGeometry(feature?.geometry);
  const clusters = clusterSections(sections, MULTI_PIN_MIN_DISTANCE_KM);
  const labels = assignClusterLabels(clusters, opts.visitorCenters, overrides.pinLabels);

  const pins = clusters.map((cluster, i) => {
    const cen = weightedCentroid(cluster);
    const role = i === 0 ? "primary" : "secondary";
    const label = labels[i] || "";
    const slug = label
      ? label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24)
      : `area-${i + 1}`;
    return {
      id: `${parkCode}-${slug}`,
      label,
      lat: Math.round(cen.lat * 1e5) / 1e5,
      lon: Math.round(cen.lon * 1e5) / 1e5,
      role,
      clusterIndex: i,
      sectionCount: cluster.length,
      sectionIndices: cluster.map((s) => s.sectionIndex),
      areaDeg2: cluster.reduce((n, s) => n + s.areaDeg2, 0),
      labelSource: overrides.pinLabels?.[String(i)] || overrides.pinLabels?.[i] ? "override" : label ? "visitor_center_or_heuristic" : "heuristic",
    };
  });

  for (const extra of overrides.extraPins || []) {
    if (!Number.isFinite(extra.lat) || !Number.isFinite(extra.lon)) continue;
    pins.push({
      id: extra.id || `${parkCode}-${extra.label || "extra"}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
      label: extra.label || "Additional unit",
      lat: Math.round(extra.lat * 1e5) / 1e5,
      lon: Math.round(extra.lon * 1e5) / 1e5,
      role: "secondary",
      clusterIndex: pins.length,
      sectionCount: 0,
      sectionIndices: [],
      areaDeg2: 0,
      labelSource: extra.source || "manual_override",
    });
  }

  pins.sort((a, b) => {
    if (a.role === "primary") return -1;
    if (b.role === "primary") return 1;
    return b.lat - a.lat;
  });

  const strategy = pins.length > 1 ? "multi_pin" : pins.length === 1 ? "single" : "none";

  return {
    parkCode,
    strategy,
    pinCount: pins.length,
    pins,
    primary: pins.find((p) => p.role === "primary") || pins[0] || null,
  };
}

export function loadBoundaryIndex(boundariesPath = BOUNDARIES_PATH) {
  if (!fs.existsSync(boundariesPath)) return { byCode: new Map(), byCaCode: new Map(), fc: null };
  const fc = JSON.parse(fs.readFileSync(boundariesPath, "utf8"));
  const byCode = new Map();
  const byCaCode = new Map();
  for (const f of fc.features || []) {
    const code = (f.properties?.parkCode || "").toLowerCase();
    if (!code) continue;
    if (f.properties?.country === "CA") byCaCode.set(code, f);
    else byCode.set(code, f);
  }
  return { byCode, byCaCode, fc };
}

export function loadPinOverrides(path = NPS_PIN_OVERRIDES_PATH) {
  if (!fs.existsSync(path)) return {};
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

export function buildPinCatalog({ country = "US", boundaryIndex, overrides, visitorCentersByPark } = {}) {
  const idx = boundaryIndex || loadBoundaryIndex();
  const ovr = overrides ?? loadPinOverrides();
  const map = country === "CA" ? idx.byCaCode : idx.byCode;
  const catalog = {};

  for (const [parkCode, feature] of map) {
    const vcs = visitorCentersByPark?.[parkCode] || [];
    catalog[parkCode] = computeMapPinsFromFeature(feature, {
      parkCode,
      overrides: ovr[parkCode],
      visitorCenters: vcs,
    });
  }
  return catalog;
}
