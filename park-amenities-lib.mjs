/**
 * Shared park amenities schema, access classification, merge helpers.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { readJson as readJsonCamping, writeJson as writeJsonCamping, slugify as slugifyCamping, coordValid as coordValidUs } from "./camping-us-lib.mjs";

export const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));

export const CAMP_TIERS = ["developed", "backcountry", "primitive"];
export const AMENITY_KINDS = [
  "campground",
  "campsite",
  "picnic_area",
  "restroom",
  "parking",
  "visitor_center",
];
export const ACCESS_MODES = ["road", "trail", "unknown"];

/** Meters — campsite considered road-adjacent when within this distance of a vehicle highway. */
export const ACCESS_ROAD_MAX_M = 120;
/** Meters — campsite considered trail-adjacent when within this distance of a hiking trail way. */
export const ACCESS_TRAIL_MAX_M = 120;

export function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  const raw = fs.readFileSync(filePath);
  if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
    return JSON.parse(raw.toString("utf16le"));
  }
  return JSON.parse(raw.toString("utf8"));
}

export function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

export { slugifyCamping as slugify };
export { coordValidUs as coordValid };

export function haversineM(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function normalizeAmenityName(name) {
  return (name || "")
    .toLowerCase()
    .replace(/\b(campground|camp|campsite|camping area|picnic area|restroom|toilet)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function amenityId(prefix, parentKey, kind, campTier, name, lat, lon) {
  const pk = String(parentKey || "unk").toUpperCase().slice(0, 12);
  const tier = kind === "campground" && campTier ? `-${campTier}` : "";
  const base = slugifyCamping(name) || kind;
  const coord =
    Number.isFinite(lat) && Number.isFinite(lon)
      ? `${Math.round(lat * 1e4)}-${Math.round(Math.abs(lon) * 1e4)}`
      : "nocoord";
  return `AMEN-${prefix}-${pk}-${kind}${tier}-${base}-${coord}`;
}

/** @param {object} p */
export function baseRecord(p) {
  const rec = {
    id: p.id,
    name: p.name || "Park amenity",
    kind: p.kind,
    subtype: p.subtype || "",
    country: p.country || "US",
    landManager: p.landManager || "",
    parkCode: p.parkCode || "",
    parentUnit: p.parentUnit ?? null,
    state: p.state || "",
    lat: p.lat,
    lon: p.lon,
    coordSource: p.coordSource,
    coordConfidence: p.coordConfidence || "medium",
    accessMode: p.accessMode || "unknown",
    accessConfidence: p.accessConfidence || "unknown",
    roadDistanceM: p.roadDistanceM ?? null,
    trailDistanceM: p.trailDistanceM ?? null,
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

export function inferAccessFromCampTier(rec) {
  if (rec.kind !== "campground") return { accessMode: "unknown", accessConfidence: "unknown" };
  if (rec.campTier === "developed") return { accessMode: "road", accessConfidence: "inferred" };
  if (rec.campTier === "backcountry" || rec.campTier === "primitive") {
    return { accessMode: "trail", accessConfidence: "inferred" };
  }
  return { accessMode: "unknown", accessConfidence: "inferred" };
}

/**
 * Classify road vs trail access from measured distances (campgrounds) or leave unknown.
 */
export function classifyAccessMode(rec) {
  const road = rec.roadDistanceM;
  const trail = rec.trailDistanceM;
  const roadOk = Number.isFinite(road) && road <= ACCESS_ROAD_MAX_M;
  const trailOk = Number.isFinite(trail) && trail <= ACCESS_TRAIL_MAX_M;

  if (rec.kind !== "campground") {
    return { accessMode: "unknown", accessConfidence: rec.accessConfidence || "unknown" };
  }

  if (roadOk && trailOk) {
    if (road <= trail) {
      return {
        accessMode: "road",
        accessConfidence: trail <= road + 30 ? "medium" : "high",
      };
    }
    return {
      accessMode: "trail",
      accessConfidence: road <= trail + 30 ? "medium" : "high",
    };
  }
  if (roadOk) return { accessMode: "road", accessConfidence: "high" };
  if (trailOk) return { accessMode: "trail", accessConfidence: "high" };

  if (Number.isFinite(road) && Number.isFinite(trail) && road > ACCESS_ROAD_MAX_M && trail > ACCESS_TRAIL_MAX_M) {
    return { accessMode: "unknown", accessConfidence: "measured_far" };
  }

  return inferAccessFromCampTier(rec);
}

export function applyAccessFields(rec) {
  const { accessMode, accessConfidence } = classifyAccessMode(rec);
  rec.accessMode = accessMode;
  if (accessConfidence !== "unknown" || rec.accessConfidence === "unknown") {
    rec.accessConfidence = accessConfidence;
  }
  if (rec.kind === "campground" && accessMode === "unknown" && accessConfidence === "measured_far") {
    addReview(rec, "camp-access-far-from-road-and-trail", "ACCESS_FAR");
  }
}

export function applyInferredCampgroundAccess(rec) {
  if (rec.kind !== "campground") return;
  const inf = inferAccessFromCampTier(rec);
  if (!rec.accessMode || rec.accessMode === "unknown") rec.accessMode = inf.accessMode;
  if (!rec.accessConfidence || rec.accessConfidence === "unknown") {
    rec.accessConfidence = inf.accessConfidence;
  }
}

export function classifyCaCampTier(type, subtype, name) {
  const blob = `${type || ""} ${subtype || ""} ${name || ""}`.toLowerCase();
  if (/primitive|dispersed|undesignated/.test(blob)) return "primitive";
  if (/backcountry|walk.?in|hike.?in|wilderness|pack.?in|boat.?in/.test(blob)) return "backcountry";
  if (/developed|family|group|rv|standard/.test(blob)) return "developed";
  return "developed";
}

export function classifyOsmCampTier(tags) {
  const cs = (tags.camp_site || tags["camp_site:type"] || "").toLowerCase();
  if (/dispersed|wild|backcountry|basic/.test(cs)) return "backcountry";
  if (/primitive/.test(cs)) return "primitive";
  if (/serviced|standard|deluxe/.test(cs)) return "developed";
  const name = (tags.name || "").toLowerCase();
  if (/backcountry|walk.?in|wilderness|dispersed/.test(name)) return "backcountry";
  if (/primitive/.test(name)) return "primitive";
  return "developed";
}

export function parentFromStatePark(p) {
  return {
    system: p.country === "CA" ? "state_park_ca" : "state_park_us",
    id: p.id != null ? String(p.id) : "",
    parkCode: p.officialCode != null ? String(p.officialCode) : p.id != null ? String(p.id) : "",
    name: p.displayName || p.name,
    catalogName: p.name,
    designation: p.designation || "",
    category: p.category || "park",
    state: p.state,
  };
}

export function emptyCampgroundRollup() {
  return {
    developed: { has: false, count: 0, road: 0, trail: 0 },
    backcountry: { has: false, count: 0, road: 0, trail: 0 },
    primitive: { has: false, count: 0, road: 0, trail: 0 },
  };
}

export function emptyKindRollup() {
  return { has: false, count: 0 };
}

export function isDuplicateAmenity(a, b, dedupeM = 80) {
  const sameParent =
    (a.parkCode && a.parkCode === b.parkCode) ||
    (a.parentUnit?.id && a.parentUnit.id === b.parentUnit?.id);
  if (!sameParent || a.kind !== b.kind) return false;
  if (a.kind === "campground" && a.campTier !== b.campTier) return false;
  const aOid = a.sourceIds?.objectId;
  const bOid = b.sourceIds?.objectId;
  if (aOid != null && bOid != null && String(aOid) !== String(bOid)) return false;
  const aSite = a.sourceIds?.siteNum;
  const bSite = b.sourceIds?.siteNum;
  if (aSite != null && bSite != null && String(aSite) !== String(bSite)) return false;
  const d = haversineM({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon });
  if (d > dedupeM) return false;
  const na = normalizeAmenityName(a.name);
  const nb = normalizeAmenityName(b.name);
  if (na && nb && (na === nb || na.includes(nb) || nb.includes(na))) return true;
  // Campgrounds: never merge by proximity alone (PC backcountry sites are often numbered & adjacent).
  if (a.kind === "campground") return false;
  return d <= 25 && a.subtype === b.subtype;
}

export function dedupeAmenityRecords(records, dedupeM = 80) {
  const master = [];
  const suppressed = [];
  for (const rec of records) {
    let dup = null;
    for (const existing of master) {
      if (isDuplicateAmenity(rec, existing, dedupeM)) {
        dup = existing;
        break;
      }
    }
    if (dup) {
      suppressed.push({ kept: dup.id, dropped: rec.id, name: rec.name, kind: rec.kind });
      continue;
    }
    master.push({
      ...rec,
      reviewReasons: [...(rec.reviewReasons || [])],
      mapFlags: [...(rec.mapFlags || [])],
    });
  }
  return { master, suppressed };
}

export { readJsonCamping, writeJsonCamping };
