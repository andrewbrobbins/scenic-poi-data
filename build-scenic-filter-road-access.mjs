/**
 * Filter scenic viewpoints by cached road-access features (instant threshold changes).
 */
import fs from "fs";
import path from "path";
import { ingestDir, readJson, writeJson } from "./poi-osm-lib.mjs";
import { DEFAULT_ROAD_MAX_DISTANCE_M } from "./poi-road-network.mjs";
import { roadDistancesCachePath } from "./build-scenic-road-distances.mjs";
import { scenicRoadAccessInclude } from "./scenic-road-access-filter.mjs";
import { requireOsmium } from "./scenic-osmium-lib.mjs";
import { log, logSection } from "./pipeline-log.mjs";

function parseArgs() {
  const out = {
    regions: ["us", "ca"],
    maxM: DEFAULT_ROAD_MAX_DISTANCE_M,
    stateFilter: null,
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--region=")) out.regions = [arg.slice(9)];
    else if (arg === "--max-m" && argv[i + 1] != null) {
      const n = Number(argv[++i]);
      if (Number.isFinite(n)) out.maxM = n;
    } else if (arg.startsWith("--max-m=")) {
      const n = Number(arg.slice(7));
      if (Number.isFinite(n)) out.maxM = n;
    } else if (arg.startsWith("--state=")) out.stateFilter = arg.slice(8);
  }
  return out;
}

function osmKey(rec) {
  if (rec.osm?.type && rec.osm?.id != null) return `${rec.osm.type}:${rec.osm.id}`;
  return rec.id;
}

function isWithinRoadAccessLegacy(d, maxM) {
  return typeof d === "number" && Number.isFinite(d) && d <= maxM;
}

export function shouldIncludeScenicViewpoint(cache, rec, maxM = DEFAULT_ROAD_MAX_DISTANCE_M) {
  const key = osmKey(rec);
  const feat = cache?.features?.[key];
  if (feat) return scenicRoadAccessInclude(feat, maxM);
  const d = cache?.distances?.[key];
  return isWithinRoadAccessLegacy(d, maxM);
}

export function filterScenicRoadAccess(region, { maxM = DEFAULT_ROAD_MAX_DISTANCE_M, stateFilter = null } = {}) {
  requireOsmium();

  const kind = "viewpoint";
  const ingest = ingestDir(region, kind);
  const mergedPath = path.join(ingest, "merged.json");
  const unfilteredPath = path.join(ingest, "merged-unfiltered.json");
  const cachePath = roadDistancesCachePath(region);

  if (!fs.existsSync(cachePath)) {
    throw new Error(`Missing ${cachePath} - run: node build-scenic-road-distances.mjs --region=${region}`);
  }

  const cache = readJson(cachePath);
  logSection(`scenic ${region}: road-access filter (max-m=${maxM}, strategy=path-parking-v2)`);
  const featN = Object.keys(cache?.features || {}).length;
  const expected = cache?.viewpointCount || featN;
  if (cache?.partial === true || (expected > 0 && featN < expected * 0.95)) {
    throw new Error(
      `Incomplete road-distance cache (${featN}/${expected} features, partial=${cache?.partial}). ` +
        `Run: node build-scenic-road-distances.mjs --region=${region} --refresh`
    );
  }
  if (featN === 0) {
    throw new Error(
      `Road-distance cache has no features (legacy batched-pbf-scan is removed). ` +
        `Run: node build-scenic-install-osmium.mjs && node build-scenic-road-distances.mjs --region=${region} --refresh`
    );
  }
  const unfiltered = readJson(fs.existsSync(unfilteredPath) ? unfilteredPath : mergedPath);
  if (!unfiltered?.records?.length) throw new Error(`No scenic ingest for ${region}`);

  const toFilter = stateFilter
    ? unfiltered.records.filter((r) => r.state === stateFilter)
    : unfiltered.records;
  const passthrough = stateFilter
    ? unfiltered.records.filter((r) => r.state !== stateFilter)
    : [];

  const kept = [];
  const excluded = [];

  for (const rec of toFilter) {
    const key = osmKey(rec);
    const feat = cache.features?.[key];
    const d = cache.distances?.[key];
    const include = shouldIncludeScenicViewpoint(cache, rec, maxM);
    if (include) {
      kept.push({
        ...rec,
        roadDistanceM: typeof d === "number" ? d : feat?.dLean ?? null,
        roadAccessFeatures: feat || undefined,
      });
    } else {
      excluded.push({
        id: rec.id,
        name: rec.name,
        lat: rec.lat,
        lon: rec.lon,
        state: rec.state,
        roadDistanceM: typeof d === "number" ? d : d === "far" ? ">250" : feat?.dLean ?? null,
        roadAccessFeatures: feat || undefined,
      });
    }
  }

  const allRecords = stateFilter ? [...passthrough, ...kept] : kept;

  const payload = {
    generated: new Date().toISOString(),
    kind,
    region,
    roadAccessMaxM: maxM,
    roadAccessStrategy: "path-parking-v2",
    roadDistancesCache: cachePath,
    stateFilter: stateFilter || "",
    recordCount: allRecords.length,
    filteredCount: kept.length,
    excludedCount: excluded.length,
    records: allRecords,
  };
  writeJson(mergedPath, payload);
  writeJson(path.join(ingest, "road-access-report.json"), {
    generated: payload.generated,
    region,
    maxM,
    strategy: payload.roadAccessStrategy,
    kept: kept.length,
    excluded: excluded.length,
    excludedSample: excluded.slice(0, 40),
  });

  log(`kept ${kept.length} / excluded ${excluded.length} -> ${mergedPath}`);
  return payload;
}

if (process.argv[1]?.endsWith("build-scenic-filter-road-access.mjs")) {
  const args = parseArgs();
  for (const region of args.regions) {
    filterScenicRoadAccess(region, { maxM: args.maxM, stateFilter: args.stateFilter });
  }
}