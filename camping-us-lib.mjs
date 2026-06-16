import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const INGEST_DIR = path.join(TOOLS_DIR, "camping-us-ingest");
export const MASTER_PATH = path.join(TOOLS_DIR, "camping-us-master.json");
export const QA_PATH = path.join(TOOLS_DIR, "camping-us-qa-report.json");

export const US_STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(
  " "
);

const COMMERCIAL_PATTERNS = [
  /\bkoa\b/i,
  /\byogi\b/i,
  /\bjellystone\b/i,
  /\bthousand trails\b/i,
  /\bescapees\b/i,
  /\bgood sam\b/i,
  /\bpassport america\b/i,
  /\brv resort\b/i,
  /\brv park\b/i,
  /\btrailer park\b/i,
  /\bhipcamp\b/i,
  /\bglamping\b/i,
  /\bcountry acres\b/i,
  /\blakefront resort\b/i,
];

export function slugify(s) {
  return (s || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export function haversineMi(a, b) {
  const R = 3958.8;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function isCommercialName(name, operator, brand) {
  const blob = [name, operator, brand].filter(Boolean).join(" ");
  return COMMERCIAL_PATTERNS.some((re) => re.test(blob));
}

export function coordValid(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat === 0 && lon === 0) return false;
  if (lat < 24 || lat > 72 || lon < -180 || lon > -65) return false;
  return true;
}

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

export function ensureIngestDir(step) {
  const d = path.join(INGEST_DIR, step);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
}

export function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

/** @param {object} p */
export function baseRecord(p) {
  return {
    id: p.id,
    name: p.name || "Unnamed campground",
    type: p.type || "developed",
    landManager: p.landManager,
    parentUnit: p.parentUnit ?? null,
    state: p.state || "",
    lat: p.lat,
    lon: p.lon,
    coordSource: p.coordSource,
    coordConfidence: p.coordConfidence || "medium",
    cost: p.cost || "unknown",
    reservable: p.reservable ?? null,
    commercial: p.commercial ?? false,
    dispersed: p.dispersed ?? false,
    needsReview: false,
    reviewReasons: [],
    mapFlags: [],
    urls: p.urls || {},
    sourceIds: p.sourceIds || {},
    amenities: p.amenities || {},
    status: p.status || "active",
    verifiedAt: new Date().toISOString().slice(0, 10),
    ingestSource: p.ingestSource,
  };
}

export function addReview(record, reason, mapFlag) {
  record.needsReview = true;
  if (!record.reviewReasons.includes(reason)) record.reviewReasons.push(reason);
  if (mapFlag && !record.mapFlags.includes(mapFlag)) record.mapFlags.push(mapFlag);
}

export async function fetchArcgisAllFeatures(queryUrlBase, where, outFields, pageSize = 2000) {
  const features = [];
  let offset = 0;
  while (true) {
    const params = new URLSearchParams({
      where,
      outFields,
      returnGeometry: "true",
      outSR: "4326",
      f: "json",
      resultRecordCount: String(pageSize),
      resultOffset: String(offset),
    });
    const url = `${queryUrlBase}?${params}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error(`ArcGIS HTTP ${res.status} ${url}`);
    const j = await res.json();
    if (j.error) throw new Error(`ArcGIS error: ${JSON.stringify(j.error)}`);
    const batch = j.features || [];
    features.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
    if (offset > 500000) throw new Error("ArcGIS pagination safety stop");
  }
  return features;
}

export async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
