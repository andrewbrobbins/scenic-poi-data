/**
 * Osmium bbox-clip road access feature scan (lean highways + paths/parking extracts).
 */
import fs from "fs";
import path from "path";
import { parseClipFeatures, bruteNearestSegmentM } from "./scenic-road-access-filter.mjs";
import {
  CLIPS_DIR,
  DEFAULT_MAX_MEASURE_M,
  SUPER_TILE_DEG,
  extractHighwaysBbox,
  padDegForMeters,
} from "./scenic-osmium-lib.mjs";
import { formatDuration, formatEta, log } from "./pipeline-log.mjs";
import { haversineM, classifyScenicRoadDistance } from "./poi-road-network.mjs";

export const INDEX_CELL_DEG = 0.0027;

export function superTileKey(lat, lon, tileDeg = SUPER_TILE_DEG) {
  return `${Math.floor(lat / tileDeg)}:${Math.floor(lon / tileDeg)}`;
}

export function bboxForSuperTile(key, { tileDeg = SUPER_TILE_DEG, padM = DEFAULT_MAX_MEASURE_M, latHint = 50 } = {}) {
  const [gi, gj] = key.split(":").map(Number);
  const pad = padDegForMeters(padM, gi * tileDeg);
  return {
    minLat: gi * tileDeg - pad.lat,
    minLon: gj * tileDeg - pad.lon,
    maxLat: (gi + 1) * tileDeg + pad.lat,
    maxLon: (gj + 1) * tileDeg + pad.lon,
  };
}

export function groupViewpointsBySuperTile(viewpoints, tileDeg = SUPER_TILE_DEG) {
  const tiles = new Map();
  for (const v of viewpoints) {
    if (!Number.isFinite(v.lat) || !Number.isFinite(v.lon)) continue;
    const tk = superTileKey(v.lat, v.lon, tileDeg);
    if (!tiles.has(tk)) tiles.set(tk, []);
    tiles.get(tk).push(v);
  }
  return tiles;
}

function osmKey(rec) {
  if (rec.osm?.type && rec.osm?.id != null) return `${rec.osm.type}:${rec.osm.id}`;
  return rec.id;
}

export function classifyRoadDistance(d, maxMeasureM = DEFAULT_MAX_MEASURE_M) {
  return classifyScenicRoadDistance(d, maxMeasureM);
}

function nearestParkingM(lat, lon, points) {
  let best = Infinity;
  for (const p of points) {
    const d = haversineM(lat, lon, p.lat, p.lon);
    if (d < best) best = d;
  }
  return best === Infinity ? null : Math.round(best * 10) / 10;
}

async function parseLeanFromHighwaysClip(pbf) {
  const f = await parseClipFeatures(pbf);
  return f.leanSegments;
}

async function parsePathsParkingFromClip(pbf) {
  const f = await parseClipFeatures(pbf);
  return { pathSegments: f.pathSegments, parkingPoints: f.parkingPoints };
}

export function measureFeaturesFromClips(lat, lon, leanSegments, pathsParking, maxMeasureM = DEFAULT_MAX_MEASURE_M) {
  const rawLean = bruteNearestSegmentM(lat, lon, leanSegments, { maxMeasureM });
  const rawPath = bruteNearestSegmentM(lat, lon, pathsParking?.pathSegments || [], { maxMeasureM });
  const dParking = nearestParkingM(lat, lon, pathsParking?.parkingPoints || []);
  return {
    dLean: rawLean != null && rawLean <= maxMeasureM ? rawLean : null,
    dWide: null,
    dPath: rawPath != null && rawPath <= maxMeasureM ? rawPath : null,
    dParking: dParking != null && dParking <= maxMeasureM ? dParking : null,
    _rawLean: rawLean,
  };
}

