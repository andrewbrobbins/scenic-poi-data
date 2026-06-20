import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fetchArcgisAllFeatures, readJson, writeJson } from "./camping-us-lib.mjs";

export const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const INGEST_DIR = path.join(TOOLS_DIR, "nps-vc-us-ingest");
export const MASTER_PATH = path.join(TOOLS_DIR, "nps-visitor-centers-us-master.json");
export const QA_PATH = path.join(TOOLS_DIR, "nps-visitor-centers-qa.json");
export const EMBED_PATH = path.join(TOOLS_DIR, "nps-visitor-centers-us-explorer-embed.js");
export const NPS_GEO_PATH = path.join(TOOLS_DIR, "nps-us-geo.json");
export const ARCGIS_POI_QUERY =
  "https://mapservices.nps.gov/arcgis/rest/services/NationalDatasets/NPS_Public_POIs/FeatureServer/0/query";
export const NPS_API_BASE = "https://developer.nps.gov/api/v1";

export function loadEnvFile() {
  for (const p of [path.join(TOOLS_DIR, ".env"), path.join(TOOLS_DIR, "..", ".env")]) {
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  }
}

/** True when a non-empty NPS_API_KEY is available (env or .env). */
export function hasNpsApiKey() {
  loadEnvFile();
  return Boolean((process.env.NPS_API_KEY || "").trim());
}

export function slugify(s) {
  return (s || "visitor-center")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export function vcId(parkCode, name, lat, lon) {
  const code = (parkCode || "unk").toUpperCase();
  const base = slugify(name) || "visitor-center";
  const coord =
    Number.isFinite(lat) && Number.isFinite(lon)
      ? `${Math.round(lat * 1e4)}-${Math.round(Math.abs(lon) * 1e4)}`
      : "nocoord";
  return `VC-NPS-${code}-${base}-${coord}`;
}

export function coordValid(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat === 0 && lon === 0) return false;
  if (lat < 18 || lat > 72 || lon < -180 || lon > -65) return false;
  return true;
}

