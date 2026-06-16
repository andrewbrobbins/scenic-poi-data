/**
 * Batched PBF road scan for scenic viewpoint distances.
 * Groups many geographic tiles into one PBF pass (typically 4-15 passes, not hundreds).
 */
import { createReadStream } from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { Writable } from "stream";
import {
  buildSegmentGridIndex,
  isDrivableHighway,
  nearestRoadDistanceM,
} from "./poi-road-network.mjs";
import { createProgressTicker, formatDuration, formatEta, log } from "./pipeline-log.mjs";

/** ~440 m cells; radius 2 => ~2.2 km search envelope (enough for 120 m road filter). */
export const INDEX_CELL_DEG = 0.004;
export const VIEWPOINT_CELL_RADIUS = 2;
export const DEFAULT_TILE_DEG = 2.0;
/** Max approximate grid cells per PBF pass (memory vs speed tradeoff). */
export const DEFAULT_CELL_BUDGET = 40000;

export function cellKey(lat, lon, cellDeg = INDEX_CELL_DEG) {
  return `${Math.floor(lat / cellDeg)}:${Math.floor(lon / cellDeg)}`;
}

export function tileKey(lat, lon, tileDeg = DEFAULT_TILE_DEG) {
  return `${Math.floor(lat / tileDeg)}:${Math.floor(lon / tileDeg)}`;
}

