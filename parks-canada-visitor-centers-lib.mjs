/**
 * Shared helpers for Parks Canada visitor centers (VC-CA-001).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  GEO_PATH,
  PC_FACILITIES_QUERY,
  coordValid,
  fetchArcgisAllFeatures,
  loadPcUnitMaps,
  parkSlugFromPcUrl,
  readJson,
  resolveParentUnit,
  writeJson,
} from "./parks-canada-lib.mjs";
import { inferStateFromCoords } from "./camping-ca-geo-utils.mjs";

export const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const INGEST_DIR = path.join(TOOLS_DIR, "pc-vc-ca-ingest");
export const MASTER_PATH = path.join(TOOLS_DIR, "parks-canada-visitor-centers-ca-master.json");
export const QA_PATH = path.join(TOOLS_DIR, "parks-canada-visitor-centers-qa.json");
export const EMBED_PATH = path.join(TOOLS_DIR, "parks-canada-visitor-centers-ca-explorer-embed.js");

export {
  GEO_PATH,
  PC_FACILITIES_QUERY,
  coordValid,
  fetchArcgisAllFeatures,
  loadPcUnitMaps,
  parkSlugFromPcUrl,
  readJson,
  resolveParentUnit,
  writeJson,
};

export function slugify(s) {
  return (s || "visitor-centre")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export function vcId(parkCode, name, lat, lon) {
  const code = (parkCode || "pc").toLowerCase();
  const base = slugify(name) || "visitor-centre";
  const coord =
    Number.isFinite(lat) && Number.isFinite(lon)
      ? `${Math.round(lat * 1e4)}-${Math.round(Math.abs(lon) * 1e4)}`
      : "nocoord";
  return `VC-PC-${code}-${base}-${coord}`;
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
    .replace(/\bvisitor centre\b/g, "")
    .replace(/\bvisitor center\b/g, "")
    .replace(/\binformation\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function matchKey(parkCode, name) {
  return `${(parkCode || "").toLowerCase()}::${normalizeName(name) || "visitor-centre"}`;
}

export function ensureIngestDir(step) {
  const d = path.join(INGEST_DIR, step);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function resolveVisitorCenterProvince({ state, lat, lon, parkCode, parkProvinces }) {
  if (state) return state;
  const code = (parkCode || "").toLowerCase();
  if (code && parkProvinces[code]) return parkProvinces[code];
  return inferStateFromCoords(lat, lon);
}

export function baseRecord(p) {
  return {
    id: p.id,
    name: p.name || "Visitor Centre",
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

export function stateByParkCode() {
  const geo = readJson(GEO_PATH, { units: [] });
  const map = {};
  for (const u of geo.units || []) map[u.parkCode.toLowerCase()] = u.state;
  return map;
}
