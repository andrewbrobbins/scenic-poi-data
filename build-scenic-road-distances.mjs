/**
 * Compute nearest drivable-road distance for every scenic viewpoint; cache for fast re-filtering.
 * Requires osmium-tool (see build-scenic-install-osmium.mjs).
 */
import fs from "fs";
import path from "path";
import { ingestDir, readJson, writeJson } from "./poi-osm-lib.mjs";
import { pbfFilePath } from "./poi-osm-pbf-config.mjs";
import { formatDuration, log, logSection } from "./pipeline-log.mjs";
import {
  DEFAULT_MAX_MEASURE_M,
  SUPER_TILE_DEG,
  buildHighwaysExtract,
  requireOsmium,
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

const CACHE_MODE = "osmium-features-v3";

export function roadDistancesCachePath(region) {
  return path.join(ingestDir(region, "viewpoint"), "road-distances.json");
}

function parseArgs() {
  const out = {
    regions: ["us", "ca"],
    sourceByRegion: { us: "us", ca: "ca" },
    refresh: false,
    stateFilter: null,
    maxMeasureM: DEFAULT_MAX_MEASURE_M,
  };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--region=")) out.regions = [arg.slice(9)];
    else if (arg.startsWith("--source=")) {
      const sk = arg.slice(9);
      for (const r of out.regions) out.sourceByRegion[r] = sk;
    } else if (arg === "--refresh") out.refresh = true;
    else if (arg.startsWith("--state=")) out.stateFilter = arg.slice(8);
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
    maxMeasureM = DEFAULT_MAX_MEASURE_M,
  } = {}
) {
  requireOsmium();

  const sk = sourceKey || region;
  const cachePath = roadDistancesCachePath(region);
  const pbf = pbfFilePath(sk);
  if (!fs.existsSync(pbf)) throw new Error(`Missing PBF: ${pbf}`);

  const pbfStat = fs.statSync(pbf);
  const cacheKey = `${pbf}|${pbfStat.mtimeMs}|${CACHE_MODE}|super${SUPER_TILE_DEG}|max${maxMeasureM}|paths-v1`;

  if (!refresh && fs.existsSync(cachePath)) {
    const cached = readJson(cachePath);
    const featN = Object.keys(cached?.features || {}).length;
    if (cached?.cacheKey === cacheKey && cached?.partial === false && featN > 0) {
      const expected = cached.viewpointCount || featN;
      if (featN >= expected) {
        log(`using cached road distances (${featN} viewpoints, mode=${cached.mode}): ${cachePath}`);
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
          mode: CACHE_MODE,
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
  log(`${toCompute.length} viewpoints, mode=${CACHE_MODE}, max-measure=${maxMeasureM}m`);

  let lockHeld = false;
  try {
    acquireScanLock(region);
    lockHeld = true;

    const t0 = Date.now();
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

    const result = await computeDistancesOsmium(highwaysPbf, toCompute, {
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

    const { distances, features, withRoad, withoutRoad, passCount, tileCount } = result;
    const far = result.far || 0;

    const payload = {
      generated: new Date().toISOString(),
      region,
      sourceKey: sk,
      mode: CACHE_MODE,
      cacheKey,
      maxMeasureM,
      passCount,
      tileCount,
      viewpointCount: Object.keys(features).length,
      withRoad,
      withoutRoad,
      far,
      stateFilter: stateFilter || "",
      partial: false,
      distances,
      features,
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
      `cached ${featN} viewpoints in ${formatDuration(Date.now() - t0)} (${withRoad} within ${maxMeasureM}m, ${far} far, ${withoutRoad} no road, ${passCount} tiles)`
    );
    log(`wrote ${cachePath}`);
    return payload;
  } finally {
    if (lockHeld) releaseScanLock(region);
  }
}

if (process.argv[1]?.endsWith("build-scenic-road-distances.mjs")) {
  const args = parseArgs();
  requireOsmium();
  for (const region of args.regions) {
    await computeScenicRoadDistances(region, {
      sourceKey: args.sourceByRegion[region],
      refresh: args.refresh,
      stateFilter: args.stateFilter,
      maxMeasureM: args.maxMeasureM,
    });
  }
}
