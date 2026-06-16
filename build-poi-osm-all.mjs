/**
 * Full POI OSM pipeline (PBF / local parse — replaces slow Overpass bulk ingest).
 *
 * Usage:
 *   node build-poi-osm-all.mjs              # US + CA full build (download if missing)
 *   node build-poi-osm-all.mjs --proof      # Texas proof only (~350 MB download)
 *   node build-poi-osm-all.mjs --skip-download
 *   node build-poi-osm-all.mjs --kind=playground
 */
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const tools = path.dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const out = { proof: false, skipDownload: false, extra: [] };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--proof") out.proof = true;
    else if (arg === "--skip-download") out.skipDownload = true;
    else out.extra.push(arg);
  }
  return out;
}

function run(cmd) {
  console.log("\n>>", cmd);
  execSync(cmd, { cwd: tools, stdio: "inherit" });
}

const args = parseArgs();
const flags = args.extra.join(" ");
const sourceFlag = args.proof ? "--proof" : "";

console.log("=== POI OSM pipeline (Geofabrik PBF + local parse) ===\n");

run("node build-poi-osm-install-deps.mjs");

if (!args.skipDownload) {
  run(`node build-poi-osm-download.mjs ${sourceFlag} ${flags}`.trim());
} else {
  console.log("Skipping download (--skip-download)");
}

run(`node build-poi-osm-extract-pbf.mjs ${sourceFlag} ${flags}`.trim());
run(`node build-poi-osm-ingest-pbf.mjs ${sourceFlag} ${flags}`.trim());

const kindsFlag = args.extra.find((a) => a.startsWith("--kind=")) || "";
const scenicOnly = !kindsFlag || kindsFlag.includes("viewpoint");
if (scenicOnly) {
  const roadRegion = args.proof ? "--region=us --source=tx --state=TX" : "";
  run(`node build-scenic-road-distances.mjs ${roadRegion}`.trim());
  run(`node build-scenic-filter-road-access.mjs ${roadRegion}`.trim());
}

const regionFlag = args.proof ? "--region=us" : "";
run(`node build-poi-osm-master.mjs ${regionFlag} ${flags}`.trim());
run(`node build-poi-osm-explorer-embed.mjs ${regionFlag} ${flags}`.trim());

console.log("\nDone. Data © OpenStreetMap contributors (ODbL).");
