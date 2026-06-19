/**
 * Osmium CLI helpers for scenic road-distance pipeline.
 * Bundled osmium: tools/vendor/micromamba (see build-scenic-install-osmium.mjs).
 */
import { execSync, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { SCENIC_ROAD_INDEX_HIGHWAYS } from "./poi-road-network.mjs";
import { PBF_DIR, pbfFilePath } from "./poi-osm-pbf-config.mjs";
import { formatDuration, log } from "./pipeline-log.mjs";

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));

export const HIGHWAYS_DIR = path.join(PBF_DIR, "highways");
export const CLIPS_DIR = path.join(PBF_DIR, "road-clips");
export const DEFAULT_MAX_MEASURE_M = 250;
export const VIEWPORT_TILE_DEG = 0.0045;
export const SUPER_TILE_DEG = 0.5;

function bundledOsmiumCandidates() {
  const base = path.join(TOOLS_DIR, "vendor", "micromamba", "root", "envs", "osmium");
  return [
    path.join(base, "bin", "osmium"),
    path.join(base, "Library", "bin", "osmium.exe"),
  ];
}

export function osmiumExePath() {
  for (const bundled of bundledOsmiumCandidates()) {
    if (fs.existsSync(bundled)) return bundled;
  }
  for (const cmd of ["osmium", "osmium-tool"]) {
    const r = spawnSync(cmd, ["--version"], { encoding: "utf8", shell: true });
    if (r.status === 0) return cmd;
  }
  return null;
}

export function isOsmiumAvailable() {
  return Boolean(osmiumExePath());
}

/** Scenic road pipeline requires osmium — call at script entry. */
export function requireOsmium() {
  const exe = osmiumExePath();
  if (exe) return exe;
  throw new Error(
    "osmium-tool is required for scenic road-distance pipeline.\n" +
      "  Install: node build-scenic-install-osmium.mjs\n" +
      "  Or system package: apt install osmium-tool / conda install -c conda-forge osmium-tool"
  );
}

export function highwayTagFilters() {
  return [...SCENIC_ROAD_INDEX_HIGHWAYS].map((h) => `w/highway=${h}`);
}

export function highwaysPbfPath(sourceKey) {
  return path.join(HIGHWAYS_DIR, `highways-${sourceKey}.osm.pbf`);
}

export function highwaysMetaPath(sourceKey) {
  return path.join(HIGHWAYS_DIR, `highways-${sourceKey}.meta.json`);
}

export function runOsmium(args) {
  const exe = osmiumExePath();
  if (!exe) throw new Error("osmium not found — run: node build-scenic-install-osmium.mjs");
  execSync(`"${exe}" ${args}`, { stdio: "inherit", shell: true });
}

export function bboxOsmiumArg({ minLon, minLat, maxLon, maxLat }) {
  return `${minLon},${minLat},${maxLon},${maxLat}`;
}

export function padDegForMeters(m, lat = 55) {
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos((lat * Math.PI) / 180);
  return {
    lat: m / mPerDegLat,
    lon: m / mPerDegLon,
  };
}

export function buildHighwaysExtract(sourceKey, { refresh = false } = {}) {
  const srcPbf = pbfFilePath(sourceKey);
  const outPbf = highwaysPbfPath(sourceKey);
  const metaPath = highwaysMetaPath(sourceKey);
  const srcStat = fs.statSync(srcPbf);
  const cacheKey = `${srcPbf}|${srcStat.mtimeMs}|highways-v1`;

  if (!refresh && fs.existsSync(outPbf) && fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    if (meta.cacheKey === cacheKey) {
      log(`using cached highways extract (${meta.sizeMb} MB): ${outPbf}`);
      return { outPbf, meta };
    }
    log("source PBF changed — rebuilding highways extract");
  }

  fs.mkdirSync(HIGHWAYS_DIR, { recursive: true });
  log(`osmium tags-filter → ${path.basename(outPbf)} (from ${path.basename(srcPbf)})`);
  const filters = highwayTagFilters().join(" ");
  const t0 = Date.now();
  runOsmium(`tags-filter "${srcPbf}" -o "${outPbf}" --overwrite ${filters}`);
  const outStat = fs.statSync(outPbf);
  const sizeMb = Math.round((outStat.size / (1024 * 1024)) * 10) / 10;
  const meta = {
    cacheKey,
    sourceKey,
    srcPbf,
    outPbf,
    sizeMb,
    elapsedSec: Math.round((Date.now() - t0) / 1000),
    generated: new Date().toISOString(),
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");
  log(`highways extract ready: ${sizeMb} MB in ${formatDuration(Date.now() - t0)}`);
  return { outPbf, meta };
}

export function extractHighwaysBbox(inputPbf, bbox, outputPbf) {
  fs.mkdirSync(path.dirname(outputPbf), { recursive: true });
  runOsmium(`extract -b ${bboxOsmiumArg(bbox)} "${inputPbf}" -o "${outputPbf}" --overwrite`);
}