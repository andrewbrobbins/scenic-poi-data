/**
 * Local fuel cache lifecycle: PBF fingerprint, manifest, staleness checks.
 * Used by ensure-fuel-cache.mjs and fuel-cache-status.mjs.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PBF_SOURCES, pbfFilePath } from "./poi-osm-pbf-config.mjs";
import { fileSizeMb } from "./poi-osm-pbf-lib.mjs";
import { ALL_FUEL_CACHE_PATH as US_CACHE } from "./fuel-us-lib.mjs";
import { ALL_FUEL_CACHE_PATH as CA_CACHE } from "./fuel-ca-lib.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));

export const FUEL_REGIONS = {
  us: {
    label: "United States",
    pbfSource: "us",
    cachePath: US_CACHE,
    manifestPath: path.join(tools, "fuel-us-ingest", "00-all-fuel", "manifest.json"),
    extractScript: "build-fuel-us-extract-all-pbf.mjs",
    filterScript: "build-fuel-us-filter-brands.mjs",
  },
  ca: {
    label: "Canada",
    pbfSource: "ca",
    cachePath: CA_CACHE,
    manifestPath: path.join(tools, "fuel-ca-ingest", "00-all-fuel", "manifest.json"),
    extractScript: "build-fuel-ca-extract-all-pbf.mjs",
    filterScript: "build-fuel-ca-filter-brands.mjs",
  },
};

/** Smaller PBF for US fuel dev without full ~11 GB extract. */
export const FUEL_PROOF_SOURCE = "tx";

export function pbfFingerprint(pbfPath) {
  if (!fs.existsSync(pbfPath)) return null;
  const st = fs.statSync(pbfPath);
  return {
    path: pbfPath,
    sizeBytes: st.size,
    sizeMb: fileSizeMb(pbfPath),
    mtimeMs: Math.floor(st.mtimeMs),
  };
}

export function readManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return null;
  }
}

export function writeManifest(manifestPath, data) {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export function fingerprintsMatch(a, b) {
  if (!a || !b) return false;
  return a.sizeBytes === b.sizeBytes && a.mtimeMs === b.mtimeMs;
}

export function cacheFileSummary(cachePath) {
  if (!fs.existsSync(cachePath)) return { exists: false };
  const st = fs.statSync(cachePath);
  let recordCount = null;
  try {
    const head = fs.readFileSync(cachePath, "utf8").slice(0, 200000);
    const m = head.match(/"recordCount"\s*:\s*(\d+)/);
    if (m) recordCount = Number(m[1]);
  } catch {
    /* ignore */
  }
  return {
    exists: true,
    sizeMb: fileSizeMb(cachePath),
    mtimeMs: Math.floor(st.mtimeMs),
    recordCount,
  };
}

/**
 * @param {"us"|"ca"} region
 * @param {{ pbfSourceKey?: string }} opts - override PBF (e.g. tx for proof)
 */
export function fuelCacheStatus(region, opts = {}) {
  const cfg = FUEL_REGIONS[region];
  if (!cfg) throw new Error(`Unknown fuel region: ${region}`);

  const pbfSourceKey = opts.pbfSourceKey || cfg.pbfSource;
  const pbfPath = pbfFilePath(pbfSourceKey);
  const pbf = pbfFingerprint(pbfPath);
  const manifest = readManifest(cfg.manifestPath);
  const cache = cacheFileSummary(cfg.cachePath);

  const pbfSource = PBF_SOURCES[pbfSourceKey];
  let stale = false;
  let staleReason = "";

  if (cache.exists && manifest?.pbfFingerprint) {
    if (!fingerprintsMatch(pbf, manifest.pbfFingerprint)) {
      stale = true;
      staleReason = "PBF file changed since cache was built";
    }
  } else if (cache.exists && !manifest) {
    stale = true;
    staleReason = "Cache exists but manifest.json is missing";
  }

  const ready = cache.exists && !stale;
  const needsExtract = !cache.exists || stale;
  const needsDownload = !pbf;

  return {
    region,
    label: cfg.label,
    pbfSourceKey,
    pbfSourceLabel: pbfSource?.label || pbfSourceKey,
    pbf,
    pbfPath,
    manifest,
    cache,
    cachePath: cfg.cachePath,
    manifestPath: cfg.manifestPath,
    stale,
    staleReason,
    ready,
    needsDownload,
    needsExtract,
    extractScript: cfg.extractScript,
    filterScript: cfg.filterScript,
  };
}

export function formatStatusLine(st) {
  const parts = [];
  parts.push(`[${st.region.toUpperCase()}]`);
  parts.push(st.pbf ? `PBF ${st.pbf.sizeMb} MB` : "PBF missing");
  parts.push(st.cache.exists ? `cache ${st.cache.sizeMb} MB (${st.cache.recordCount ?? "?"} POIs)` : "cache missing");
  if (st.ready) parts.push("ready");
  else if (st.stale) parts.push(`stale: ${st.staleReason}`);
  else if (st.needsDownload) parts.push("needs download");
  else if (st.needsExtract) parts.push("needs extract");
  return parts.join(" | ");
}
