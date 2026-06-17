/**
 * Report local fuel PBF + extract cache status.
 * Usage: node fuel-cache-status.mjs [--region=us|ca|both]
 */
import { FUEL_REGIONS, formatStatusLine, fuelCacheStatus } from "./fuel-cache-lib.mjs";

function parseRegions() {
  const arg = process.argv.find((a) => a.startsWith("--region="));
  const v = arg ? arg.split("=")[1] : "both";
  if (v === "both") return Object.keys(FUEL_REGIONS);
  if (FUEL_REGIONS[v]) return [v];
  console.error("Unknown region:", v);
  process.exit(1);
}

const regions = parseRegions();
let anyReady = false;

console.log("Fuel local cache status\n");

for (const region of regions) {
  const st = fuelCacheStatus(region);
  console.log(formatStatusLine(st));
  if (st.pbf) console.log(`  PBF: ${st.pbfPath}`);
  else console.log(`  PBF: (missing) expected at ${st.pbfPath}`);
  console.log(`  Cache: ${st.cachePath}`);
  if (st.manifest) console.log(`  Manifest: ${st.manifest.generated} (${st.manifest.recordCount ?? "?"} records)`);
  if (st.ready) {
    anyReady = true;
    console.log("  → Re-filter without PBF: node", st.filterScript);
  } else {
    if (st.needsDownload) console.log("  → Download: node build-poi-osm-download.mjs --source=" + st.pbfSourceKey);
    if (st.needsExtract) console.log("  → Extract: node", st.extractScript, st.stale ? "--refresh" : "");
    console.log("  → Or bootstrap: node ensure-fuel-cache.mjs --region=" + region);
  }
  console.log("");
}

if (!anyReady) {
  console.log("No fuel cache ready. Run: node ensure-fuel-cache.mjs --region=us");
  process.exit(1);
}
