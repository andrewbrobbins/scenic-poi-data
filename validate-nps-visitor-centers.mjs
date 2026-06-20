/**
 * Sanity-check NPS visitor center outputs (VC-001 acceptance criteria).
 *
 * Usage:
 *   node validate-nps-visitor-centers.mjs
 *   node validate-nps-visitor-centers.mjs --expect-api
 */
import fs from "fs";
import {
  EMBED_PATH,
  MASTER_PATH,
  QA_PATH,
  readJson,
} from "./nps-visitor-centers-lib.mjs";

const expectApi = process.argv.includes("--expect-api");
const MIN_HOURS_PCT = 0.9;
const SAMPLE_PARKS = ["yell", "acad"];

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
if (!records.length) {
  fail(`Missing or empty ${MASTER_PATH}`);
} else {
  ok(`${MASTER_PATH} has ${records.length} records`);
}

const qa = readJson(QA_PATH, null);
if (!qa) {
  fail(`Missing ${QA_PATH}`);
} else {
  if (qa.totalRecords !== records.length) {
    fail(`QA totalRecords (${qa.totalRecords}) != master (${records.length})`);
  } else {
    ok("QA totalRecords matches master");
  }

  const withHours = qa.withHours ?? records.filter((r) => r.hoursSummary?.hasHours).length;
  const apiSourced = qa.apiSourced ?? records.filter((r) => r.coordSource === "nps-api").length;
  const apiWithHours =
    records.filter((r) => r.coordSource === "nps-api" && r.hoursSummary?.hasHours).length;
  const pctTotal = records.length ? withHours / records.length : 0;
  const pctApi = apiSourced ? apiWithHours / apiSourced : 0;

  if (expectApi) {
    if (!qa.apiInput) fail("API ingest missing — set NPS_API_KEY and rerun build-nps-visitor-centers-all.mjs");
    else ok(`API ingest contributed ${qa.apiInput} records`);
    if (apiSourced && pctApi < MIN_HOURS_PCT) {
      fail(
        `API-sourced withHours ${apiWithHours}/${apiSourced} (${Math.round(pctApi * 100)}%) below ${Math.round(MIN_HOURS_PCT * 100)}% target`
      );
    } else if (apiSourced) {
      ok(`API-sourced withHours ${apiWithHours}/${apiSourced} (${Math.round(pctApi * 100)}%) meets target`);
    }
    if (withHours < 500) fail(`Total withHours ${withHours} below 500 minimum`);
    else ok(`Total withHours ${withHours}`);
    if (pctTotal < MIN_HOURS_PCT) {
      warn(
        `Total withHours ${withHours}/${records.length} (${Math.round(pctTotal * 100)}%) below ${Math.round(MIN_HOURS_PCT * 100)}% — often due to ${qa.arcgisOnly ?? 0} ArcGIS-only records without API match`
      );
    }
  } else if (withHours === 0) {
    warn("withHours is 0 — run API ingest with NPS_API_KEY for operating hours (VC-001)");
  } else {
    ok(`withHours ${withHours}/${records.length}`);
  }

  const noHoursFlags = qa.mapFlagCounts?.NO_HOURS ?? 0;
  if (expectApi && noHoursFlags > records.length * 0.15) {
    warn(`${noHoursFlags} records still flagged NO_HOURS`);
  }

  const noState = records.filter((r) => !r.state);
  if (noState.length) fail(`${noState.length} records missing state`);
  else ok("All records have state");
  const noStateFlags = qa.mapFlagCounts?.NO_STATE ?? 0;
  if (noStateFlags) fail(`${noStateFlags} records flagged NO_STATE`);
  else ok("No NO_STATE flags");

  if (qa.osmChecked != null && qa.osmChecked > 0) {
    ok(`OSM verified ${qa.osmMatched ?? 0}/${qa.osmChecked} with nearby match (${Math.round((qa.osmMatchRate ?? 0) * 100)}% of total)`);
  }
}

if (expectApi) {
  for (const code of SAMPLE_PARKS) {
    const sample = records.find((r) => r.parkCode === code && r.hoursSummary?.hasHours);
    if (!sample) warn(`Sample park ${code} has no record with hours`);
    else ok(`Sample park ${code}: ${sample.name} — ${sample.hoursSummary.summary || sample.hoursSummary.seasonalNote}`);
  }
}

if (!fs.existsSync(EMBED_PATH)) {
  fail(`Missing ${EMBED_PATH}`);
} else {
  const embed = fs.readFileSync(EMBED_PATH, "utf8");
  if (!embed.includes("var NPS_VISITOR_CENTERS_US")) fail(`${EMBED_PATH} missing NPS_VISITOR_CENTERS_US global`);
  else ok(`${EMBED_PATH} defines NPS_VISITOR_CENTERS_US`);

  const m = embed.match(/var NPS_VISITOR_CENTERS_US=(\{.*\});/s);
  if (m) {
    const payload = JSON.parse(m[1]);
    if (payload.count !== records.length) {
      fail(`Embed count (${payload.count}) != master (${records.length})`);
    } else {
      ok("Embed count matches master");
    }
    if (expectApi && payload.withHours !== qa?.withHours) {
      fail(`Embed withHours (${payload.withHours}) != QA (${qa?.withHours})`);
    }
  }
}

console.log(`\nValidation complete: ${errors} error(s), ${warnings} warning(s)`);
if (errors) process.exit(1);
