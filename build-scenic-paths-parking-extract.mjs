/**
 * Extract foot paths + parking nodes for scenic trail-adjacent detection.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PBF_DIR, pbfFilePath } from "./poi-osm-pbf-config.mjs";
import { formatDuration, log } from "./pipeline-log.mjs";
import { runOsmium, isOsmiumAvailable } from "./scenic-osmium-lib.mjs";

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PATHS_PARKING_DIR = path.join(PBF_DIR, "paths-parking");

export function pathsParkingPbfPath(sourceKey) {
  return path.join(PATHS_PARKING_DIR, `paths-parking-${sourceKey}.osm.pbf`);
}

export function pathsParkingMetaPath(sourceKey) {
  return path.join(PATHS_PARKING_DIR, `paths-parking-${sourceKey}.meta.json`);
}

function pathTagFilters() {
  const hw = ["footway", "path", "cycleway", "bridleway", "pedestrian", "steps", "track"];
  return [
    ...hw.map((h) => `w/highway=${h}`),
    "n/amenity=parking",
    "w/highway=rest_area",
    "w/rest_area=yes",
  ];
}

export function buildPathsParkingExtract(sourceKey, { refresh = false } = {}) {
  if (!isOsmiumAvailable()) throw new Error("osmium required");
  const srcPbf = pbfFilePath(sourceKey);
  const outPbf = pathsParkingPbfPath(sourceKey);
  const metaPath = pathsParkingMetaPath(sourceKey);
  const srcStat = fs.statSync(srcPbf);
  const cacheKey = `${srcPbf}|${srcStat.mtimeMs}|paths-parking-v1`;
  if (!refresh && fs.existsSync(outPbf) && fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    if (meta.cacheKey === cacheKey) {
      log(`using cached paths/parking extract (${meta.sizeMb} MB): ${outPbf}`);
      return { outPbf, meta };
    }
  }
  fs.mkdirSync(PATHS_PARKING_DIR, { recursive: true });
  log(`osmium tags-filter paths/parking -> ${path.basename(outPbf)}`);
  const t0 = Date.now();
  runOsmium(`tags-filter "${srcPbf}" -o "${outPbf}" --overwrite ${pathTagFilters().join(" ")}`);
  const sizeMb = Math.round((fs.statSync(outPbf).size / (1024 * 1024)) * 10) / 10;
  const meta = { cacheKey, sourceKey, outPbf, sizeMb, generated: new Date().toISOString() };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");
  log(`paths/parking extract ready: ${sizeMb} MB in ${formatDuration(Date.now() - t0)}`);
  return { outPbf, meta };
}

if (process.argv[1]?.endsWith("build-scenic-paths-parking-extract.mjs")) {
  const sk = process.argv.find((a) => a.startsWith("--source="))?.slice(9) || "ca";
  const refresh = process.argv.includes("--refresh");
  buildPathsParkingExtract(sk, { refresh });
}