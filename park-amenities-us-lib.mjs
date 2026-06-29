/**
 * US park amenities paths + NPS-specific helpers.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fetchArcgisAllFeatures } from "./camping-us-lib.mjs";
import {
  CAMP_TIERS,
  AMENITY_KINDS,
  ACCESS_MODES,
  readJson,
  writeJson,
  slugify,
  coordValid,
  baseRecord,
  addReview,
  haversineM,
  normalizeAmenityName,
  amenityId,
  inferAccessFromCampTier,
  classifyAccessMode,
  applyAccessFields,
  applyInferredCampgroundAccess,
  dedupeAmenityRecords,
  emptyCampgroundRollup,
  emptyKindRollup,
  classifyCaCampTier,
  classifyOsmCampTier,
} from "./park-amenities-lib.mjs";
import {
  loadNpsUnitMaps,
  resolveParentUnit,
  resolveVisitorCenterState,
  NPS_GEO_PATH,
  ARCGIS_POI_QUERY,
} from "./nps-visitor-centers-lib.mjs";

export const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const POI_TYPES_PATH = path.join(TOOLS_DIR, "park-amenities-nps-poi-types.json");
export const STATE_SOURCES_PATH = path.join(TOOLS_DIR, "park-amenities-state-sources.json");
export const INGEST_DIR = path.join(TOOLS_DIR, "park-amenities-us-ingest");
export const MASTER_PATH = path.join(TOOLS_DIR, "park-amenities-us-master.json");
export const ROLLUP_PATH = path.join(TOOLS_DIR, "park-amenities-us-rollup.json");
export const QA_PATH = path.join(TOOLS_DIR, "park-amenities-us-qa.json");
export const EMBED_PATH = path.join(TOOLS_DIR, "park-amenities-us-explorer-embed.js");

export {
  CAMP_TIERS,
  AMENITY_KINDS,
  ACCESS_MODES,
  fetchArcgisAllFeatures,
  readJson,
  writeJson,
  slugify,
  coordValid,
  baseRecord,
  addReview,
  haversineM,
  normalizeAmenityName,
  amenityId,
  inferAccessFromCampTier,
  classifyAccessMode,
  applyAccessFields,
  applyInferredCampgroundAccess,
  dedupeAmenityRecords,
  emptyCampgroundRollup,
  emptyKindRollup,
  classifyCaCampTier,
  classifyOsmCampTier,
  loadNpsUnitMaps,
  resolveParentUnit,
  NPS_GEO_PATH,
  ARCGIS_POI_QUERY,
};

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
    return { kind: "campground", campTier: inferred, subtype: inferred };
  }
  if ((config.picnic_area?.types || []).includes(pt)) {
    return { kind: "picnic_area", subtype: config.picnic_area.subtypes?.[pt] || "area" };
  }
  if ((config.restroom?.types || []).includes(pt)) {
    return { kind: "restroom", subtype: config.restroom.subtypes?.[pt] || "restroom" };
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

export function npsAmenityId(parkCode, kind, campTier, name, lat, lon) {
  return amenityId("NPS", parkCode, kind, campTier, name, lat, lon);
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
