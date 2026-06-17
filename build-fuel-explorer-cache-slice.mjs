/**
 * Export non-catalog fuel POIs from the cached extract for map exploration.
 * Helps evaluate false negatives when tuning fuel-*-brand-catalog.json.
 *
 * Usage:
 *   node build-fuel-explorer-cache-slice.mjs --region=us --state=PA
 *   node build-fuel-explorer-cache-slice.mjs --region=ca --state=ON
 *   node build-fuel-explorer-cache-slice.mjs --region=us --bbox=39,-80,42,-74
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  ALL_FUEL_CACHE_PATH as US_CACHE,
  filterBrandFromExtracted,
  loadBrandCatalog as loadUsCatalog,
  readJson as readUsJson,
} from "./fuel-us-lib.mjs";
import {
  ALL_FUEL_CACHE_PATH as CA_CACHE,
  filterBrandFromExtracted as filterCaBrand,
  loadBrandCatalog as loadCaCatalog,
  readJson as readCaJson,
} from "./fuel-ca-lib.mjs";
import { inferRegionCode } from "./poi-osm-lib.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(tools, "fuel-explorer-cache");

function parseArgs() {
  const region = (process.argv.find((a) => a.startsWith("--region="))?.split("=")[1] || "us").toLowerCase();
  const state = process.argv.find((a) => a.startsWith("--state="))?.split("=")[1]?.toUpperCase();
  const bboxArg = process.argv.find((a) => a.startsWith("--bbox="))?.split("=")[1];
  let bbox = null;
  if (bboxArg) {
    const [s, w, n, e] = bboxArg.split(",").map(Number);
    if ([s, w, n, e].every(Number.isFinite)) bbox = { s, w, n, e };
  }
  return { region, state, bbox };
}

function inBbox(lat, lon, bbox) {
  return lat >= bbox.s && lat <= bbox.n && lon >= bbox.w && lon <= bbox.e;
}

function slimUnmatched(extracted) {
  const tags = extracted.tags || {};
  return {
    lat: extracted.lat,
    lon: extracted.lon,
    name: tags.name || tags["name:fr"] || "",
    brand: tags.brand || tags["brand:fr"] || "",
    operator: tags.operator || tags["operator:fr"] || "",
    highway: tags.highway || tags.amenity || "",
    searchBlob: extracted.searchBlob || "",
    osm: extracted.osm,
    url: `https://www.openstreetmap.org/${extracted.osm.type}/${extracted.osm.id}`,
  };
}

function buildSlice(region, state, bbox) {
  const isCa = region === "ca";
  const cachePath = isCa ? CA_CACHE : US_CACHE;
  const readJson = isCa ? readCaJson : readUsJson;
  const catalog = isCa ? loadCaCatalog() : loadUsCatalog();
  const filter = isCa ? filterCaBrand : filterBrandFromExtracted;
  const regionCode = isCa ? "CA" : "US";

  if (!fs.existsSync(cachePath)) {
    throw new Error(`Missing cache ${cachePath} — run extract-all-pbf first`);
  }

  const cache = readJson(cachePath);
  const unmatched = [];
  const matched = [];

  for (const extracted of cache.records || []) {
    if (state) {
      const st = inferRegionCode(extracted.lat, extracted.lon, regionCode) || "";
      if (st !== state) continue;
    }
    if (bbox && !inBbox(extracted.lat, extracted.lon, bbox)) continue;

    const hit = filter(extracted, catalog);
    if (hit) matched.push({ ...slimUnmatched(extracted), brandId: hit.brandId, brandName: hit.displayName });
    else unmatched.push(slimUnmatched(extracted));
  }

  const label = state || (bbox ? `bbox-${bbox.s}-${bbox.w}` : "all");
  const outPath = path.join(outDir, `${region}-${label}-unmatched.json`);
  fs.mkdirSync(outDir, { recursive: true });
  const payload = {
    generated: new Date().toISOString(),
    region,
    state: state || null,
    bbox,
    cache: cachePath,
    cacheCount: cache.recordCount,
    matchedCount: matched.length,
    unmatchedCount: unmatched.length,
    unmatched,
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Wrote ${outPath} (${unmatched.length} unmatched, ${matched.length} would match catalog)`);
  return outPath;
}

if (process.argv[1]?.endsWith("build-fuel-explorer-cache-slice.mjs")) {
  const { region, state, bbox } = parseArgs();
  if (!state && !bbox) {
    console.error("Provide --state=XX or --bbox=south,west,north,east");
    process.exit(1);
  }
  try {
    buildSlice(region, state, bbox);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