export function haversineM(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function normalizeName(name) {
  return (name || "")
    .toLowerCase()
    .replace(/\bvisitor center\b/g, "")
    .replace(/\bcontact station\b/g, "")
    .replace(/\binformation\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function matchKey(parkCode, name) {
  return `${(parkCode || "").toLowerCase()}::${normalizeName(name) || "visitor-center"}`;
}

export function ensureIngestDir(step) {
  const d = path.join(INGEST_DIR, step);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export { fetchArcgisAllFeatures, readJson, writeJson };

export function loadNpsUnitMaps() {
  const geo = readJson(NPS_GEO_PATH, { units: [] });
  const byCode = new Map();
  const aliasToPrimary = new Map();
  const units = geo.units || [];

  for (const u of units) {
    byCode.set(u.parkCode.toLowerCase(), u);
  }

  const byParkName = new Map();
  for (const u of units) {
    const key = (u.name || "")
      .replace(/\s*&\s*preserve$/i, "")
      .replace(/\s*national (park|monument|memorial|preserve|historical park|historic site|recreation area).*$/i, "")
      .trim()
      .toLowerCase();
    if (!key) continue;
    if (!byParkName.has(key)) byParkName.set(key, u.parkCode.toLowerCase());
  }

  for (const u of units) {
    if (u.category !== "preserve") continue;
    const parkKey = (u.name || "")
      .replace(/\s*national preserve$/i, "")
      .trim()
      .toLowerCase();
    const primaryCode = byParkName.get(parkKey);
    if (primaryCode && primaryCode !== u.parkCode.toLowerCase()) {
      aliasToPrimary.set(u.parkCode.toLowerCase(), primaryCode);
    }
  }

  return { byCode, aliasToPrimary };
}

export function resolveParentUnit(parkCode, maps) {
  const code = (parkCode || "").toLowerCase();
  const primaryCode = maps.aliasToPrimary.get(code) || code;
  const unit = maps.byCode.get(primaryCode);
  if (!unit) {
    return {
      system: "nps",
      parkCode: primaryCode,
      name: primaryCode.toUpperCase(),
      designation: "",
      category: "other",
    };
  }
  return {
    system: "nps",
    parkCode: unit.parkCode,
    name: unit.name,
    designation: unit.designation || "",
    category: unit.category || "other",
  };
}

export function normalizeOperatingHours(apiHours) {
  if (!Array.isArray(apiHours) || !apiHours.length) return [];
  return apiHours.map((block) => ({
    name: block.name || "Operating Hours",
    description: block.description || "",
    standardHours: block.standardHours || null,
    exceptions: (block.exceptions || []).map((ex) => ({
      name: ex.name || "",
      startDate: ex.startDate || "",
      endDate: ex.endDate || "",
      hours: ex.exceptionHours || null,
    })),
    source: "nps-api",
  }));
}

export function summarizeHours(operatingHours) {
  if (!operatingHours?.length) return { hasHours: false, summary: "", seasonalNote: "" };
  const block = operatingHours[0];
  const std = block.standardHours || {};
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const values = days.map((d) => std[d]).filter(Boolean);
  const unique = [...new Set(values)];
  let summary = unique.length === 1 ? unique[0] : unique.length ? unique.join("; ") : "";
  if (block.exceptions?.length) {
    const seasonal = block.exceptions
      .map((ex) => {
        const label = ex.name || `${ex.startDate || ""}–${ex.endDate || ""}`.replace(/^–$/, "");
        const hrs = ex.hours ? Object.values(ex.hours)[0] : "";
        return hrs ? `${label}: ${hrs}` : label;
      })
      .filter(Boolean)
      .slice(0, 4);
    return {
      hasHours: Boolean(summary || seasonal.length),
      summary,
      seasonalNote: seasonal.join(" | "),
    };
  }
  return { hasHours: Boolean(summary), summary, seasonalNote: "" };
}

export function seasonFromArcgis(attrs) {
  const seasonal = (attrs?.SEASONAL || "").trim();
  const desc = (attrs?.SEASDESC || "").trim();
  if (seasonal === "Yes") {
    return { isSeasonal: true, description: desc || "Seasonal operation", source: "nps-arcgis-poi" };
  }
  if (seasonal === "No") {
    return { isSeasonal: false, description: desc || "Year-round", source: "nps-arcgis-poi" };
  }
  if (desc) {
    return { isSeasonal: true, description: desc, source: "nps-arcgis-poi" };
  }
  return { isSeasonal: null, description: "", source: "nps-arcgis-poi" };
}

/** @param {object} p */
export function baseRecord(p) {
  return {
    id: p.id,
    name: p.name || "Visitor Center",
    facilityType: p.facilityType || "visitor_center",
    parkCode: p.parkCode || "",
    parentUnit: p.parentUnit || null,
    state: p.state || "",
    lat: p.lat,
    lon: p.lon,
    coordSource: p.coordSource,
    coordConfidence: p.coordConfidence || "medium",
    seasonal: p.seasonal || { isSeasonal: null, description: "", source: "" },
    operatingHours: p.operatingHours || [],
    hoursSummary: p.hoursSummary || { hasHours: false, summary: "", seasonalNote: "" },
    phones: p.phones || [],
    emails: p.emails || [],
    urls: p.urls || {},
    sourceIds: p.sourceIds || {},
    verification: p.verification || {
      arcgisDistanceM: null,
      osmDistanceM: null,
      osmId: null,
      needsReview: false,
      reviewReasons: [],
    },
    needsReview: false,
    reviewReasons: [],
    mapFlags: [],
    status: p.status || "active",
    ingestSource: p.ingestSource || "",
    verifiedAt: new Date().toISOString().slice(0, 10),
  };
}

export function addReview(record, reason, mapFlag) {
  record.needsReview = true;
  record.verification.needsReview = true;
  if (!record.reviewReasons.includes(reason)) record.reviewReasons.push(reason);
  if (!record.verification.reviewReasons.includes(reason)) record.verification.reviewReasons.push(reason);
  if (mapFlag && !record.mapFlags.includes(mapFlag)) record.mapFlags.push(mapFlag);
}

export function clearReview(record, reason, mapFlag) {
  record.reviewReasons = (record.reviewReasons || []).filter((r) => r !== reason);
  record.verification.reviewReasons = (record.verification.reviewReasons || []).filter((r) => r !== reason);
  if (mapFlag) record.mapFlags = (record.mapFlags || []).filter((f) => f !== mapFlag);
  record.needsReview = record.reviewReasons.length > 0;
  record.verification.needsReview = record.needsReview;
}

/** Approximate US state/territory centroids for coord fallback (affiliated areas, etc.). */
const US_STATE_CENTROIDS = [
  ["AL", 32.8, -86.8],
  ["AK", 64.2, -152.5],
  ["AZ", 34.3, -111.7],
  ["AR", 34.8, -92.2],
  ["CA", 37.2, -119.5],
  ["CO", 39.0, -105.5],
  ["CT", 41.6, -72.7],
  ["DE", 39.0, -75.5],
  ["DC", 38.9, -77.0],
  ["FL", 28.6, -82.4],
  ["GA", 32.7, -83.4],
  ["HI", 20.8, -156.3],
  ["ID", 44.4, -114.6],
  ["IL", 40.0, -89.2],
  ["IN", 39.9, -86.3],
  ["IA", 42.0, -93.5],
  ["KS", 38.5, -98.4],
  ["KY", 37.8, -85.7],
  ["LA", 31.0, -92.0],
  ["ME", 45.4, -69.2],
  ["MD", 39.0, -76.8],
  ["MA", 42.3, -71.8],
  ["MI", 44.3, -85.4],
  ["MN", 46.3, -94.3],
  ["MS", 32.7, -89.7],
  ["MO", 38.4, -92.5],
  ["MT", 47.0, -109.6],
  ["NE", 41.5, -99.8],
  ["NV", 39.3, -116.6],
  ["NH", 43.7, -71.6],
  ["NJ", 40.1, -74.7],
  ["NM", 34.4, -106.1],
  ["NY", 42.9, -75.5],
  ["NC", 35.5, -79.4],
  ["ND", 47.5, -100.5],
  ["OH", 40.4, -82.8],
  ["OK", 35.6, -97.5],
  ["OR", 44.0, -120.5],
  ["PA", 40.9, -77.8],
  ["RI", 41.7, -71.5],
  ["SC", 33.9, -80.9],
  ["SD", 44.4, -100.2],
  ["TN", 35.8, -86.3],
  ["TX", 31.5, -99.4],
  ["UT", 39.3, -111.7],
  ["VT", 44.1, -72.7],
  ["VA", 37.5, -78.7],
  ["WA", 47.4, -120.5],
  ["WV", 38.9, -80.5],
  ["WI", 44.6, -89.8],
  ["WY", 43.0, -107.5],
  ["PR", 18.2, -66.5],
  ["VI", 18.3, -64.8],
  ["GU", 13.4, 144.7],
  ["AS", -14.3, -170.7],
  ["MP", 15.2, 145.7],
];

export function inferStateFromCoords(lat, lon) {
  if (!coordValid(lat, lon)) return "";
  let best = "";
  let bestD = Infinity;
  for (const [code, clat, clon] of US_STATE_CENTROIDS) {
    const d = haversineM({ lat, lon }, { lat: clat, lon: clon });
    if (d < bestD) {
      bestD = d;
      best = code;
    }
  }
  return best;
}

/** Resolve two-letter state for a visitor center record. */
export function resolveVisitorCenterState({ state, lat, lon, parkCode, parkStates = {} }) {
  if (state) return state.split(",")[0].trim();
  const code = (parkCode || "").toLowerCase();
  if (code && parkStates[code]) return parkStates[code].split(",")[0].trim();
  return inferStateFromCoords(lat, lon);
}

export function applyVisitorCenterState(record, parkStates) {
  const resolved = resolveVisitorCenterState({
    state: record.state,
    lat: record.lat,
    lon: record.lon,
    parkCode: record.parkCode || record.parentUnit?.parkCode,
    parkStates,
  });
  if (!resolved) return false;
  record.state = resolved;
  if (record.reviewReasons?.includes("missing-state")) {
    clearReview(record, "missing-state", "NO_STATE");
  }
  return true;
}
