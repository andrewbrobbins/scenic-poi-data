/**
 * Search the cached Canada fuel extract by substring (fast brand iteration).
 * Usage: node search-fuel-ca-cache.mjs "irving big" [--limit=20]
 */
import { ALL_FUEL_CACHE_PATH, readJson } from "./fuel-ca-lib.mjs";

const query = process.argv[2];
if (!query) {
  console.error('Usage: node search-fuel-ca-cache.mjs "search terms" [--limit=50]');
  process.exit(1);
}

const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : 50;
const q = query.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const cache = readJson(ALL_FUEL_CACHE_PATH);
if (!cache?.records?.length) {
  console.error(`Missing or empty cache: ${ALL_FUEL_CACHE_PATH}`);
  process.exit(1);
}

const hits = [];
for (const rec of cache.records) {
  const blob = (rec.searchBlob || "").toLowerCase();
  if (!blob.includes(q)) continue;
  const tags = rec.tags || {};
  hits.push({
    osm: `${rec.osm.type}/${rec.osm.id}`,
    name: tags.name || tags["name:fr"] || "",
    brand: tags.brand || tags["brand:fr"] || "",
    operator: tags.operator || tags["operator:fr"] || "",
    highway: tags.highway || tags.amenity || "",
    lat: rec.lat,
    lon: rec.lon,
  });
  if (hits.length >= limit) break;
}

console.log(`Found ${hits.length} matches for "${query}" (showing up to ${limit}):`);
for (const h of hits) {
  console.log(
    `- ${h.name || "(no name)"} | brand=${h.brand} op=${h.operator} | ${h.highway} | ${h.osm} | ${h.lat.toFixed(5)},${h.lon.toFixed(5)}`
  );
}