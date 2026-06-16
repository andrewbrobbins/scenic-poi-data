/**
 * OSM amenity=fuel not matched to premium brand catalogs -> generic gas embed.
 * Usage: node build-fuel-generic-explorer-embed.mjs [--source=us|ca|tx]
 */
import fs from "fs";
import path from "path";
import { createReadStream } from "fs";
import { pipeline } from "stream/promises";
import { Writable } from "stream";
import { fileURLToPath } from "url";
import { PBF_SOURCES, pbfFilePath } from "./poi-osm-pbf-config.mjs";
import { inferRegionCode } from "./poi-osm-lib.mjs";
import {
  coordValid as coordValidUs,
  loadBrandCatalog as loadUsCatalog,
  matchBrandFromTags as matchUsBrand,
  slugify,
} from "./fuel-us-lib.mjs";
import {
  coordValid as coordValidCa,
  loadBrandCatalog as loadCaCatalog,
  matchBrandFromTags as matchCaBrand,
} from "./fuel-ca-lib.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));

function isFuel(tags) {
  return tags.amenity === "fuel" || tags.shop === "fuel";
}

function fuelDisplayName(tags) {
  return (tags.name || tags.brand || tags.operator || "Gas station").trim();
}

function wayCentroid(refs, nodeCoords) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const id of refs || []) {
    const c = nodeCoords.get(id);
    if (!c) continue;
    sx += c.lon;
    sy += c.lat;
    n += 1;
  }
  if (!n) return null;
  return { lat: sy / n, lon: sx / n };
}

async function loadParser() {
  const mod = await import("osm-pbf-parser");
  return mod.default || mod;
}

async function extractGenericFuel(sourceKey) {
  const src = PBF_SOURCES[sourceKey];
  if (!src || src.proofOnly) throw new Error("Use --source=us or --source=ca");
  const pbf = pbfFilePath(sourceKey);
  const regionLabel = src.region === "ca" ? "CA" : "US";
  const coordValid = regionLabel === "CA" ? coordValidCa : coordValidUs;
  const catalog = regionLabel === "CA" ? loadCaCatalog() : loadUsCatalog();
  const matchBrand = regionLabel === "CA" ? matchCaBrand : matchUsBrand;
  const parser = await loadParser();

  const fuelNodes = [];
  const fuelWays = [];
  const neededNodeIds = new Set();

  console.log(`Scan ${src.label} PBF for generic fuel (non-catalog brands)...`);
  await pipeline(
    createReadStream(pbf),
    parser(),
    new Writable({
      objectMode: true,
      write(chunks, _enc, cb) {
        try {
          for (const item of chunks) {
            if (item.type === "way") {
              const tags = item.tags || {};
              if (isFuel(tags)) {
                fuelWays.push({ osmId: item.id, refs: item.refs || [], tags });
                for (const id of item.refs || []) neededNodeIds.add(id);
              }
            } else if (item.type === "node") {
              const tags = item.tags || {};
              if (isFuel(tags)) {
                fuelNodes.push({
                  osmId: item.id,
                  lat: item.lat,
                  lon: item.lon,
                  tags,
                });
              }
            }
          }
          cb();
        } catch (err) {
          cb(err);
        }
      },
    })
  );

  const nodeCoords = new Map();
  for (const n of fuelNodes) {
    nodeCoords.set(n.osmId, { lat: n.lat, lon: n.lon });
  }

  if (neededNodeIds.size) {
    const need = neededNodeIds;
    await pipeline(
      createReadStream(pbf),
      parser(),
      new Writable({
        objectMode: true,
        write(chunks, _enc, cb) {
          try {
            for (const item of chunks) {
              if (item.type === "node" && need.has(item.id)) {
                nodeCoords.set(item.id, { lat: item.lat, lon: item.lon });
              }
            }
            cb();
          } catch (err) {
            cb(err);
          }
        },
      })
    );
  }

  const records = [];
  const seen = new Set();
  let rawFuel = 0;
  let premiumSkipped = 0;

  function tryAdd(osmType, osmId, lat, lon, tags) {
    rawFuel += 1;
    if (!coordValid(lat, lon)) return;
    if (matchBrand(tags, catalog)) {
      premiumSkipped += 1;
      return;
    }
    const key = `${osmType}:${osmId}`;
    if (seen.has(key)) return;
    seen.add(key);
    const name = fuelDisplayName(tags);
    const state = inferRegionCode(lat, lon, regionLabel) || "";
    records.push({
      id: `FUEL-GEN-${regionLabel}-${state || "XX"}-${slugify(name)}-${osmId}`,
      name,
      lat,
      lon: lon,
      state,
      url: `https://www.openstreetmap.org/${osmType}/${osmId}`,
    });
  }

  for (const n of fuelNodes) tryAdd("node", n.osmId, n.lat, n.lon, n.tags);
  for (const w of fuelWays) {
    const c = wayCentroid(w.refs, nodeCoords);
    if (!c) continue;
    tryAdd("way", w.osmId, c.lat, c.lon, w.tags);
  }

  return { region: src.region, rawFuel, premiumSkipped, records };
}

function parseArgs() {
  const out = { sources: ["us", "ca"] };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--source=")) out.sources = [arg.slice(9)];
  }
  return out;
}

const args = parseArgs();
for (const sourceKey of args.sources) {
  if (!PBF_SOURCES[sourceKey]) {
    console.error("Unknown source:", sourceKey);
    process.exit(1);
  }
  const t0 = Date.now();
  const result = await extractGenericFuel(sourceKey);
  const region = result.region;
  const outPath = path.join(tools, `fuel-generic-${region}-explorer-embed.js`);
  const varName = `FUEL_GENERIC_${region.toUpperCase()}`;
  const payload = {
    generated: new Date().toISOString(),
    kind: "fuel_generic",
    region,
    count: result.records.length,
    rawFuelCount: result.rawFuel,
    premiumSkipped: result.premiumSkipped,
    records: result.records,
  };
  fs.writeFileSync(
    outPath,
    `/* Auto-generated — node build-fuel-generic-explorer-embed.mjs */\nvar ${varName}=` +
      JSON.stringify(payload) +
      ";\n",
    "utf8"
  );
  const pct = result.rawFuel
    ? ((result.records.length / result.rawFuel) * 100).toFixed(1)
    : "0";
  console.log(
    `${region.toUpperCase()}: ${result.records.length.toLocaleString()} generic / ${result.rawFuel.toLocaleString()} total fuel (${pct}%, ${result.premiumSkipped.toLocaleString()} premium skipped)`
  );
  console.log(`  wrote ${outPath} (${Math.round((Date.now() - t0) / 1000)}s)`);
}

console.log("\nDone.");
