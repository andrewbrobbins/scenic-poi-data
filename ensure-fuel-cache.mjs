/**
 * Bootstrap local fuel workflow on any repo clone:
 *   1) Node deps (osm-pbf-parser)
 *   2) Download Geofabrik PBF locally (gitignored, not in GitHub)
 *   3) Extract all fuel POIs to fuel-*-ingest/00-all-fuel/ cache (slow once)
 *
 * After this, iterate on catalog rules with filter-only scripts (no PBF parse).
 *
 * Usage:
 *   node ensure-fuel-cache.mjs --region=us
 *   node ensure-fuel-cache.mjs --region=both
 *   node ensure-fuel-cache.mjs --region=us --proof          # Texas PBF (~350 MB)
 *   node ensure-fuel-cache.mjs --region=us --skip-download  # extract only
 *   node ensure-fuel-cache.mjs --region=us --force-extract
 */
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { FUEL_PROOF_SOURCE, FUEL_REGIONS, fuelCacheStatus } from "./fuel-cache-lib.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const regionArg = process.argv.find((a) => a.startsWith("--region="));
  const regionVal = regionArg ? regionArg.split("=")[1] : "us";
  let regions;
  if (regionVal === "both") regions = Object.keys(FUEL_REGIONS);
  else if (FUEL_REGIONS[regionVal]) regions = [regionVal];
  else throw new Error(`Unknown --region=${regionVal}`);

  return {
    regions,
    proof: process.argv.includes("--proof"),
    skipDownload: process.argv.includes("--skip-download"),
    forceExtract: process.argv.includes("--force-extract"),
    skipDeps: process.argv.includes("--skip-deps"),
  };
}

function run(cmd) {
  console.log("\n$", cmd);
  execSync(cmd, { cwd: tools, stdio: "inherit" });
}

async function ensureRegion(region, opts) {
  const pbfSourceKey = opts.proof && region === "us" ? FUEL_PROOF_SOURCE : FUEL_REGIONS[region].pbfSource;
  let st = fuelCacheStatus(region, { pbfSourceKey });

  console.log(`\n=== ${st.label} (${region}) ===`);

  if (!opts.skipDeps) {
    run("node build-poi-osm-install-deps.mjs");
  }

  if (st.needsDownload && !opts.skipDownload) {
    run(`node build-poi-osm-download.mjs --source=${pbfSourceKey}`);
    st = fuelCacheStatus(region, { pbfSourceKey });
  }

  if (st.needsDownload) {
    throw new Error(
      `PBF still missing at ${st.pbfPath}. Run: node build-poi-osm-download.mjs --source=${pbfSourceKey}`
    );
  }

  if (st.ready && !opts.forceExtract) {
    console.log("Cache ready — skip extract. Use --force-extract to rescan PBF.");
    return st;
  }

  const extractScript = FUEL_REGIONS[region].extractScript;
  const refresh = opts.forceExtract || st.stale || st.needsExtract;
  run(`node ${extractScript}${refresh ? " --refresh" : ""}`);

  st = fuelCacheStatus(region, { pbfSourceKey });
  if (!st.ready) throw new Error(`Extract finished but cache not ready: ${st.cachePath}`);
  return st;
}

const opts = parseArgs();

try {
  for (const region of opts.regions) {
    await ensureRegion(region, opts);
  }
  console.log("\nFuel cache ready. Fast catalog iteration:");
  console.log("  node build-fuel-us-filter-brands.mjs   # US");
  console.log("  node build-fuel-ca-filter-brands.mjs   # CA");
  console.log("  node build-fuel-us-master.mjs && node build-fuel-explorer-data.mjs");
  console.log("  Open fuel-explorer.html");
} catch (e) {
  console.error("\n" + e.message);
  process.exit(1);
}
