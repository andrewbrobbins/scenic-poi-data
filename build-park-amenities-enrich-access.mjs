/**
 * Enrich campground access (road vs trail) on park amenities master.
 *
 * Usage:
 *   node build-park-amenities-enrich-access.mjs --region=us
 *   node build-park-amenities-enrich-access.mjs --region=us --fetch-trails --state=CA,MT,WY
 */
import path from "path";
import { fileURLToPath } from "url";
import {
  loadUsMasterRecords,
  QA_PATH as US_QA,
  readJson,
  writeJson,
  writeUsMasterShards,
} from "./park-amenities-us-lib.mjs";
import {
  MASTER_PATH as CA_MASTER,
  QA_PATH as CA_QA,
} from "./park-amenities-ca-lib.mjs";
import { enrichAccessOnRecords, fetchTrailCaches } from "./park-amenities-access-lib.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));

function parseStatesArg() {
  const m = process.argv.find((a) => a.startsWith("--state="));
  if (!m) return null;
  return m
    .slice(8)
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

async function enrichRegion(region) {
  const qaPath = region === "ca" ? CA_QA : US_QA;
  let master;
  let records;
  if (region === "ca") {
    master = readJson(CA_MASTER, { records: [] });
    records = master.records || [];
  } else {
    master = loadUsMasterRecords();
    records = master.records || [];
  }

  const campgroundStates = new Set();
  for (const r of records) {
    if (r.kind === "campground" && r.state) campgroundStates.add(r.state);
  }

  if (process.argv.includes("--fetch-trails")) {
    const want = parseStatesArg() || [...campgroundStates].sort();
    if (want.length) {
      console.log("Fetching trail caches for:", want.join(", "));
      await fetchTrailCaches(want);
    }
  }

  const stats = enrichAccessOnRecords(records);
  if (region === "ca") {
    master.generated = new Date().toISOString();
    master.accessEnriched = true;
    master.byAccessMode = stats.byAccess;
    master.records = records;
    writeJson(CA_MASTER, master);
  } else {
    writeUsMasterShards(records, { accessEnriched: true });
  }

  const qa = readJson(qaPath, {});
  qa.accessEnrichment = stats;
  qa.generated = new Date().toISOString();
  writeJson(qaPath, qa);

  console.log(region.toUpperCase(), "access enrich:", stats);
  return stats;
}

async function main() {
  const regionArg = process.argv.find((a) => a.startsWith("--region="));
  const region = regionArg?.slice(9) || "all";
  if (region === "all" || region === "us") await enrichRegion("us");
  if (region === "all" || region === "ca") await enrichRegion("ca");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
