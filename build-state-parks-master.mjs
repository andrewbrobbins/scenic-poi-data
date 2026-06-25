/**
 * Merge PBF extracts + official source caches → committed master JSON (US + CA).
 */
import path from "path";
import { log, logSection } from "./pipeline-log.mjs";
import { loadAllOfficialRecords } from "./state-parks-official-lib.mjs";
import {
  INGEST_DIR,
  MASTER_CA_PATH,
  MASTER_US_PATH,
  QA_PATH,
  mergeRecords,
  countByAdmin,
  countByCategory,
  readJson,
  writeJson,
} from "./state-parks-lib.mjs";

function loadExtract(country) {
  const sourceKey = country === "CA" ? "ca" : "us";
  const p = path.join(INGEST_DIR, "00-pbf", `state-parks-${sourceKey}.json`);
  log(`Loading ${country} extract: ${p}`);
  const j = readJson(p, { records: [] });
  const count = j.records?.length || j.recordCount || 0;
  if (!count) {
    log(`WARN: empty or missing extract — run node build-state-parks-extract-pbf.mjs --source=${sourceKey}`, {
      level: "warn",
    });
  } else {
    log(`${country}: ${count} raw records from PBF extract`);
  }
  return j;
}

function buildMaster(country, outPath, officialRecords) {
  logSection(`Build ${country} master`);
  const extract = loadExtract(country);
  const rawOsm = extract.records || [];
  const rawOfficial = officialRecords.filter((r) => r.country === country);
  const raw = [...rawOfficial, ...rawOsm];
  log(`Merging ${rawOfficial.length} official + ${rawOsm.length} OSM = ${raw.length} raw records...`);
  const { records, conflicts } = mergeRecords(raw);
  log(`  → ${records.length} units after dedupe (${conflicts.length} name conflicts)`);

  records.sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));

  const sources = [];
  if (rawOfficial.length) sources.push("official");
  if (rawOsm.length) sources.push("osm-pbf");

  const payload = {
    generated: new Date().toISOString(),
    source: sources.length === 2 ? "official+osm-pbf" : sources[0] || "osm-pbf",
    country,
    count: records.length,
    categories: countByCategory(records),
    byAdmin: countByAdmin(records),
    needsReviewCount: records.filter((r) => r.needsReview).length,
    officialCount: rawOfficial.length,
    osmCount: rawOsm.length,
    pbfPath: extract.pbfPath || null,
    records,
  };

  log(`Writing ${outPath}...`);
  writeJson(outPath, payload);
  log(`Wrote ${outPath}: ${payload.count} records, ${payload.needsReviewCount} need review`);
  return { payload, conflicts, rawCount: raw.length, extractMeta: extract };
}

log("build-state-parks-master.mjs starting");
const officialRecords = loadAllOfficialRecords();
log(`Loaded ${officialRecords.length} official records from cache`);

const us = buildMaster("US", MASTER_US_PATH, officialRecords);
const ca = buildMaster("CA", MASTER_CA_PATH, officialRecords);

log("Writing QA report...");
const qa = {
  generated: new Date().toISOString(),
  us: {
    recordCount: us.payload.count,
    rawCount: us.rawCount,
    officialCount: us.payload.officialCount,
    osmCount: us.payload.osmCount,
    categories: us.payload.categories,
    byAdmin: us.payload.byAdmin,
    needsReviewCount: us.payload.needsReviewCount,
    pbfPath: us.extractMeta.pbfPath,
    conflicts: us.conflicts,
  },
  ca: {
    recordCount: ca.payload.count,
    rawCount: ca.rawCount,
    officialCount: ca.payload.officialCount,
    osmCount: ca.payload.osmCount,
    categories: ca.payload.categories,
    byAdmin: ca.payload.byAdmin,
    needsReviewCount: ca.payload.needsReviewCount,
    pbfPath: ca.extractMeta.pbfPath,
    conflicts: ca.conflicts,
  },
  conflictCount: us.conflicts.length + ca.conflicts.length,
};

writeJson(QA_PATH, qa);
log(`Wrote ${QA_PATH} (${qa.conflictCount} unresolved name conflicts)`);

if (!us.payload.count && !ca.payload.count) {
  log("Both masters empty — run node build-state-parks-extract-pbf.mjs first", { level: "error" });
  process.exitCode = 1;
}
