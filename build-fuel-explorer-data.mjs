/**
 * Build compact fuel explorer bundle for fuel-explorer.html (US + CA).
 * Usage: node build-fuel-explorer-data.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CATALOG_PATH as US_CATALOG, MASTER_PATH as US_MASTER, QA_PATH as US_QA, SUPPRESSED_PATH as US_SUPPRESSED, readJson } from "./fuel-us-lib.mjs";
import { CATALOG_PATH as CA_CATALOG, MASTER_PATH as CA_MASTER, QA_PATH as CA_QA, SUPPRESSED_PATH as CA_SUPPRESSED } from "./fuel-ca-lib.mjs";
import { brandIdToSelectId, buildBrandGroups, normalizeFuelType } from "./fuel-brand-lib.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));
const outJs = path.join(tools, "fuel-explorer-data.js");
const outJson = path.join(tools, "fuel-explorer-data.json");

function toMatchedRow(r, country) {
  return {
    id: r.id,
    lat: Math.round(r.lat * 1e5) / 1e5,
    lon: Math.round(r.lon * 1e5) / 1e5,
    name: r.name,
    brand: r.brand,
    brandId: r.brandId,
    brandSelectId: brandIdToSelectId(r.brandId),
    state: r.state || "",
    type: normalizeFuelType(r.type || ""),
    diesel: !!r.fuels?.diesel,
    flags: r.mapFlags || [],
    review: !!r.needsReview,
    osmBrand: r.osmTags?.brand || "",
    osmOperator: r.osmTags?.operator || "",
    osmType: r.osm?.type || "",
    osmId: r.osm?.id || "",
    highway: r.highway || "",
    exit: r.exit || "",
    url: r.url || "",
    country,
  };
}

function toSuppressedRow(s) {
  const d = s.droppedRecord;
  if (!d) return null;
  return {
    kept: s.kept,
    reason: s.reason,
    id: d.id,
    lat: d.lat,
    lon: d.lon,
    name: d.name,
    brandId: d.brandId,
    brand: d.brand,
    state: d.state || "",
    osmBrand: d.osmTags?.brand || "",
    osmOperator: d.osmTags?.operator || "",
    url: d.url || "",
  };
}

function loadRegion(country, masterPath, qaPath, catalogPath, suppressedPath) {
  const master = readJson(masterPath);
  const qa = readJson(qaPath);
  const catalog = readJson(catalogPath);
  const suppressedFile = readJson(suppressedPath, { records: [] });

  const suppressed = (suppressedFile.records || []).map(toSuppressedRow).filter(Boolean);
  const partialSuppressed = !suppressed.length && qa?.suppressedSample?.length;

  return {
    country,
    generated: master?.generated || null,
    catalog: (() => {
      const rows = [];
      const seen = new Set();
      for (const b of catalog?.brands || []) {
        if (b.id === "flyingj") continue;
        const id = brandIdToSelectId(b.id);
        if (seen.has(id)) continue;
        seen.add(id);
        rows.push({
          id,
          name: id === "pilot_flyingj" ? "Pilot Flying J" : b.displayName,
          tier: b.tier || "A",
          type: normalizeFuelType(b.type || ""),
          strict: !!(b.osm && b.osm.strict),
        });
      }
      return rows;
    })(),
    stats: {
      matched: master?.recordCount || 0,
      suppressed: qa?.suppressedCount || suppressed.length,
      byBrand: qa?.byBrand || {},
      byState: qa?.byState || {},
    },
    matched: (master?.records || []).map((r) => toMatchedRow(r, country)),
    suppressed,
    suppressedPartial: partialSuppressed,
    suppressedSample: partialSuppressed ? qa.suppressedSample : [],
  };
}

const payload = {
  generated: new Date().toISOString(),
  brandGroups: buildBrandGroups(readJson(US_CATALOG), readJson(CA_CATALOG)),
  us: loadRegion("US", US_MASTER, US_QA, US_CATALOG, US_SUPPRESSED),
  ca: loadRegion("CA", CA_MASTER, CA_QA, CA_CATALOG, CA_SUPPRESSED),
};

const json = JSON.stringify(payload);
fs.writeFileSync(outJson, json, "utf8");
fs.writeFileSync(outJs, "/* Auto-generated — node build-fuel-explorer-data.mjs */\nvar FUEL_EXPLORER=" + json + ";\n", "utf8");
const mb = (Buffer.byteLength(json) / 1024 / 1024).toFixed(2);
console.log(`Wrote ${outJs} (${mb} MB, US ${payload.us.matched.length}, CA ${payload.ca.matched.length})`);
