/**
 * Resumable per-tile cache for scenic road-access features.
 */
import fs from "fs";
import path from "path";
import { ingestDir, readJson } from "./poi-osm-lib.mjs";

export function tileCacheDir(region) {
  return path.join(ingestDir(region, "viewpoint"), "road-distances-tiles");
}

export function manifestPath(region) {
  return path.join(ingestDir(region, "viewpoint"), "road-distances.manifest.json");
}

function tileFilePath(region, tileKey) {
  return path.join(tileCacheDir(region), `${tileKey.replace(":", "_")}.json`);
}

function lockPath(region) {
  return path.join(ingestDir(region, "viewpoint"), "road-distances.lock");
}

function writeJsonAtomic(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj), "utf8");
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch { /* ignore */ }
  fs.renameSync(tmp, filePath);
}

function pidAlive(pid) {
  if (!pid || !Number.isFinite(pid)) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function acquireScanLock(region, { staleMs = 7200000 } = {}) {
  const lp = lockPath(region);
  if (fs.existsSync(lp)) {
    const raw = fs.readFileSync(lp, "utf8").trim();
    const [pidStr, startedStr] = raw.split(":");
    const pid = Number(pidStr);
    const started = Number(startedStr);
    if (pidAlive(pid) && Date.now() - (started || 0) < staleMs) {
      throw new Error(`Scenic road-distance scan already running (pid ${pid}). Delete ${lp} if stale.`);
    }
  }
  fs.mkdirSync(path.dirname(lp), { recursive: true });
  fs.writeFileSync(lp, `${process.pid}:${Date.now()}`, "utf8");
}

export function releaseScanLock(region) {
  const lp = lockPath(region);
  try {
    if (fs.existsSync(lp) && Number(fs.readFileSync(lp, "utf8").split(":")[0]) === process.pid) fs.unlinkSync(lp);
  } catch { /* ignore */ }
}

export function clearTileCache(region) {
  const dir = tileCacheDir(region);
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (f.endsWith(".json")) fs.unlinkSync(path.join(dir, f));
  const mp = manifestPath(region);
  if (fs.existsSync(mp)) fs.unlinkSync(mp);
}

export function writeTileCheckpoint(region, tileKey, { features, distances }, manifestMeta) {
  writeJsonAtomic(tileFilePath(region, tileKey), { tileKey, generated: new Date().toISOString(), features, distances });
  const mp = manifestPath(region);
  const manifest = fs.existsSync(mp) ? readJson(mp) : { completedTiles: [] };
  if (!manifest.completedTiles.includes(tileKey)) manifest.completedTiles.push(tileKey);
  manifest.completedTiles.sort();
  Object.assign(manifest, manifestMeta, { updated: new Date().toISOString(), tileCount: manifest.completedTiles.length });
  writeJsonAtomic(mp, manifest);
}

export function loadMergedFromTiles(region) {
  const dir = tileCacheDir(region);
  const features = {};
  const distances = {};
  const completedTiles = [];
  if (!fs.existsSync(dir)) return { features, distances, completedTiles };
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const j = readJson(path.join(dir, f));
    if (!j?.tileKey) continue;
    completedTiles.push(j.tileKey);
    Object.assign(features, j.features || {});
    Object.assign(distances, j.distances || {});
  }
  completedTiles.sort();
  return { features, distances, completedTiles };
}

export function writeFinalRoadDistancesCache(cachePath, payload) {
  writeJsonAtomic(cachePath, payload);
}

export function cacheStatus(region, cachePath) {
  const manifest = fs.existsSync(manifestPath(region)) ? readJson(manifestPath(region)) : null;
  const merged = loadMergedFromTiles(region);
  const main = fs.existsSync(cachePath) ? readJson(cachePath) : null;
  const lock = fs.existsSync(lockPath(region)) ? fs.readFileSync(lockPath(region), "utf8").trim() : null;
  return {
    lock,
    manifest,
    tileFeatures: Object.keys(merged.features).length,
    tileCompleted: merged.completedTiles.length,
    mainPartial: main?.partial,
    mainFeatures: main?.features ? Object.keys(main.features).length : 0,
    mainViewpointCount: main?.viewpointCount,
  };
}