/**
 * Validate Canada park amenities outputs.
 */
import fs from "fs";
import { CAMP_TIERS, readJson } from "./park-amenities-lib.mjs";
import { EMBED_PATH, MASTER_PATH, QA_PATH, ROLLUP_PATH } from "./park-amenities-ca-lib.mjs";

let errors = 0;

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  errors += 1;
}

function ok(msg) {
  console.log(`OK: ${msg}`);
}

const master = readJson(MASTER_PATH, { records: [] });
const records = master.records || [];
if (!records.length) fail(`Empty ${MASTER_PATH}`);
else ok(`${MASTER_PATH}: ${records.length} records`);

const pc = records.filter((r) => r.landManager === "Parks Canada");
const prov = records.filter((r) => r.landManager === "Provincial");
ok(`Parks Canada: ${pc.length}, Provincial: ${prov.length}`);

for (const tier of CAMP_TIERS) {
  const n = records.filter((r) => r.kind === "campground" && r.campTier === tier).length;
  ok(`campTier=${tier}: ${n}`);
}

if (!fs.existsSync(EMBED_PATH)) fail(`Missing ${EMBED_PATH}`);
else ok(`${EMBED_PATH} exists`);

const rollup = readJson(ROLLUP_PATH, null);
if (!rollup?.parentCount) fail(`Missing ${ROLLUP_PATH}`);
else ok(`Rollup: ${rollup.parentCount} parents`);

if (errors) process.exit(1);
console.log("\nvalidate-park-amenities-ca: passed");
