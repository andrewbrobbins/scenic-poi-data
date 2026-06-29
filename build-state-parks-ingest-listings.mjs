/**
 * Scrape official agency park listings (and Wikipedia fallback) into allowlist caches.
 *
 * Usage:
 *   node build-state-parks-ingest-listings.mjs
 *   node build-state-parks-ingest-listings.mjs --refresh
 *   node build-state-parks-ingest-listings.mjs --state=TX,CA,FL
 *   node build-state-parks-ingest-listings.mjs --tier-a --refresh
 */
import { log, logSection } from "./pipeline-log.mjs";
import { loadSourceMatrix, verifiedSources, catalogBackedAdmins } from "./state-parks-official-lib.mjs";
import { crossCheckSources, ingestListingForAdmin } from "./state-parks-listing-lib.mjs";

const args = process.argv.slice(2);
const refresh = args.includes("--refresh");
const tierAOnly = args.includes("--tier-a");
const stateArg = args.find((a) => a.startsWith("--state="));
const stateFilter = stateArg
  ? new Set(stateArg.replace("--state=", "").split(",").map((s) => s.trim().toUpperCase()))
  : null;

log("build-state-parks-ingest-listings.mjs starting");
const matrix = loadSourceMatrix();
const crossCheck = crossCheckSources();
const tierAAdmins = new Set([
  ...catalogBackedAdmins(matrix, "US"),
  ...catalogBackedAdmins(matrix, "CA"),
]);

const targets = [];
for (const country of ["US", "CA"]) {
  const key = country === "CA" ? "ca" : "us";
  const rows = crossCheck[key] || {};
  for (const admin of Object.keys(rows)) {
    if (stateFilter && !stateFilter.has(admin)) continue;
    if (tierAOnly && !tierAAdmins.has(admin)) continue;
    if (!rows[admin]?.sources?.some((s) => s.tier === "official_listing")) continue;
    targets.push({ admin, country });
  }
}

logSection(`Listing ingest (${targets.length} admins${tierAOnly ? ", Tier-A only" : ""})`);
let ok = 0;
let skipped = 0;

for (const { admin, country } of targets.sort((a, b) => a.admin.localeCompare(b.admin))) {
  try {
    const payload = await ingestListingForAdmin(admin, country, { force: refresh });
    if (payload.count) {
      const cc = payload.crossCheck || {};
      log(
        `${admin}: ${payload.count} parks via ${payload.scrapeMethod || "cache"} (GIS ${cc.gisRecordCount ?? "?"} / wiki ${cc.wikipediaNameCount ?? "?"})`
      );
      ok += 1;
    } else {
      log(`${admin}: no listing extracted`, { level: "warn" });
      skipped += 1;
    }
  } catch (e) {
    log(`${admin}: ${e.message}`, { level: "warn" });
    skipped += 1;
  }
}

log(`Listing ingest done: ${ok} ok, ${skipped} skipped/empty`);
