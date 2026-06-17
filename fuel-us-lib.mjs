import fs from "fs";
import { matchPilotFlyingJ } from "./fuel-pilot-fj-match.mjs";
import path from "path";
import { fileURLToPath } from "url";

export const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const INGEST_DIR = path.join(TOOLS_DIR, "fuel-us-ingest");
export const MASTER_PATH = path.join(TOOLS_DIR, "fuel-us-master.json");
export const QA_PATH = path.join(TOOLS_DIR, "fuel-us-qa-report.json");
export const CATALOG_PATH = path.join(TOOLS_DIR, "fuel-us-brand-catalog.json");
export const SUPPRESSED_PATH = path.join(TOOLS_DIR, "fuel-us-suppressed.json");
export const ALL_FUEL_CACHE_PATH = path.join(INGEST_DIR, "00-all-fuel", "fuel-all-us.json");

/** Informational flags — do not imply data quality problems. */
export const INFORMATIONAL_MAP_FLAGS = new Set([
  "PILOT_FJ_CLUSTER",
  "SUPPLEMENT",
  "ONROUTE_HWY_PAIR",
]);

export const US_STATES =
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(
    " "
  );

export function slugify(s) {
  return (s || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
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

export function coordValid(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat === 0 && lon === 0) return false;
  if (lat < 24 || lat > 72 || lon < -180 || lon > -65) return false;
  return true;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
  const b = fs.readFileSync(filePath);
  let text;
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) text = b.toString("utf16le");
  else if (b.length >= 2 && b[1] === 0x00) text = b.toString("utf16le");
  else text = b.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return JSON.parse(text);
}

export function normToken(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function loadBrandCatalog() {
  const cat = readJson(CATALOG_PATH);
  if (!cat?.brands?.length) throw new Error("Missing fuel-us-brand-catalog.json");
  return cat;
}

export function buildSearchBlob(tags) {
  const parts = [tags.brand, tags.operator, tags.name, tags["addr:housename"]];
  return normToken(parts.filter(Boolean).join(" "));
}

/** @returns {{ brandId: string, displayName: string, tier: string, type: string, mergeWith?: string } | null} */
export function filterBrandFromExtracted(rec, catalog) {
  return matchBrandFromTags(rec.tags || {}, catalog);
}

/** Clear needsReview when only informational mapFlags remain. */
export function reconcileFuelNeedsReview(rec) {
  const reviewFlags = (rec.mapFlags || []).filter((f) => !INFORMATIONAL_MAP_FLAGS.has(f));
  rec.needsReview = (rec.reviewReasons || []).length > 0 || reviewFlags.length > 0;
}

/** @returns {{ brandId: string, displayName: string, tier: string, type: string, mergeWith?: string } | null} */
export function matchBrandFromTags(tags, catalog) {
  const brand = (tags.brand || "").trim();
  const operator = (tags.operator || "").trim();
  const name = (tags.name || "").trim();
  const normName = normToken(name);
  const normBrand = normToken(brand);
  const normOp = normToken(operator);

  const flyingjEntry = catalog.brands.find((b) => b.id === "flyingj");
  const pilotEntry = catalog.brands.find((b) => b.id === "pilot");
  const pfj = matchPilotFlyingJ({ normBrand, normOp, normName }, flyingjEntry, pilotEntry);
  if (pfj) return pfj;

  for (const b of catalog.brands) {
    if (b.id === "pilot" || b.id === "flyingj") continue;
    const osm = b.osm || {};
    const strict = osm.strict === true;
    const displayNorm = normToken(b.displayName);
    // Strict brands need explicit brand/operator/nameContains — not name-only displayName hits.
    if (!strict && displayNorm && normName === displayNorm) return pickBrand(b);

    for (const raw of osm.brand || []) {
      const rawNorm = normToken(raw);
      if (!rawNorm || !normBrand) continue;
      if (normBrand === rawNorm || normBrand.includes(rawNorm) || rawNorm.includes(normBrand)) {
        return pickBrand(b);
      }
    }
    for (const raw of osm.operator || []) {
      const t = normToken(raw);
      if (!t || !normOp) continue;
      if (normOp === t || normOp.includes(t)) {
        return pickBrand(b);
      }
    }
    for (const frag of osm.nameContains || []) {
      const f = normToken(frag);
      if (!f) continue;
      if (f.length <= 4) {
        if (normName === f || normName.startsWith(f + " ") || normName.includes(" " + f + " ")) {
          return pickBrand(b);
        }
      } else if (normName.includes(f)) {
        return pickBrand(b);
      }
    }
    if (!strict && normBrand && normName.startsWith(normToken(b.displayName))) return pickBrand(b);
  }
  return null;
}

function pickBrand(b) {
  return {
    brandId: b.id,
    displayName: b.displayName,
    tier: b.tier || "A",
    type: b.type || "travel_center",
    mergeWith: b.mergeWith || null,
  };
}

export function fuelsFromTags(tags) {
  return {
    gasoline: tags["fuel:gasoline"] !== "no",
    diesel: tags["fuel:diesel"] === "yes" || tags.diesel === "yes",
  };
}

export function amenitiesFromTags(tags, brandType) {
  const toilets = tags.toilets || tags["toilets:access"];
  return {
    restroom: toilets ? String(toilets) : brandType === "travel_center" ? "assumed" : "unknown",
    food: tags.shop === "convenience" || tags["shop"] === "convenience" ? "yes" : "unknown",
    showers: tags.shower === "yes" ? "yes" : brandType === "travel_center" ? "common" : "unknown",
  };
}