export async function computeDistancesOsmium(
  highwaysPbf,
  viewpoints,
  {
    region = "ca",
    maxMeasureM = DEFAULT_MAX_MEASURE_M,
    superTileDeg = SUPER_TILE_DEG,
    existingDistances = null,
    existingFeatures = null,
    pathsParkingPbf = null,
    onBatch,
  } = {}
) {
  const distances = existingDistances ? { ...existingDistances } : {};
  const features = existingFeatures ? { ...existingFeatures } : {};
  const tiles = groupViewpointsBySuperTile(viewpoints, superTileDeg);
  const tileKeys = [...tiles.keys()].sort();
  const pendingTiles = tileKeys.filter((tk) => tiles.get(tk).some((r) => !(osmKey(r) in features)));

  log(
    `osmium plan: ${pendingTiles.length}/${tileKeys.length} super-tiles, ${viewpoints.length} viewpoints, max-measure=${maxMeasureM}m, mode=features-v2`
  );

  const clipDir = path.join(CLIPS_DIR, region);
  fs.mkdirSync(clipDir, { recursive: true });
  const pathPadM = Math.max(maxMeasureM, 600);
  const pipelineT0 = Date.now();
  let withRoad = 0;
  let withoutRoad = 0;
  let far = 0;

  for (const rec of viewpoints) {
    const k = osmKey(rec);
    const v = distances[k];
    if (typeof v === "number") withRoad += 1;
    else if (v === "far") far += 1;
    else if (v === null) withoutRoad += 1;
  }

  for (let i = 0; i < pendingTiles.length; i++) {
    const tk = pendingTiles[i];
    const batchVps = tiles.get(tk).filter((r) => !(osmKey(r) in features));
    if (!batchVps.length) continue;

    const latHint = batchVps[0].lat;
    const roadBbox = bboxForSuperTile(tk, { tileDeg: superTileDeg, padM: maxMeasureM, latHint });
    const pathBbox = bboxForSuperTile(tk, { tileDeg: superTileDeg, padM: pathPadM, latHint });
    const roadClip = path.join(clipDir, `road-${tk.replace(":", "_")}.osm.pbf`);
    const pathClip = path.join(clipDir, `path-${tk.replace(":", "_")}.osm.pbf`);
    const label = `tile ${i + 1}/${pendingTiles.length} ${tk}`;

    log(`${label} extract (${batchVps.length} viewpoints)...`);
    const t0 = Date.now();
    extractHighwaysBbox(highwaysPbf, roadBbox, roadClip);
    const leanSegments = await parseLeanFromHighwaysClip(roadClip);
    try { fs.unlinkSync(roadClip); } catch { /* ignore */ }

    let pathsParking = { pathSegments: [], parkingPoints: [] };
    if (pathsParkingPbf) {
      extractHighwaysBbox(pathsParkingPbf, pathBbox, pathClip);
      pathsParking = await parsePathsParkingFromClip(pathClip);
      try { fs.unlinkSync(pathClip); } catch { /* ignore */ }
    }

    for (const rec of batchVps) {
      const key = osmKey(rec);
      const measured = measureFeaturesFromClips(rec.lat, rec.lon, leanSegments, pathsParking, maxMeasureM);
      const feat = {
        dLean: measured.dLean,
        dWide: measured.dWide,
        dPath: measured.dPath,
        dParking: measured.dParking,
      };
      features[key] = feat;
      const classified = classifyRoadDistance(measured._rawLean ?? measured.dLean, maxMeasureM);
      distances[key] = classified;
      if (typeof classified === "number") withRoad += 1;
      else if (classified === "far") far += 1;
      else withoutRoad += 1;
    }

    const tileFeatures = {};
    const tileDistances = {};
    for (const rec of batchVps) {
      const key = osmKey(rec);
      tileFeatures[key] = features[key];
      tileDistances[key] = distances[key];
    }

    const eta = formatEta(Date.now() - pipelineT0, i + 1, pendingTiles.length);
    log(`${label} done in ${formatDuration(Date.now() - t0)} (${leanSegments.length} lean segs, ${eta})`);

    if (onBatch) {
      onBatch({
        batch: i + 1,
        total: pendingTiles.length,
        tileKey: tk,
        tileFeatures,
        tileDistances,
        viewpoints: batchVps.length,
      });
    }
  }

  log(`osmium scan complete in ${formatDuration(Date.now() - pipelineT0)}`);
  withRoad = 0;
  withoutRoad = 0;
  far = 0;
  for (const v of Object.values(distances)) {
    if (typeof v === "number") withRoad += 1;
    else if (v === "far") far += 1;
    else withoutRoad += 1;
  }
  return { distances, features, withRoad, withoutRoad, far, passCount: pendingTiles.length, tileCount: tileKeys.length };
}