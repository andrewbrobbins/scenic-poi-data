/**
 * Phase 2: filter branded highway fuel from the cached extract (fast iteration).
 * Usage: node build-fuel-us-filter-brands.mjs
 */
import fs from "fs";
import path from "path";
import { inferRegionCode } from "./poi-osm-lib.mjs";
import {
  ALL_FUEL_CACHE_PATH,
  ensureIngestDir,
  filterBrandFromExtracted,
  loadBrandCatalog,
  slugify,
  readJson,
  writeJson,
} from "./fuel-us-lib.mjs";

function recordFromMatch(extracted, match, state) {
  const tags = extracted.tags || {};
  const osmType = extracted.osm.type;
  const osmId = extracted.osm.id;
  const name = (tags.name || tags["addr:housename"] || match.displayName).trim();
  return {
    id: `FUEL-${match.brandId.toUpperCase()}-${state || "XX"}-${slugify(name)}-${osmId}`,
    name,
    brand: match.displayName,
    brandId: match.brandId,
    brandTier: match.tier,
    type: match.type,
    mergeWith: match.mergeWith,
    state: state || "",
    lat: extracted.lat,
    lon: extracted.lon,
    highway: tags.highway || "",
    exit: tags.ref || tags.exit || "",
    fuels: { gasoline: true, diesel: tags["fuel:diesel"] === "yes" || tags.diesel === "yes" },
    amenities: {
      restroom: tags.toilets ? String(tags.toilets) : "assumed",
      food: tags.shop === "convenience" ? "yes" : "unknown",
    },
    sources: ["osm-pbf-cache"],
    osm: { type: osmType, id: osmId },
    osmTags: {
      brand: tags.brand || "",
      operator: tags.operator || "",
    },
    searchBlob: extracted.searchBlob || "",
    mapFlags: [],
    needsReview: false,
    manualVerified: false,
    url: `https://www.openstreetmap.org/${osmType}/${osmId}`,
  };
}

export function filterFuelUsBrands() {
  if (!fs.existsSync(ALL_FUEL_CACHE_PATH)) {
    throw new Error(`Missing cache ${ALL_FUEL_CACHE_PATH} — run: node build-fuel-us-extract-all-pbf.mjs`);
  }

  const cache = readJson(ALL_FUEL_CACHE_PATH);
  const catalog = loadBrandCatalog();
  const records = [];
  const byBrand = {};
  const seen = new Set();

  for (const extracted of cache.records || []) {
    const match = filterBrandFromExtracted(extracted, catalog);
    if (!match) continue;
    const key = `${extracted.osm.type}:${extracted.osm.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const state = inferRegionCode(extracted.lat, extracted.lon, "US") || "";
    records.push(recordFromMatch(extracted, match, state));
    byBrand[match.brandId] = (byBrand[match.brandId] || 0) + 1;
  }

  const outDir = ensureIngestDir("01-osm");
  const outPath = path.join(outDir, "fuel-merged.json");
  writeJson(outPath, {
    generated: new Date().toISOString(),
    source: "osm-pbf-cache-filter",
    cache: ALL_FUEL_CACHE_PATH,
    cacheGenerated: cache.generated,
    rawCandidates: cache.recordCount,
    recordCount: records.length,
    byBrand,
    records,
  });

  console.log(`Filtered ${records.length} branded stations from ${cache.recordCount} cached fuel POIs`);
  console.log("By brand:", byBrand);
  return { records, byBrand };
}

if (process.argv[1]?.endsWith("build-fuel-us-filter-brands.mjs")) {
  filterFuelUsBrands();
}
