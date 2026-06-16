/**
 * Compute nearest drivable-road distance for every scenic viewpoint; cache for fast re-filtering.
 * Uses osmium bbox clips + per-tile resumable checkpoints (see scenic-road-cache.mjs).
 */
import fs from "fs";
import path from "path";
import { ingestDir, readJson, writeJson } from "./poi-osm-lib.mjs";
import { pbfFilePath } from "./poi-osm-pbf-config.mjs";
import {
  computeDistancesTiled,
  DEFAULT_TILE_DEG,
  DEFAULT_CELL_BUDGET,
} from "./scenic-road-tile-scan.mjs";
import { formatDuration, log, logSection } from "./pipeline-log.mjs";
import {
  DEFAULT_MAX_MEASURE_M,
  SUPER_TILE_DEG,
  buildHighwaysExtract,
  isOsmiumAvailable,
} from "./scenic-osmium-lib.mjs";
import { buildPathsParkingExtract, pathsParkingPbfPath } from "./build-scenic-paths-parking-extract.mjs";
import { computeDistancesOsmium, groupViewpointsBySuperTile } from "./scenic-road-osmium-scan.mjs";
import {
  acquireScanLock,
  releaseScanLock,
  clearTileCache,
  writeTileCheckpoint,
  loadMergedFromTiles,
  writeFinalRoadDistancesCache,
  manifestPath,
} from "./scenic-road-cache.mjs";

export function roadDistancesCachePath(region) {
  return path.join(ingestDir(region, "viewpoint"), "road-distances.json");
}

function parseArgs() {
  const out = {
    regions: ["us", "ca"],
    sourceByRegion: { us: "us", ca: "ca" },
    refresh: false,
    stateFilter: null,
    tileDeg: DEFAULT_TILE_DEG,
    cellBudget: DEFAULT_CELL_BUDGET,
    maxMeasureM: DEFAULT_MAX_MEASURE_M,
    forceLegacy: false,
  };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--region=")) out.regions = [arg.slice(9)];
    else if (arg.startsWith("--source=")) {
      const sk = arg.slice(9);
      for (const r of out.regions) out.sourceByRegion[r] = sk;
    } else if (arg === "--refresh") out.refresh = true;
    else if (arg === "--legacy") out.forceLegacy = true;
    else if (arg.startsWith("--state=")) out.stateFilter = arg.slice(8);
    else if (arg.startsWith("--tile-deg=")) out.tileDeg = Number(arg.slice(11));
    else if (arg.startsWith("--cell-budget=")) out.cellBudget = Number(arg.slice(14));
    else if (arg.startsWith("--max-measure-m=")) out.maxMeasureM = Number(arg.slice(16));
  }
  return out;
}

function loadUnfilteredViewpoints(region) {
  const outDir = ingestDir(region, "viewpoint");
  const unfilteredPath = path.join(outDir, "merged-unfiltered.json");
  const mergedPath = path.join(outDir, "merged.json");
  const j = readJson(fs.existsSync(unfilteredPath) ? unfilteredPath : mergedPath);
  if (!j?.records?.length) throw new Error(`No scenic ingest for ${region}`);
  return { records: j.records, unfilteredPath, mergedPath };
}

