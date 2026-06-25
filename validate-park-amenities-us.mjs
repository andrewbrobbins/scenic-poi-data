/**
 * Validate park amenities pipeline outputs.
 */
import fs from "fs";
import {
  CAMP_TIERS,
  EMBED_PATH,
  MASTER_PATH,
  QA_PATH,
  ROLLUP_PATH,
  readJson,
} from "./park-amenities-us-lib.mjs";

let errors = 0;
let warnings = 0;

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  errors += 1;
}

function warn(msg) {
  console.warn(`WARN: ${msg}`);
  warnings += 1;
}

function ok(msg) {
  console.log(`OK: ${msg}`);
}

const master = readJson(MASTER_PATH, { records: [] });
const records = master.records || [];
if (!records.length) fail(`Missing or empty ${MASTER_PATH}`);
else ok(`${MASTER_PATH} has ${records.length} records`);

const qa = readJson(QA_PATH, null);
if (!qa) fail(`Missing ${QA_PATH}`);
else if (qa.totalRecords !== records.length) {
  fail(`QA totalRecords (${qa.totalRecords}) != master (${records.length})`);
} else ok("QA totalRecords matches master");

const campRecords = records.filter((r) => r.kind === "campground");
const missingTier = campRecords.filter((r) => !r.campTier);
if (missingTier.length) fail(`${missingTier.length} campground records missing campTier`);
else ok(`All ${campRecords.length} campground records have campTier`);

for (const tier of CAMP_TIERS) {
  const n = campRecords.filter((r) => r.campTier === tier).length;
  if (!n) warn(`No campground records with campTier=${tier}`);
  else ok(`campTier=${tier}: ${n} records`);
}

const rollup = readJson(ROLLUP_PATH, null);
if (!rollup?.parents?.length) fail(`Missing or empty ${ROLLUP_PATH}`);
else {
  ok(`${ROLLUP_PATH} has ${rollup.parentCount} parent summaries`);
  const totalFromRollup = rollup.parents.reduce(
    (n, p) =>
      n +
      p.campground.total +
      p.picnic_area.count +
      p.restroom.count,
    0
  );
  if (totalFromRollup !== records.length) {
    fail(`Rollup POI count ${totalFromRollup} != master ${records.length}`);
  } else ok("Rollup counts match master");
}

if (!fs.existsSync(EMBED_PATH)) fail(`Missing ${EMBED_PATH}`);
else ok(`${EMBED_PATH} exists`);

const sampleParks = ["yose", "grca", "yell"];
for (const code of sampleParks) {
  const parent = rollup?.byParentId?.[code];
  if (!parent) {
    warn(`Sample park ${code} not in rollup`);
    continue;
  }
  ok(
    `${code}: camp dev=${parent.campground.developed.count} back=${parent.campground.backcountry.count} prim=${parent.campground.primitive.count} picnic=${parent.picnic_area.count} restroom=${parent.restroom.count}`
  );
}

if (errors) {
  console.error(`\nvalidate-park-amenities-us: ${errors} error(s), ${warnings} warning(s)`);
  process.exit(1);
}
console.log(`\nvalidate-park-amenities-us: passed (${warnings} warning(s))`);
