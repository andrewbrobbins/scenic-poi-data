/**
 * Keep playgrounds inside named parks (OSM leisure=park + NPS boundaries).
 * Usage: node build-playgrounds-in-parks.mjs [--source=us|ca|tx]
 */
import fs from "fs";
import path from "path";
import { createReadStream } from "fs";
import { pipeline } from "stream/promises";
import { Writable } from "stream";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { PBF_SOURCES, pbfFilePath } from "./poi-osm-pbf-config.mjs";
import { PBF_TAG_MATCHERS } from "./poi-osm-pbf-config.mjs";
import {
  POI_KINDS,
  buildPoiRecord,
  coordValidCa,
  coordValidUs,
  inferRegionCode,
  ingestDir,
  writeJson,
} from "./poi-osm-lib.mjs";
import {
  ParkSpatialIndex,
  isNamedOsmPark,
  loadNpsParkPolygons,
  parkDisplayName,
  ringBbox,
  wayToRings,
} from "./poi-osm-named-parks.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));

async function loadParser() {
  const mod = await import("osm-pbf-parser");
  return mod.default || mod;
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

async function filterPlaygroundsInParks(sourceKey) {
  const src = PBF_SOURCES[sourceKey];
  if (!src || src.proofOnly) throw new Error("Use --source=us or --source=ca");
  const pbf = pbfFilePath(sourceKey);
  const regionLabel = src.region === "ca" ? "CA" : "US";
  const coordValid = regionLabel === "CA" ? coordValidCa : coordValidUs;
  const matchesPlayground = PBF_TAG_MATCHERS.playground;
  const parser = await loadParser();

  const parkWays = [];
  const playgroundNodes = [];
  const playgroundWays = [];
  const neededNodeIds = new Set();

  console.log(`Scan ${src.label} PBF for named parks + playgrounds...`);
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
              if (isNamedOsmPark(tags)) {
                parkWays.push({ refs: item.refs || [], name: parkDisplayName(tags) });
                for (const id of item.refs || []) neededNodeIds.add(id);
              }
              if (matchesPlayground(tags)) {
                playgroundWays.push({ osmId: item.id, refs: item.refs || [], tags });
                for (const id of item.refs || []) neededNodeIds.add(id);
              }
            } else if (item.type === "node") {
              const tags = item.tags || {};
              if (matchesPlayground(tags)) {
                playgroundNodes.push({
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
  for (const n of playgroundNodes) {
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

  const index = new ParkSpatialIndex();
  const npsParks = loadNpsParkPolygons(src.region);
  for (const p of npsParks) index.add(p);

  let osmParkPolys = 0;
  for (const pw of parkWays) {
    const rings = wayToRings(pw.refs, nodeCoords);
    if (!rings) continue;
    index.add({ name: pw.name, source: "osm", rings, bbox: ringBbox(rings[0]) });
    osmParkPolys += 1;
  }

  const kindCfg = POI_KINDS.playground;
  const filtered = [];
  const seen = new Set();
  let rawPlaygrounds = 0;

  function tryAdd(osmType, osmId, lat, lon, tags) {
    rawPlaygrounds += 1;
    if (!coordValid(lat, lon)) return;
    const park = index.findParkAt(lat, lon);
    if (!park) return;
    const key = `${osmType}:${osmId}`;
    if (seen.has(key)) return;
    seen.add(key);
    const rec = buildPoiRecord({
      kind: "playground",
      kindCfg,
      regionLabel,
      osmType,
      osmId,
      lat,
      lon,
      tags,
      regionCode: inferRegionCode(lat, lon, regionLabel),
    });
    rec.parkName = park.name;
    rec.parkSource = park.source;
    rec.displayTier = "default";
    filtered.push(rec);
  }

  for (const n of playgroundNodes) tryAdd("node", n.osmId, n.lat, n.lon, n.tags);
  for (const w of playgroundWays) {
    const c = wayCentroid(w.refs, nodeCoords);
    if (!c) continue;
    tryAdd("way", w.osmId, c.lat, c.lon, w.tags);
  }

  return {
    region: src.region,
    rawPlaygrounds,
    parkPolygons: { nps: npsParks.length, osm: osmParkPolys },
    records: filtered,
  };
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
  if (!PBF_SOURCES[sourceKey] || PBF_SOURCES[sourceKey].proofOnly) {
    console.error("Unknown or proof-only source:", sourceKey);
    process.exit(1);
  }
  const t0 = Date.now();
  const result = await filterPlaygroundsInParks(sourceKey);
  const region = result.region;
  const outDir = ingestDir(region, "playground");
  const mergedPath = path.join(outDir, "merged.json");
  const backupPath = path.join(outDir, "merged-all-playgrounds.json");

  if (fs.existsSync(mergedPath) && !fs.existsSync(backupPath)) {
    fs.copyFileSync(mergedPath, backupPath);
    console.log("Backed up full playground list to merged-all-playgrounds.json");
  }

  writeJson(mergedPath, {
    generated: new Date().toISOString(),
    source: sourceKey,
    kind: "playground",
    region,
    filter: "in-named-park",
    parkPolygons: result.parkPolygons,
    rawPlaygroundCount: result.rawPlaygrounds,
    recordCount: result.records.length,
    records: result.records,
  });

  const pct = result.rawPlaygrounds
    ? ((result.records.length / result.rawPlaygrounds) * 100).toFixed(1)
    : "0";
  console.log(
    `${region.toUpperCase()}: ${result.records.length.toLocaleString()} / ${result.rawPlaygrounds.toLocaleString()} playgrounds in named parks (${pct}%)`
  );
  console.log(
    `  park polygons: ${result.parkPolygons.nps} NPS + ${result.parkPolygons.osm} OSM named parks`
  );
  console.log(`  wrote ${mergedPath} (${Math.round((Date.now() - t0) / 1000)}s)`);
}

console.log("\nRebuilding playground master + embed...");
execSync("node build-poi-osm-master.mjs --kind=playground", { cwd: tools, stdio: "inherit" });
execSync("node build-poi-osm-explorer-embed.mjs --kind=playground", { cwd: tools, stdio: "inherit" });
console.log("\nDone. Playgrounds layer now shows only those inside named parks.");
