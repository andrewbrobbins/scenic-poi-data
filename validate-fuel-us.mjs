/**
 * Sanity-check US branded fuel outputs without rescanning the PBF.
 * Usage: node validate-fuel-us.mjs [--repair]
 */
import fs from "fs";
import {
  CATALOG_PATH,
  MASTER_PATH,
  QA_PATH,
  INFORMATIONAL_MAP_FLAGS,
  loadBrandCatalog,
  readJson,
  reconcileFuelNeedsReview,
} from "./fuel-us-lib.mjs";

const EMBED_PATH = "fuel-us-explorer-embed.js";
const EXPECTED_BRANDS = [
  "bucees",
  "quiktrip",
  "racetrac",
  "wawa",
  "sheetz",
  "loves",
  "pilot",
  "flyingj",
  "maverik",
  "kwiktrip",
  "kwikstar",
  "wallys",
  "busy_bee",
  "parkers",
  "cefco",
  "royal_farms",
  "quickchek",
  "terribles",
];
const repair = process.argv.includes("--repair");

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

const catalog = loadBrandCatalog();
const catalogIds = catalog.brands.map((b) => b.id);
for (const id of EXPECTED_BRANDS) {
  if (!catalogIds.includes(id)) fail(`fuel-us-brand-catalog.json missing brand: ${id}`);
}

const master = readJson(MASTER_PATH);
if (!master?.records?.length) {
  fail(`Missing or empty ${MASTER_PATH}`);
} else {
  if (repair) {
    let changed = 0;
    for (const rec of master.records) {
      const before = JSON.stringify([rec.mapFlags, rec.needsReview]);
      rec.mapFlags = [...new Set(rec.mapFlags || [])];
      reconcileFuelNeedsReview(rec);
      if (JSON.stringify([rec.mapFlags, rec.needsReview]) !== before) changed += 1;
    }
    if (changed) {
      master.generated = new Date().toISOString();
      fs.writeFileSync(MASTER_PATH, JSON.stringify(master, null, 2) + "\n", "utf8");
      ok(`Repaired ${changed} records in ${MASTER_PATH}`);
    }
  }
  ok(`${MASTER_PATH} has ${master.records.length} records`);
  if (master.records.length < 3500) warn(`Record count ${master.records.length} is lower than expected (~5000+)`);
  if (master.records.length > 8000) warn(`Record count ${master.records.length} is higher than expected (~5000–8000)`);
}

const qa = readJson(QA_PATH);
if (!qa?.byBrand) {
  fail(`Missing ${QA_PATH}`);
} else {
  if (qa.recordCount !== master?.records?.length) {
    fail(`QA recordCount (${qa.recordCount}) != master (${master?.records?.length})`);
  } else {
    ok("QA recordCount matches master");
  }
}

if (master?.records) {
  const badReview = master.records.filter((r) => {
    if (!r.needsReview) return false;
    const flags = (r.mapFlags || []).filter((f) => !INFORMATIONAL_MAP_FLAGS.has(f));
    return !(r.reviewReasons || []).length && !flags.length;
  });
  if (badReview.length) {
    fail(`${badReview.length} records have needsReview=true with only informational mapFlags`);
  } else {
    ok("needsReview flags are consistent");
  }

  const dupSupp = master.records.filter((r) => (r.mapFlags || []).filter((f) => f === "SUPPLEMENT").length > 1);
  if (dupSupp.length) fail(`${dupSupp.length} records have duplicate SUPPLEMENT mapFlags`);
  else ok("No duplicate SUPPLEMENT mapFlags");

  const noState = master.records.filter((r) => !r.state);
  if (noState.length) fail(`${noState.length} records missing state`);
  else ok("All records have state");

  const VALID_TYPES = new Set(["travel_plaza", "convenience_fuel"]);
  const badType = master.records.filter((r) => !VALID_TYPES.has(r.type));
  if (badType.length) fail(`${badType.length} records have invalid type`);
  else ok("All records have type travel_plaza or convenience_fuel");

  const byBrandType = {};
  for (const r of master.records) {
    const key = `${r.brandId}:${r.type}`;
    byBrandType[key] = (byBrandType[key] || 0) + 1;
  }
  console.log("Per-brand type counts:");
  for (const [k, n] of Object.entries(byBrandType).sort()) {
    console.log(`  ${k}: ${n}`);
  }
  const cefco = master.records.filter((r) => r.brandId === "cefco").length;
  const loves = master.records.filter((r) => r.brandId === "loves").length;
  const pfj = master.records.filter((r) =>
    ["pilot", "flyingj", "pilot_flyingj"].includes(r.brandId)
  ).length;
  if (cefco < 50) warn(`CEFCO count ${cefco} looks low (expected ~100+ after full-chain include)`);
  else ok(`CEFCO count ${cefco}`);
  if (loves < 640) warn(`Love's count ${loves} looks low (expected ~670 with country stores)`);
  else ok(`Love's count ${loves}`);
  if (pfj < 620) warn(`Pilot/Flying J count ${pfj} looks low (expected ~640+ fuel retail)`);
  else ok(`Pilot/Flying J count ${pfj}`);
}

if (!fs.existsSync(EMBED_PATH)) {
  fail(`Missing ${EMBED_PATH}`);
} else {
  const embed = fs.readFileSync(EMBED_PATH, "utf8");
  if (!embed.includes("var FUEL_US")) fail(`${EMBED_PATH} missing FUEL_US global`);
  else ok(`${EMBED_PATH} defines FUEL_US`);
}

console.log(`\nValidation complete: ${errors} error(s), ${warnings} warning(s)`);
if (errors) process.exit(1);