export function buildViewpointCellSet(viewpoints, radiusCells = VIEWPOINT_CELL_RADIUS) {
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

export function groupViewpointsByTile(viewpoints, tileDeg = DEFAULT_TILE_DEG) {
  const tiles = new Map();
  for (const v of viewpoints) {
    if (!Number.isFinite(v.lat) || !Number.isFinite(v.lon)) continue;
    const tk = tileKey(v.lat, v.lon, tileDeg);
    if (!tiles.has(tk)) tiles.set(tk, []);
    tiles.get(tk).push(v);
  }
  return tiles;
}

export function buildAdaptiveBatches(viewpoints, { tileDeg = DEFAULT_TILE_DEG, cellBudget = DEFAULT_CELL_BUDGET } = {}) {
  const tiles = groupViewpointsByTile(viewpoints, tileDeg);
  const entries = [...tiles.entries()].sort((a, b) => b[1].length - a[1].length);
  const batches = [];
  let batch = [];
  let budget = 0;

  for (const [tk, vps] of entries) {
    const cells = buildViewpointCellSet(vps).size;
    if (batch.length > 0 && budget + cells > cellBudget) {
      batches.push(batch);
      batch = [];
      budget = 0;
    }
    batch.push({ tk, viewpoints: vps, cells });
    budget += cells;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

function bboxFromCells(cells, cellDeg) {
  let minGi = Infinity;
  let minGj = Infinity;
  let maxGi = -Infinity;
  let maxGj = -Infinity;
  for (const key of cells) {
    const [gi, gj] = key.split(":").map(Number);
    if (gi < minGi) minGi = gi;
    if (gj < minGj) minGj = gj;
    if (gi > maxGi) maxGi = gi;
    if (gj > maxGj) maxGj = gj;
  }
  if (!Number.isFinite(minGi)) return null;
  const pad = cellDeg * (VIEWPOINT_CELL_RADIUS + 1);
  return {
    minLat: minGi * cellDeg - pad,
    maxLat: (maxGi + 1) * cellDeg + pad,
    minLon: minGj * cellDeg - pad,
    maxLon: (maxGj + 1) * cellDeg + pad,
  };
}

export async function scanRoadSegmentsForViewpoints(pbf, viewpoints, parser, { passLabel = "" } = {}) {
  const targetCells = buildViewpointCellSet(viewpoints);
  const bbox = bboxFromCells(targetCells, INDEX_CELL_DEG);
  const nodeCoords = new Map();
  const segments = [];
  const t0 = Date.now();
  let chunkBatches = 0;
  let osmItems = 0;

  const prefix = passLabel ? `${passLabel} ` : "";
  const ticker = createProgressTicker({
    intervalMs: 15000,
    onTick: () =>
      `${prefix}PBF read: ${chunkBatches} chunks, ${osmItems.toLocaleString()} OSM items, ${nodeCoords.size.toLocaleString()} road nodes, ${segments.length.toLocaleString()} segments, ${formatDuration(Date.now() - t0)} elapsed`,
  });
  ticker.start();
  log(`${prefix}scanning ${path.basename(pbf)} (${viewpoints.length} viewpoints, ${targetCells.size} grid cells)`);

  await pipeline(
    createReadStream(pbf),
    parser(),
    new Writable({
      objectMode: true,
      write(chunks, _enc, cb) {
        try {
          chunkBatches += 1;
          for (const item of chunks) {
            osmItems += 1;
            if (item.type === "node") {
              if (bbox) {
                if (item.lat < bbox.minLat || item.lat > bbox.maxLat) continue;
                if (item.lon < bbox.minLon || item.lon > bbox.maxLon) continue;
              }
              if (!targetCells.has(cellKey(item.lat, item.lon))) continue;
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
          ticker.bump();
          cb();
        } catch (err) {
          cb(err);
        }
      },
    })
  );

  ticker.finish(
    `${prefix}PBF scan done: ${nodeCoords.size.toLocaleString()} nodes, ${segments.length.toLocaleString()} segments in ${formatDuration(Date.now() - t0)}`
  );

  return { segments, nodeCount: nodeCoords.size, cellCount: targetCells.size };
}

function osmKey(rec) {
  if (rec.osm?.type && rec.osm?.id != null) return `${rec.osm.type}:${rec.osm.id}`;
  return rec.id;
}

export async function computeDistancesTiled(
  pbf,
  viewpoints,
  { tileDeg = DEFAULT_TILE_DEG, cellBudget = DEFAULT_CELL_BUDGET, onBatch, existingDistances = null } = {}
) {
  const mod = await import("osm-pbf-parser");
  const parser = mod.default || mod;
  const batches = buildAdaptiveBatches(viewpoints, { tileDeg, cellBudget });
  const tileCount = groupViewpointsByTile(viewpoints, tileDeg).size;
  const distances = existingDistances ? { ...existingDistances } : {};
  let withRoad = 0;
  let withoutRoad = 0;

  for (const rec of viewpoints) {
    const k = osmKey(rec);
    if (distances[k] != null) withRoad += 1;
    else if (distances[k] === null) withoutRoad += 1;
  }

  const alreadyDone = withRoad + withoutRoad;
  log(
    `plan: ${batches.length} PBF pass(es) for ${viewpoints.length} viewpoints (${tileCount} tiles, cell-budget=${cellBudget}` +
      (alreadyDone ? `, ${alreadyDone} already cached` : "") +
      ")"
  );

  const pipelineT0 = Date.now();
  let completedPasses = 0;

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    const batchVps = batch.flatMap((b) => b.viewpoints);
    const pending = batchVps.filter((r) => !(osmKey(r) in distances));
    const passLabel = `pass ${bi + 1}/${batches.length}`;

    if (!pending.length) {
      log(`${passLabel}: skipped (${batchVps.length} viewpoints already cached)`);
      if (onBatch) onBatch({ batch: bi + 1, total: batches.length, skipped: true, viewpoints: batchVps.length });
      completedPasses += 1;
      continue;
    }

    const batchCells = batch.reduce((n, b) => n + b.cells, 0);
    log(`${passLabel} start: ${pending.length} viewpoints, ${batch.length} tiles, ~${batchCells} grid cells`);
    const t0 = Date.now();

    const { segments, nodeCount, cellCount } = await scanRoadSegmentsForViewpoints(pbf, pending, parser, { passLabel });
    log(`${passLabel} indexing ${segments.length.toLocaleString()} road segments...`);
    const index = segments.length ? buildSegmentGridIndex(segments, INDEX_CELL_DEG) : null;

    for (const rec of pending) {
      const key = osmKey(rec);
      const d = index ? nearestRoadDistanceM(rec.lat, rec.lon, index) : null;
      if (d == null) {
        distances[key] = null;
        withoutRoad += 1;
      } else {
        distances[key] = Math.round(d * 10) / 10;
        withRoad += 1;
      }
    }

    completedPasses += 1;
    const doneCount = Object.keys(distances).length;
    const passSec = formatDuration(Date.now() - t0);
    const eta = formatEta(Date.now() - pipelineT0, completedPasses, batches.length);
    log(
      `${passLabel} done: +${pending.length} distances in ${passSec} (${doneCount}/${viewpoints.length} total, ${withRoad} with road, ${withoutRoad} no road, ${eta})`
    );

    if (onBatch) {
      onBatch({
        batch: bi + 1,
        total: batches.length,
        viewpoints: pending.length,
        segments: segments.length,
        nodes: nodeCount,
        cells: cellCount,
        tilesInBatch: batch.length,
        elapsedSec: Math.round((Date.now() - t0) / 1000),
        distances,
      });
    }
  }

  log(`all passes complete in ${formatDuration(Date.now() - pipelineT0)}`);
  return { distances, withRoad, withoutRoad, passCount: batches.length, tileCount };
}