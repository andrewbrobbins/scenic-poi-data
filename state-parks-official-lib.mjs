/**
 * Official state/provincial park ingest helpers (SP-001 Tier A/B).
 */
import path from "path";
import { fileURLToPath } from "url";
import { fetchArcgisAllFeatures } from "./camping-ca-lib.mjs";
import { centroidFromEsriGeometry } from "./parks-canada-lib.mjs";
import {
  INGEST_DIR,
  coordValid,
  inferAdminRegion,
  isExcludedCaStateParkName,
  isExcludedUsStateParkName,
  readJson,
  slugify,
  unitId,
  writeJson,
} from "./state-parks-lib.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));
export const MATRIX_PATH = path.join(tools, "state-parks-source-matrix.json");
export const OFFICIAL_INGEST_DIR = path.join(INGEST_DIR, "01-official");

const HISTORIC =
  /\b(historic site|historical site|historic park|historical park|heritage site|heritage park|memorial|battlefield|monument)\b/i;

const STATE_PARK =
  /\bstate park\b|\bstate historic\b|\bstate historical\b|\bstate heritage\b|\bstate memorial\b|\bprovincial park\b|\bprovincial historic\b|\bparc provincial\b|\bsite historique provincial\b/i;

export function loadSourceMatrix() {
  return readJson(MATRIX_PATH, { us: [], ca: [] });
}

export function verifiedSources(matrix, country) {
  const key = country === "CA" ? "ca" : "us";
  return (matrix[key] || []).filter((r) => r.status === "verified" && r.queryUrl);
}

/** Admins with official GIS and/or listing-primary catalog (no GIS required). */
export function catalogBackedAdmins(matrix, country) {
  const key = country === "CA" ? "ca" : "us";
  return (matrix[key] || [])
    .filter((r) => (r.status === "verified" && r.queryUrl) || r.listingPrimary === true)
    .map((r) => r.admin);
}

export function attrString(attrs, field) {
  if (!field || !attrs) return "";
  const v = attrs[field];
  if (v == null) return "";
  return String(v).trim();
}

export function pickNameFromAttrs(attrs, fieldMap) {
  const primary = attrString(attrs, fieldMap?.name);
  if (primary) return primary;
  for (const k of Object.keys(attrs || {})) {
    if (/name|park|unit|site|facility|desc|title/i.test(k)) {
      const v = attrString(attrs, k);
      if (v.length > 2) return v;
    }
  }
  return "";
}

export function pickCodeFromAttrs(attrs, fieldMap) {
  const c = attrString(attrs, fieldMap?.code);
  return c || null;
}

