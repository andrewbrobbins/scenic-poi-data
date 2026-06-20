import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fetchArcgisAllFeatures, readJson, writeJson } from "./camping-us-lib.mjs";

export const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const INGEST_DIR = path.join(TOOLS_DIR, "nps-vc-us-ingest");
export const MASTER_PATH = path.join(TOOLS_DIR, "nps-visitor-centers-us-master.json");
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
