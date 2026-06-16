/**
 * Extract drivable road segments near scenic viewpoints into a spatial grid index.
 * Viewpoint-guided single pass keeps memory bounded on full US/Canada PBF files.
 *
 * Usage: node build-scenic-roads-extract-pbf.mjs [--source=us|ca|tx] [--refresh]
 * Run after scenic viewpoint ingest (needs merged.json with viewpoint coords).
 */
import fs from "fs";
import path from "path";
import { createReadStream } from "fs";
import { pipeline } from "stream/promises";
import { Writable } from "stream";
import { pbfFilePath, PBF_SOURCES } from "./poi-osm-pbf-config.mjs";
import { buildSegmentGridIndex, isDrivableHighway } from "./poi-road-network.mjs";
import { writeJson, readJson, TOOLS_DIR, ingestDir } from "./poi-osm-lib.mjs";

const ROADS_DIR = path.join(TOOLS_DIR, "osm-pbf", "roads");
const INDEX_CELL_DEG = 0.0015;
/** Grid cells around each viewpoint to collect road geometry (~600 m at mid-latitudes). */
const VIEWPOINT_CELL_RADIUS = 4;

function roadsIndexPath(sourceKey) {
  const region = PBF_SOURCES[sourceKey]?.region || sourceKey;
  return path.join(ROADS_DIR, `roads-${region}-${sourceKey}-grid.json`);
}

function cellKey(lat, lon, cellDeg = INDEX_CELL_DEG) {
  return `${Math.floor(lat / cellDeg)}:${Math.floor(lon / cellDeg)}`;
}

function loadViewpoints(sourceKey) {
  const src = PBF_SOURCES[sourceKey];
  if (!src) return [];
  const region = src.region;
  const mergedPath = path.join(ingestDir(region, "viewpoint"), "merged.json");
  const backupPath = path.join(ingestDir(region, "viewpoint"), "merged-unfiltered.json");
  const j = readJson(fs.existsSync(backupPath) ? backupPath : mergedPath);
  let records = j?.records || [];
  if (src.stateFilter) {
    records = records.filter((r) => r.state === src.stateFilter);
  }
  return records;
}

function buildViewpointCellSet(viewpoints, radiusCells = VIEWPOINT_CELL_RADIUS) {
  const cells = new Set();
  for (const v of viewpoints) {
    if (!Number.isFinite(v.lat) || !Number.isFinite(v.lon)) continue;
    const gi = Math.floor(v.lat / INDEX_CELL_DEG);
    const gj = Math.floor(v.lon / INDEX_CELL_DEG);
    for (let di = -radiusCells; di <= radiusCells; di++) {
      for (let dj = -radiusCells; dj <= radiusCells; dj++) {
        cells.add(`${gi + di}:${gj + dj}`);
      }
    }
  }
  return cells;
}

async function loadParser() {
  const mod = await import("osm-pbf-parser");
  return mod.default || mod;
}

export async function extractRoadGridFromPbf(sourceKey = "us", { force = false } = {}) {
  const outPath = roadsIndexPath(sourceKey);
  if (!force && fs.existsSync(outPath)) {
    const cached = readJson(outPath);
    console.log(`Using cached road index (${cached.segmentCount} segments): ${outPath}`);
    return cached;
  }

  const viewpoints = loadViewpoints(sourceKey);
  if (!viewpoints.length) {
    throw new Error(
      `No scenic viewpoints for ${sourceKey} — run viewpoint ingest first: node build-poi-osm-ingest-pbf.mjs --kind=viewpoint --source=${sourceKey}`
    );
  }

  const targetCells = buildViewpointCellSet(viewpoints);
  const pbf = pbfFilePath(sourceKey);
  if (!fs.existsSync(pbf)) throw new Error(`Missing PBF: ${pbf}`);
  const parser = await loadParser();

  const nodeCoords = new Map();
  const segments = [];

  console.log(
    `Scanning ${pbf} for roads near ${viewpoints.length} viewpoints (${targetCells.size} grid cells)...`
  );

  await pipeline(
    createReadStream(pbf),
    parser(),
    new Writable({
      objectMode: true,
      write(chunks, _enc, cb) {
        try {
          for (const item of chunks) {
            if (item.type === "node") {
              const key = cellKey(item.lat, item.lon);
              if (!targetCells.has(key)) continue;
              nodeCoords.set(item.id, { lat: item.lat, lon: item.lon });
            } else if (item.type === "way") {
              const tags = item.tags || {};
              if (!isDrivableHighway(tags, { lean: true })) continue;
              const refs = item.refs || [];
              if (refs.length < 2) continue;
              let prev = null;
              for (const id of refs) {
                const c = nodeCoords.get(id);
                if (!c) {
                  prev = null;
                  continue;
                }
                if (prev) segments.push([prev.lat, prev.lon, c.lat, c.lon]);
                prev = c;
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

  console.log(`  ${nodeCoords.size} nodes, ${segments.length} segments near viewpoints`);
  const index = buildSegmentGridIndex(segments, INDEX_CELL_DEG);
  const payload = {
    generated: new Date().toISOString(),
    source: sourceKey,
    pbf,
    mode: "viewpoint-guided",
    viewpointCount: viewpoints.length,
    targetCellCount: targetCells.size,
    segmentCount: segments.length,
    cellDeg: index.cellDeg,
    segments: index.segments,
    grid: index.grid,
  };

  fs.mkdirSync(ROADS_DIR, { recursive: true });
  writeJson(outPath, payload);
  const mb = Math.round((fs.statSync(outPath).size / (1024 * 1024)) * 10) / 10;
  console.log(`Wrote ${outPath} (${mb} MB, ${segments.length} segments)`);
  return payload;
}

export { roadsIndexPath };

if (process.argv[1]?.endsWith("build-scenic-roads-extract-pbf.mjs")) {
  const sourceKey = process.argv.find((a) => a.startsWith("--source="))?.slice(9) || "us";
  const force = process.argv.includes("--refresh");
  extractRoadGridFromPbf(sourceKey, { force }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