export async function computeScenicRoadDistances(
  region,
  {
    sourceKey,
    refresh = false,
    stateFilter = null,
    tileDeg = DEFAULT_TILE_DEG,
    cellBudget = DEFAULT_CELL_BUDGET,
    maxMeasureM = DEFAULT_MAX_MEASURE_M,
    forceLegacy = false,
  } = {}
) {
  const sk = sourceKey || region;
  const cachePath = roadDistancesCachePath(region);
  const pbf = pbfFilePath(sk);
  if (!fs.existsSync(pbf)) throw new Error(`Missing PBF: ${pbf}`);

  const useOsmium = !forceLegacy && isOsmiumAvailable();
  const pbfStat = fs.statSync(pbf);
  const cacheKey = useOsmium
    ? `${pbf}|${pbfStat.mtimeMs}|osmium-features-v3|super${SUPER_TILE_DEG}|max${maxMeasureM}|paths-v1`
    : `${pbf}|${pbfStat.mtimeMs}|tile${tileDeg}|budget${cellBudget}|v2`;

  if (!refresh && fs.existsSync(cachePath)) {
    const cached = readJson(cachePath);
    if (cached?.cacheKey === cacheKey && cached?.partial === false && cached?.features) {
      const n = Object.keys(cached.features).length;
      const expected = cached.viewpointCount || n;
      if (n >= expected) {
        log(`using cached road distances (${n} viewpoints, mode=${cached.mode}): ${cachePath}`);
        return cached;
      }
    }
  }

  const { records, unfilteredPath, mergedPath } = loadUnfilteredViewpoints(region);
  if (!fs.existsSync(unfilteredPath)) {
    writeJson(unfilteredPath, readJson(mergedPath));
    log(`backed up unfiltered scenic -> merged-unfiltered.json`);
  }

  const toCompute = stateFilter ? records.filter((r) => r.state === stateFilter) : records;
  const expectedTileKeys = [...groupViewpointsBySuperTile(toCompute).keys()].sort();

  let existingDistances = null;
  let existingFeatures = null;

  if (refresh) {
    clearTileCache(region);
    log("cleared per-tile checkpoint cache (--refresh)");
  } else {
    const manifest = fs.existsSync(manifestPath(region)) ? readJson(manifestPath(region)) : null;
    if (manifest?.cacheKey === cacheKey) {
      const merged = loadMergedFromTiles(region);
      existingDistances = merged.distances;
      existingFeatures = merged.features;
      const tileComplete =
        manifest.complete === true ||
        (manifest.completedTiles?.length >= expectedTileKeys.length &&
          Object.keys(merged.features).length >= toCompute.length * 0.99);
      if (tileComplete) {
        log(
          `all ${expectedTileKeys.length} tile checkpoints present (${Object.keys(merged.features).length} viewpoints) — assembling final cache`
        );
        const withRoad = Object.values(merged.distances).filter((v) => typeof v === "number").length;
        const far = Object.values(merged.distances).filter((v) => v === "far").length;
        const withoutRoad = Object.values(merged.distances).filter((v) => v === null).length;
        const payload = {
          generated: new Date().toISOString(),
          region,
          sourceKey: sk,
          mode: "osmium-features-v3",
          cacheKey,
          maxMeasureM,
          passCount: manifest.completedTiles.length,
          tileCount: expectedTileKeys.length,
          viewpointCount: Object.keys(merged.features).length,
          withRoad,
          withoutRoad,
          far,
          stateFilter: stateFilter || "",
          partial: false,
          distances: merged.distances,
          features: merged.features,
        };
        writeFinalRoadDistancesCache(cachePath, payload);
        writeJson(manifestPath(region), {
          ...manifest,
          complete: true,
          updated: payload.generated,
        });
        log(`assembled final cache from tiles -> ${cachePath}`);
        return payload;
      }
      log(
        `resuming from tile checkpoints (${merged.completedTiles.length}/${expectedTileKeys.length} tiles, ${Object.keys(merged.features).length} viewpoints)`
      );
    }
  }

  logSection(`scenic ${region}: road distance cache`);
  log(
    `${toCompute.length} viewpoints, mode=${useOsmium ? "osmium-features-v3" : "legacy-batched"}, max-measure=${maxMeasureM}m`
  );

  let lockHeld = false;
  try {
    if (useOsmium) acquireScanLock(region);
    lockHeld = useOsmium;

    const t0 = Date.now();
    let result;

    if (useOsmium) {
      const { outPbf: highwaysPbf } = buildHighwaysExtract(sk, { refresh });
      const { outPbf: pathsParkingPbf } = buildPathsParkingExtract(sk, { refresh });
      const manifestMeta = {
        cacheKey,
        region,
        sourceKey: sk,
        viewpointCount: toCompute.length,
        expectedTileCount: expectedTileKeys.length,
        maxMeasureM,
        superTileDeg: SUPER_TILE_DEG,
      };

      result = await computeDistancesOsmium(highwaysPbf, toCompute, {
        region,
        maxMeasureM,
        existingDistances,
        existingFeatures,
        pathsParkingPbf,
        onBatch(info) {
          writeTileCheckpoint(region, info.tileKey, {
            features: info.tileFeatures,
            distances: info.tileDistances,
          }, manifestMeta);
          if (info.batch === 1 || info.batch === info.total || info.batch % 25 === 0) {
            log(`tile checkpoint ${info.batch}/${info.total} (${info.tileKey}, ${info.viewpoints} vps)`);
          }
        },
      });
    } else {
      log("osmium unavailable — using legacy batched PBF scan", { level: "warn" });
      result = await computeDistancesTiled(pbf, toCompute, {
        tileDeg,
        cellBudget,
        existingDistances,
        onBatch(info) {
          if (info.skipped) return;
          writeJson(cachePath, {
            generated: new Date().toISOString(),
            region,
            sourceKey: sk,
            mode: "batched-pbf-scan",
            cacheKey,
            pbf,
            tileDeg,
            cellBudget,
            partial: true,
            distances: info.distances,
          });
          log(`checkpoint saved after pass ${info.batch}/${info.total}`);
        },
      });
    }

    const { distances, features, withRoad, withoutRoad, passCount, tileCount } = result;
    const far = result.far || 0;

    const payload = {
      generated: new Date().toISOString(),
      region,
      sourceKey: sk,
      mode: useOsmium ? "osmium-features-v3" : "batched-pbf-scan",
      cacheKey,
      maxMeasureM,
      passCount,
      tileCount,
      viewpointCount: Object.keys(features || distances).length,
      withRoad,
      withoutRoad,
      far,
      stateFilter: stateFilter || "",
      partial: false,
      distances,
      features: features || {},
    };

    writeFinalRoadDistancesCache(cachePath, payload);
    writeJson(manifestPath(region), {
      cacheKey,
      complete: true,
      region,
      viewpointCount: payload.viewpointCount,
      tileCount: expectedTileKeys.length,
      completedTiles: expectedTileKeys,
      updated: payload.generated,
    });

    const featN = Object.keys(payload.features).length;
    if (featN !== toCompute.length) {
      log(`warning: feature count ${featN} != viewpoint count ${toCompute.length}`, { level: "warn" });
    }
    log(
      `cached ${featN} distances in ${formatDuration(Date.now() - t0)} (${withRoad} within ${maxMeasureM}m, ${far} far, ${withoutRoad} no road, ${passCount} batches)`
    );
    log(`wrote ${cachePath}`);
    return payload;
  } finally {
    if (lockHeld) releaseScanLock(region);
  }
}

if (process.argv[1]?.endsWith("build-scenic-road-distances.mjs")) {
  const args = parseArgs();
  for (const region of args.regions) {
    await computeScenicRoadDistances(region, {
      sourceKey: args.sourceByRegion[region],
      refresh: args.refresh,
      stateFilter: args.stateFilter,
      tileDeg: args.tileDeg,
      cellBudget: args.cellBudget,
      maxMeasureM: args.maxMeasureM,
      forceLegacy: args.forceLegacy,
    });
  }
}
