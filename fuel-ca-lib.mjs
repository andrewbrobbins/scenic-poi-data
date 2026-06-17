import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { brandTagMatches, matchPilotFlyingJ } from "./fuel-pilot-fj-match.mjs";

export const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const INGEST_DIR = path.join(TOOLS_DIR, "fuel-ca-ingest");
export const MASTER_PATH = path.join(TOOLS_DIR, "fuel-ca-master.json");
export const QA_PATH = path.join(TOOLS_DIR, "fuel-ca-qa-report.json");
export const CATALOG_PATH = path.join(TOOLS_DIR, "fuel-ca-brand-catalog.json");
export const SUPPRESSED_PATH = path.join(TOOLS_DIR, "fuel-ca-suppressed.json");
export const ALL_FUEL_CACHE_PATH = path.join(INGEST_DIR, "00-all-fuel", "fuel-all-ca.json");

/** Informational flags — do not imply data quality problems. */
export const INFORMATIONAL_MAP_FLAGS = new Set([
  "PILOT_FJ_CLUSTER",
  "SUPPLEMENT",
  "ONROUTE_HWY_PAIR",
]);

export { CA_PROVINCES } from "./camping-ca-province-bboxes.mjs";

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

/** Canada + border overlap with US lat/lon envelope */
export function coordValid(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat === 0 && lon === 0) return false;
  if (lat < 41 || lat > 84 || lon < -141 || lon > -52) return false;
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
    .replace(/[''`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function loadBrandCatalog() {
  const cat = readJson(CATALOG_PATH);
  if (!cat?.brands?.length) throw new Error("Missing fuel-ca-brand-catalog.json");
  return cat;
}

/** Clear needsReview when only informational mapFlags remain. */
export function reconcileFuelNeedsReview(rec) {
  const reviewFlags = (rec.mapFlags || []).filter((f) => !INFORMATIONAL_MAP_FLAGS.has(f));
  rec.needsReview = (rec.reviewReasons || []).length > 0 || reviewFlags.length > 0;
}

/** Collect OSM tag strings including French variants. */
export function tagBlob(tags) {
  const parts = [
    tags.brand,
    tags.operator,
    tags.name,
    tags["brand:fr"],
    tags["operator:fr"],
    tags["name:fr"],
    tags["addr:housename"],
  ];
  return parts.filter(Boolean).join(" ");
}

function nameHasAny(normName, frags) {
  for (const raw of frags || []) {
    const f = normToken(raw);
    if (f && normName.includes(f)) return true;
  }
  return false;
}

function isPlainPetroCanada(normBrand, normName, blob) {
  const petroCa =
    normBrand.includes("petro canada") ||
    normBrand.includes("petrocanada") ||
    normName === "petro canada" ||
    normName === "petrocanada";
  if (!petroCa) return false;
  return !/petro\s*pass|petropass|petro-pass/.test(blob);
}

function isPlainHusky(normBrand, normName, blob) {
  if (normName.includes("esso") && !normName.includes("husky")) return false;
  const huskyOnly =
    (normBrand === "husky" || normName === "husky") && !blob.includes("travel") && !blob.includes("truck");
  return huskyOnly;
}

function isPlainIrving(normBrand, normName, blob) {
  const irvingish = normBrand.includes("irving") || normName.includes("irving");
  if (!irvingish) return false;
  return !blob.includes("big stop");
}

export function buildSearchBlob(tags) {
  return normToken(tagBlob(tags));
}

function brandById(catalog) {
  return Object.fromEntries(catalog.brands.map((b) => [b.id, b]));
}

function tagContext(tags) {
  return {
    normBrand: normToken(tags.brand || tags["brand:fr"] || ""),
    normOp: normToken(tags.operator || tags["operator:fr"] || ""),
    normName: normToken(tags.name || tags["name:fr"] || tags.alt_name || ""),
    blob: buildSearchBlob(tags),
    tags,
  };
}

/**
 * Strict brand filter on a normalized search blob. Used by the cached extract pipeline
 * and by matchBrandFromTags for generic-fuel exclusion.
 * @returns {{ brandId: string, displayName: string, tier: string, type: string, mergeWith?: string } | null}
 */
export function filterBrandFromContext(ctx, catalog) {
  const { normBrand, normOp, normName, blob } = ctx;
  const brands = brandById(catalog);

  if (isPlainPetroCanada(normBrand, normName, blob)) return null;
  if (isPlainHusky(normBrand, normName, blob)) return null;
  if (isPlainIrving(normBrand, normName, blob)) return null;

  if (/petro[\s-]*pass|petropass/.test(blob)) return pickBrand(brands.petro_pass);
  if (
    brandTagMatches(normBrand, "Petro-Pass") ||
    brandTagMatches(normBrand, "Petro Pass") ||
    brandTagMatches(normBrand, "PetroPass")
  ) {
    return pickBrand(brands.petro_pass);
  }

  if (normName.includes("onroute") || normName.includes("on route") || blob.includes("onroute")) {
    return pickBrand(brands.onroute);
  }

  if (blob.includes("big stop")) {
    const irvingish =
      blob.includes("irving") ||
      normBrand.includes("irving") ||
      normName.includes("irving") ||
      brandTagMatches(normBrand, "Irving Big Stop") ||
      brandTagMatches(normBrand, "Big Stop");
    if (irvingish || normName.includes("big stop")) return pickBrand(brands.irving_bigstop);
  }

  if (
    /husky travel|husky truck/.test(blob) ||
    brandTagMatches(normBrand, "Husky Travel Center") ||
    brandTagMatches(normBrand, "Husky Travel Centre") ||
    nameHasAny(normName, brands.husky_travel?.osm?.nameContains)
  ) {
    return pickBrand(brands.husky_travel);
  }

  const pfj = matchPilotFlyingJ({ normBrand, normOp, normName }, brands.flyingj, brands.pilot);
  if (pfj) return pfj;

  return null;
}

/** @returns {{ brandId: string, displayName: string, tier: string, type: string, mergeWith?: string } | null} */
export function filterBrandFromExtracted(rec, catalog) {
  const tags = rec.tags || {};
  return filterBrandFromContext(
    {
      normBrand: normToken(tags.brand || tags["brand:fr"] || ""),
      normOp: normToken(tags.operator || tags["operator:fr"] || ""),
      normName: normToken(tags.name || tags["name:fr"] || tags.alt_name || ""),
      blob: rec.searchBlob || buildSearchBlob(tags),
      tags,
    },
    catalog
  );
}

/** @returns {{ brandId: string, displayName: string, tier: string, type: string, mergeWith?: string } | null} */
export function matchBrandFromTags(tags, catalog) {
  return filterBrandFromContext(tagContext(tags), catalog);
}

/** ONroute plazas are often highway=services, not amenity=fuel. */
export function matchOnrouteServices(tags) {
  const ctx = tagContext(tags);
  if (ctx.normName.includes("onroute") || ctx.normName.includes("on route") || ctx.blob.includes("onroute")) {
    return {
      brandId: "onroute",
      displayName: "ONroute",
      tier: "A",
      type: "highway_service_centre",
      mergeWith: null,
    };
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
