/**
 * Audit Pilot / Flying J matches in the CA fuel cache.
 * Usage: node audit-fuel-pilot-matches.mjs [--region=vancouver]
 */
import { readJson, filterBrandFromExtracted, loadBrandCatalog } from "./fuel-ca-lib.mjs";
import { explainPilotFlyingJMatch } from "./fuel-pilot-fj-match.mjs";
import { matchBrandFromTags, loadBrandCatalog as loadUsCatalog } from "./fuel-us-lib.mjs";

const region = (process.argv.find((a) => a.startsWith("--region=")) || "").slice(9);
const cache = readJson("./fuel-ca-ingest/00-all-fuel/fuel-all-ca.json");
const caCat = loadBrandCatalog();
const usCat = loadUsCatalog();
const flyingj = caCat.brands.find((b) => b.id === "flyingj");
const pilot = caCat.brands.find((b) => b.id === "pilot");

function inRegion(lat, lon) {
  if (region === "vancouver") return lat >= 49.0 && lat <= 49.45 && lon >= -123.3 && lon <= -122.6;
  return true;
}

const rows = [];
for (const rec of cache.records || []) {
  if (!inRegion(rec.lat, rec.lon)) continue;
  const tags = rec.tags || {};
  const ctx = {
    normBrand: (tags.brand || tags["brand:fr"] || "").toLowerCase(),
    normOp: (tags.operator || tags["operator:fr"] || "").toLowerCase(),
    normName: (tags.name || tags["name:fr"] || "").toLowerCase(),
  };
  const ca = filterBrandFromExtracted(rec, caCat);
  const us = matchBrandFromTags(tags, usCat);
  if (!ca && !us) continue;
  if (ca?.brandId !== "pilot" && ca?.brandId !== "flyingj" && us?.brandId !== "pilot" && us?.brandId !== "flyingj") continue;
  const reasons = explainPilotFlyingJMatch(
    {
      normBrand: ctx.normBrand.replace(/[^a-z0-9]+/g, " ").trim(),
      normOp: ctx.normOp.replace(/[^a-z0-9]+/g, " ").trim(),
      normName: ctx.normName.replace(/[^a-z0-9]+/g, " ").trim(),
    },
    flyingj,
    pilot
  );
  rows.push({
    name: tags.name || "",
    brand: tags.brand || "",
    operator: tags.operator || "",
    ca: ca?.brandId || "",
    us: us?.brandId || "",
    reasons: reasons.join(", "),
    lat: rec.lat,
    lon: rec.lon,
    osm: `${rec.osm.type}/${rec.osm.id}`,
  });
}

console.log(`Pilot/Flying J audit (${region || "all canada"}): ${rows.length} matches\n`);
for (const r of rows) {
  console.log(`${r.ca || "-"} / ${r.us || "-"} | ${r.name} | brand=${r.brand} op=${r.operator}`);
  console.log(`  ${r.reasons} | ${r.osm} | ${r.lat.toFixed(5)},${r.lon.toFixed(5)}`);
}