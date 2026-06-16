/**
 * Download Geofabrik PBF extracts for POI pipeline.
 * Usage:
 *   node build-poi-osm-download.mjs [--source=us|ca|tx] [--force]
 */
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { GEOFABRIK_DIR, PBF_SOURCES, pbfFilePath } from "./poi-osm-pbf-config.mjs";
import { ensureDir, fileSizeMb } from "./poi-osm-pbf-lib.mjs";

function parseArgs() {
  const out = { sources: ["us", "ca"], force: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--force") out.force = true;
    else if (arg.startsWith("--source=")) out.sources = [arg.slice(9)];
    else if (arg === "--proof") out.sources = ["tx"];
  }
  return out;
}

async function downloadFile(url, dest) {
  ensureDir(path.dirname(dest));
  const part = dest + ".part";
  console.log("Downloading", url);
  console.log("  →", dest);

  const res = await fetch(url, {
    headers: { "User-Agent": "VancouverTripPOIDB/1.0 (geofabrik; local-dev)" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Download failed HTTP ${res.status}: ${url}`);
  if (!res.body) throw new Error("No response body");

  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(part));
  fs.renameSync(part, dest);
  console.log("  done:", fileSizeMb(dest), "MB");
}

const args = parseArgs();
for (const key of args.sources) {
  const src = PBF_SOURCES[key];
  if (!src) {
    console.error("Unknown source:", key);
    process.exit(1);
  }
  const dest = pbfFilePath(key);
  if (fs.existsSync(dest) && !args.force) {
    console.log(`${src.label}: already have ${src.filename} (${fileSizeMb(dest)} MB)`);
    continue;
  }
  await downloadFile(src.url, dest);
}

console.log("\nPBF files in", GEOFABRIK_DIR);
