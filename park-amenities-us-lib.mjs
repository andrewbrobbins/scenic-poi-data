/**
 * Shared helpers for US park amenities (NPS + state/provincial parents).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fetchArcgisAllFeatures, readJson, writeJson } from "./camping-us-lib.mjs";
import {
  ARCGIS_POI_QUERY,
  coordValid,
  loadNpsUnitMaps,
  resolveParentUnit,
  resolveVisitorCenterState,
  slugify,
  NPS_GEO_PATH,
} from "./nps-visitor-centers-lib.mjs";

export { NPS_GEO_PATH };

export const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const POI_TYPES_PATH = path.join(TOOLS_DIR, "park-amenities-nps-poi-types.json");
export const INGEST_DIR = path.join(TOOLS_DIR, "park-amenities-us-ingest");
export const MASTER_PATH = path.join(TOOLS_DIR, "park-amenities-us-master.json");
export const ROLLUP_PATH = path.join(TOOLS_DIR, "park-amenities-us-rollup.json");
export const QA_PATH = path.join(TOOLS_DIR, "park-amenities-us-qa.json");
export const EMBED_PATH = path.join(TOOLS_DIR, "park-amenities-us-explorer-embed.js");

export const CAMP_TIERS = ["developed", "backcountry", "primitive"];
export const AMENITY_KINDS = ["campground", "picnic_area", "restroom"];

export { fetchArcgisAllFeatures, readJson, writeJson, coordValid, loadNpsUnitMaps, resolveParentUnit };

export function ensureIngestDir(step) {
  const d = path.join(INGEST_DIR, step);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function loadPoiTypeConfig() {
  return readJson(POI_TYPES_PATH);
}

export function allNpsPoiTypes(config = loadPoiTypeConfig()) {
  const types = new Set();
  for (const tier of CAMP_TIERS) {
    for (const t of config.campground?.[tier] || []) types.add(t);
  }
  for (const t of config.campground?.ambiguous || []) types.add(t);
  for (const t of config.picnic_area?.types || []) types.add(t);
  for (const t of config.restroom?.types || []) types.add(t);
  return [...types];
}

/** @returns {{ kind: string, campTier?: string, subtype: string } | null} */
export function classifyNpsPoiType(poiType, name = "", config = loadPoiTypeConfig()) {
  const pt = (poiType || "").trim();
  if (!pt) return null;

  for (const tier of CAMP_TIERS) {
    if ((config.campground?.[tier] || []).includes(pt)) {
      return { kind: "campground", campTier: tier, subtype: tierSubtypeFromName(pt, tier, name) };
    }
  }
  if ((config.campground?.ambiguous || []).includes(pt)) {
    const inferred = inferCampTierFromName(name);
    return {
      kind: "campground",
      campTier: inferred,
      subtype: inferred,
    };
  }
  if ((config.picnic_area?.types || []).includes(pt)) {
    return {
      kind: "picnic_area",
      subtype: config.picnic_area.subtypes?.[pt] || "area",
    };
  }
  if ((config.restroom?.types || []).includes(pt)) {
    return {
      kind: "restroom",
      subtype: config.restroom.subtypes?.[pt] || "restroom",
    };
  }
  return null;
}

function tierSubtypeFromName(poiType, tier, name) {
  const n = (name || "").toLowerCase();
  if (/group/i.test(poiType) || /group/i.test(n)) return "group";
  if (/rv/i.test(poiType) || /\brv\b/i.test(n)) return "rv";
  if (/cabin/i.test(poiType) || /cabin/i.test(n)) return "cabin";
  if (/walk.?in|backcountry|wilderness|dispersed/i.test(n)) return "walk_in";
  return tier;
}

function inferCampTierFromName(name) {
  const n = (name || "").toLowerCase();
  if (/backcountry|wilderness|walk.?in|dispersed/i.test(n)) return "backcountry";
  if (/primitive|dispersed/i.test(n)) return "primitive";
  return "developed";
}

export function buildPoiTypeWhere(types) {
  return types.map((t) => `POITYPE='${String(t).replace(/'/g, "''")}'`).join(" OR ");
}

export function stateByParkCode() {
  const geo = readJson(NPS_GEO_PATH, { units: [] });
  const map = {};
  for (const u of geo.units || []) map[u.parkCode.toLowerCase()] = u.state;
  return map;
}

export function amenityId(parkCode, kind, campTier, name, lat, lon) {
  const code = (parkCode || "unk").toUpperCase();
  const tier = kind === "campground" && campTier ? `-${campTier}` : "";
  const base = slugify(name) || kind;
  const coord =
    Number.isFinite(lat) && Number.isFinite(lon)
      ? `${Math.round(lat * 1e4)}-${Math.round(Math.abs(lon) * 1e4)}`
      : "nocoord";
  return `AMEN-NPS-${code}-${kind}${tier}-${base}-${coord}`;
}

export function normalizeAmenityName(name) {
  return (name || "")
    .toLowerCase()
    .replace(/\b(campground|camp|campsite|camping area|picnic area|restroom|toilet)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function matchKey(parkCode, kind, campTier, name) {
  const tier = kind === "campground" ? campTier || "" : "";
  return `${(parkCode || "").toLowerCase()}::${kind}::${tier}::${normalizeAmenityName(name) || kind}`;
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

/** @param {object} p */
export function baseRecord(p) {
  const rec = {
    id: p.id,
    name: p.name || "Park amenity",
    kind: p.kind,
    subtype: p.subtype || "",
    landManager: p.landManager || "NPS",
    parkCode: p.parkCode || "",
    parentUnit: p.parentUnit ?? null,
    state: p.state || "",
    lat: p.lat,
    lon: p.lon,
    coordSource: p.coordSource,
    coordConfidence: p.coordConfidence || "medium",
    needsReview: false,
    reviewReasons: [],
    mapFlags: [],
    urls: p.urls || {},
    sourceIds: p.sourceIds || {},
    status: p.status || "active",
    ingestSource: p.ingestSource || "",
    verifiedAt: new Date().toISOString().slice(0, 10),
  };
  if (p.kind === "campground") {
    rec.campTier = p.campTier || "developed";
  }
  return rec;
}

export function addReview(record, reason, mapFlag) {
  record.needsReview = true;
  if (!record.reviewReasons.includes(reason)) record.reviewReasons.push(reason);
  if (mapFlag && !record.mapFlags.includes(mapFlag)) record.mapFlags.push(mapFlag);
}

export function resolveState(record, parkStates) {
  const resolved = resolveVisitorCenterState({
    state: record.state,
    lat: record.lat,
    lon: record.lon,
    parkCode: record.parkCode || record.parentUnit?.parkCode,
    parkStates,
  });
  if (resolved) record.state = resolved;
  return resolved;
}

export function emptyCampgroundRollup() {
  return {
    developed: { has: false, count: 0 },
    backcountry: { has: false, count: 0 },
    primitive: { has: false, count: 0 },
  };
}

export function emptyKindRollup() {
  return { has: false, count: 0 };
}
