/**
 * Validate state / provincial park catalog outputs.
 * Usage: node validate-state-parks.mjs
 */
import fs from "fs";
import { log, logSection } from "./pipeline-log.mjs";
import {
  EMBED_CA_PATH,
  EMBED_US_PATH,
  MASTER_CA_PATH,
  MASTER_US_PATH,
  QA_PATH,
  readJson,
} from "./state-parks-lib.mjs";
import { MATRIX_PATH, loadSourceMatrix } from "./state-parks-official-lib.mjs";

let errors = 0;
let warnings = 0;

function fail(msg) {
  log(msg, { level: "error" });
  errors += 1;
}

function warn(msg) {
  log(msg, { level: "warn" });
  warnings += 1;
}

function ok(msg) {
  log(`OK: ${msg}`);
}

function validateMaster(label, masterPath, embedPath, minExpected) {
  log(`Validating ${label} master...`);
  if (!fs.existsSync(masterPath)) {
    fail(`Missing ${masterPath}`);
    return null;
  }
  const master = readJson(masterPath);
  if (!master?.records?.length) {
    fail(`${masterPath} is empty`);
    return null;
  }
  ok(`${masterPath} has ${master.records.length} records`);
  if (master.records.length < minExpected) {
    warn(`${label} count ${master.records.length} is lower than expected (~${minExpected}+)`);
  }

  const ids = new Set();
  for (const r of master.records) {
    if (!r.id) fail(`${label} record missing id`);
    if (ids.has(r.id)) fail(`${label} duplicate id: ${r.id}`);
    ids.add(r.id);
    if (!r.country) fail(`${label} ${r.id} missing country`);
    if (!r.state) fail(`${label} ${r.id} missing state/province`);
    if (!r.name) fail(`${label} ${r.id} missing name`);
    if (!r.category) fail(`${label} ${r.id} missing category`);
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) fail(`${label} ${r.id} bad coords`);
  }

  if (!fs.existsSync(embedPath)) {
    fail(`Missing ${embedPath}`);
  } else {
    const text = fs.readFileSync(embedPath, "utf8");
    const m = text.match(/var STATE_PARKS_[A-Z]+=(\{[\s\S]+\});/);
    if (!m) fail(`${embedPath} has unexpected format`);
    else {
      const embed = JSON.parse(m[1]);
      if (embed.count !== master.records.length) {
        fail(`${embedPath} count (${embed.count}) != master (${master.records.length})`);
      } else {
        ok(`${embedPath} count matches master`);
      }
    }
  }

  return master;
}

log("validate-state-parks.mjs starting");
logSection("Validation");

const us = validateMaster("US", MASTER_US_PATH, EMBED_US_PATH, 500);
const ca = validateMaster("CA", MASTER_CA_PATH, EMBED_CA_PATH, 100);

const qa = readJson(QA_PATH);
if (!qa?.us || !qa?.ca) {
  fail(`Missing or incomplete ${QA_PATH}`);
} else {
  ok(`QA report: ${qa.conflictCount} unresolved merge conflicts`);
  if (qa.conflictCount > 0) {
    warn(`${qa.conflictCount} same-name conflicts kept as separate records — review state-parks-qa.json`);
  }
}

if (us && ca) {
  const usStates = Object.keys(us.byAdmin || {}).length;
  const caProvinces = Object.keys(ca.byAdmin || {}).length;
  ok(`Coverage: ${usStates} US states/territories, ${caProvinces} CA provinces with records`);

  const matrix = loadSourceMatrix();
  for (const row of matrix.us || []) {
    if (row.status !== "verified") continue;
    const actual = us.byAdmin?.[row.admin] || 0;
    const expected = row.ingestedCount ?? row.featureCount;
    if (!expected) continue;
    if (actual < expected * 0.5) {
      warn(`${row.admin}: ${actual} records in master vs ~${expected} expected from official source`);
    }
  }
}

log(`Validation finished: ${errors} error(s), ${warnings} warning(s)`);
process.exit(errors ? 1 : 0);