export function pickUrlFromAttrs(attrs, fieldMap) {
  const u = attrString(attrs, fieldMap?.url);
  if (u && /^https?:\/\//i.test(u)) return u;
  for (const k of Object.keys(attrs || {})) {
    if (/url|website|link|web/i.test(k)) {
      const v = attrString(attrs, k);
      if (/^https?:\/\//i.test(v)) return v;
    }
  }
  return "";
}

export function classifyOfficialName(name, country, { trustLayer = false, propType = null } = {}) {
  const n = name.trim();
  if (!n) return null;
  if (country === "CA" && isExcludedCaStateParkName(n) && !HISTORIC.test(n)) return null;
  if (country === "US" && isExcludedUsStateParkName(n) && !HISTORIC.test(n)) return null;

  if (propType === "SHS") {
    return {
      category: "historic_site",
      designation: country === "CA" ? "Provincial Historic Site" : "State Historic Site",
    };
  }

  if (trustLayer) {
    if (/\sSHP$/i.test(n)) {
      return { category: "historic_site", designation: "State Historic Park" };
    }
    if (/\sSHM$/i.test(n)) {
      return { category: "historic_site", designation: "State Historic Monument" };
    }
    if (/\sSP$/i.test(n)) {
      return { category: "park", designation: "State Park" };
    }
    let category = "park";
    if (propType === "SP/SHS" && (HISTORIC.test(n) || /\b(fort |goliad|seminole|hueco tanks|lyndon b|historic)/i.test(n))) {
      category = "historic_site";
    } else if (HISTORIC.test(n) || /historic site|heritage site|memorial|battlefield/i.test(n)) {
      category = "historic_site";
    }
    let designation = country === "CA" ? "Provincial Park" : "State Park";
    if (category === "historic_site") {
      designation = country === "CA" ? "Provincial Historic Site" : "State Historic Site";
    }
    return { category, designation };
  }
  if (!STATE_PARK.test(n) && !HISTORIC.test(n)) {
    if (!/\bpark\b|\bsite\b|\bpreserve\b|\bmemorial\b/i.test(n)) return null;
  }
  const category = HISTORIC.test(n) ? "historic_site" : "park";
  let designation = country === "CA" ? "Provincial Park" : "State Park";
  if (category === "historic_site") {
    designation = country === "CA" ? "Provincial Historic Site" : "State Historic Site";
  } else if (/state historical park/i.test(n)) {
    designation = "State Historical Park";
  } else if (/state recreation area/i.test(n) && HISTORIC.test(n)) {
    designation = "State Historic Site";
  }
  return { category, designation };
}

export function officialUnitId(country, admin, name, code) {
  const suffix = code ? `-code${slugify(String(code))}` : "";
  return unitId(country, admin, name, "official", suffix).slice(0, 80);
}

function recordRankOfficial(rec) {
  let score = 0;
  if (rec.url) score += 10;
  if (rec.officialCode) score += 5;
  return score;
}

export function coordsFromFeature(feature, attrs, fieldMap) {
  const g = centroidFromEsriGeometry(feature.geometry);
  if (g) return g;
  const lat = parseFloat(attrs?.LAT ?? attrs?.Lat ?? attrs?.lat ?? attrs?.Lat_Entrance);
  const lon = parseFloat(attrs?.LON ?? attrs?.Lon ?? attrs?.lon ?? attrs?.Long_Entrance);
  if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  return null;
}

export function featureToRecord(feature, row) {
  const attrs = feature.attributes || {};
  const name = pickNameFromAttrs(attrs, row.fieldMap);
  if (!name) return null;

  const country = row.country || "US";
  const propType = attrString(attrs, row.fieldMap?.propType || "PropType") || null;
  const cls = classifyOfficialName(name, country, { trustLayer: true, propType });
  if (!cls) return null;

  const coords = coordsFromFeature(feature, attrs, row.fieldMap);
  if (!coords || !coordValid(coords.lat, coords.lon, country)) return null;

  const admin = row.admin || inferAdminRegion(coords.lat, coords.lon, country);
  if (!admin) return null;

  const code = pickCodeFromAttrs(attrs, row.fieldMap);
  const url = pickUrlFromAttrs(attrs, row.fieldMap);

  return {
    id: officialUnitId(country, admin, name, code),
    country,
    state: admin,
    name,
    designation: cls.designation,
    category: cls.category,
    lat: Math.round(coords.lat * 1e5) / 1e5,
    lon: Math.round(coords.lon * 1e5) / 1e5,
    source: "official",
    needsReview: false,
    reviewReasons: [],
    url: url || undefined,
    officialCode: code || undefined,
    propType: propType || undefined,
    officialSource: row.notes || row.agency,
  };
}

const MAX_OFFICIAL_FEATURES = 3000;

async function fetchArcgisOnce(queryBase, where, outFields, maxAllowableOffset = null) {
  const params = new URLSearchParams({
    where,
    outFields,
    returnGeometry: "true",
    outSR: "4326",
    f: "json",
  });
  if (maxAllowableOffset != null) {
    params.set("maxAllowableOffset", String(maxAllowableOffset));
    params.set("geometryPrecision", "5");
  }
  const res = await fetch(`${queryBase}?${params}`, { signal: AbortSignal.timeout(120000) });
  const j = await res.json();
  if (j.error) throw new Error(`ArcGIS error: ${JSON.stringify(j.error)}`);
  return j.features || [];
}

export async function fetchOfficialFeatures(row) {
  const queryBase = row.queryUrl.replace(/\?.*$/, "");
  const params = new URLSearchParams({
    where: row.where || "1=1",
    returnCountOnly: "true",
    f: "json",
  });
  const countUrl = `${queryBase}?${params}`;
  const countRes = await fetch(countUrl, { signal: AbortSignal.timeout(60000) });
  const countJson = await countRes.json();
  if (countJson.error) throw new Error(`ArcGIS count error: ${JSON.stringify(countJson.error)}`);
  const total = countJson.count ?? 0;
  if (total > MAX_OFFICIAL_FEATURES) {
    throw new Error(`Feature count ${total} exceeds safety limit ${MAX_OFFICIAL_FEATURES} — narrow where clause or add manual override`);
  }
  const simplify = row.simplifyGeometry ? 0.0001 : null;
  if (row.singleQuery) {
    return fetchArcgisOnce(queryBase, row.where || "1=1", row.outFields || "*", simplify);
  }
  return fetchArcgisAllFeatures(queryBase, row.where || "1=1", row.outFields || "*", 500, simplify);
}

export function cachePathForAdmin(admin) {
  return path.join(OFFICIAL_INGEST_DIR, `${admin.toLowerCase()}.json`);
}

export async function ingestOfficialAdmin(row, { force = false } = {}) {
  const outPath = cachePathForAdmin(row.admin);
  if (!force && readJson(outPath, null)) {
    const cached = readJson(outPath);
    return cached.records || [];
  }

  const features = await fetchOfficialFeatures(row);
  const records = [];
  const skipped = { noName: 0, outOfScope: 0, noCoords: 0 };
  const byCode = new Map();

  for (const f of features) {
    const rec = featureToRecord(f, row);
    if (!rec) {
      const name = pickNameFromAttrs(f.attributes || {}, row.fieldMap);
      if (!name) skipped.noName += 1;
      else if (!coordsFromFeature(f, f.attributes || {}, row.fieldMap)) skipped.noCoords += 1;
      else skipped.outOfScope += 1;
      continue;
    }
    const dedupeKey = rec.officialCode || rec.name.toLowerCase();
    const prev = byCode.get(dedupeKey);
    if (!prev) {
      byCode.set(dedupeKey, rec);
      continue;
    }
    if (recordRankOfficial(rec) > recordRankOfficial(prev)) byCode.set(dedupeKey, rec);
  }
  records.push(...byCode.values());

  writeJson(outPath, {
    generated: new Date().toISOString(),
    admin: row.admin,
    agency: row.agency,
    source: row.queryUrl,
    rawFeatureCount: features.length,
    recordCount: records.length,
    skipped,
    records,
  });

  return records;
}

export function loadAllOfficialRecords() {
  const matrix = loadSourceMatrix();
  const us = verifiedSources(matrix, "US");
  const ca = verifiedSources(matrix, "CA");
  const records = [];

  for (const row of [...us, ...ca]) {
    const cached = readJson(cachePathForAdmin(row.admin), null);
    if (cached?.records?.length) records.push(...cached.records);
  }
  return records;
}
