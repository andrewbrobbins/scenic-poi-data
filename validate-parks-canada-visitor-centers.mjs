/**
 * Sanity-check Parks Canada visitor center outputs (VC-CA-001).
 *
 * Usage: node validate-parks-canada-visitor-centers.mjs
 */
import fs from "fs";
import {
  EMBED_PATH,
  MASTER_PATH,
  QA_PATH,
  readJson,
} from "./parks-canada-visitor-centers-lib.mjs";

const SAMPLE_PARKS = ["banff", "jasper", "pacific-rim"];

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
else if (qa.totalRecords !== records.length) fail(`QA totalRecords (${qa.totalRecords}) != master (${records.length})`);
else ok("QA totalRecords matches master");

const withParent = records.filter((r) => r.parentUnit?.name && r.parentUnit.category !== "other");
if (withParent.length < records.length * 0.7) {
  warn(`Only ${withParent.length}/${records.length} records have strong parent links`);
} else {
  ok(`${withParent.length}/${records.length} records linked to parent park`);
}

const withHours = records.filter((r) => r.hoursSummary?.hasHours).length;
if (withHours === 0) {
  warn("withHours is 0 — Parks Canada has no NPS-style hours API; hours gaps documented in QA");
} else ok(`withHours ${withHours}/${records.length}`);

for (const code of SAMPLE_PARKS) {
  const hits = records.filter((r) => r.parkCode === code || r.parentUnit?.parkCode === code);
  if (!hits.length) warn(`Sample park ${code} has no visitor centre record`);
  else ok(`Sample park ${code}: ${hits.length} centre(s)`);
}

if (!fs.existsSync(EMBED_PATH)) fail(`Missing ${EMBED_PATH}`);
else ok(`Embed present: ${EMBED_PATH}`);

if (errors) {
  console.error(`Validation failed: ${errors} error(s), ${warnings} warning(s)`);
  process.exit(1);
}
console.log(`Validation passed (${warnings} warning(s))`);
