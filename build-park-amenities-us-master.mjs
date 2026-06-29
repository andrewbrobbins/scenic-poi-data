/**
 * Merge US park amenity ingests → master + QA.
 */
import path from "path";
import {
  AMENITY_KINDS,
  INGEST_DIR,
  MASTER_PATH,
  QA_PATH,
  addReview,
  dedupeAmenityRecords,
  readJson,
  writeJson,
  NPS_GEO_PATH,
} from "./park-amenities-us-lib.mjs";
import { readJson as readStateParks } from "./state-parks-lib.mjs";
import { MASTER_US_PATH } from "./state-parks-lib.mjs";

const INGEST_PRIORITY = [
  { step: "01-nps-arcgis", file: "amenities.json" },
  { step: "02-state-arcgis", file: "amenities-us.json" },
  { step: "03-state-osm", file: "amenities.json" },
];

function loadAllIngestRecords() {
  const layers = [];
  let all = [];
  for (const { step, file } of INGEST_PRIORITY) {
    const p = path.join(INGEST_DIR, step, file);
    const j = readJson(p, null);
    if (!j?.records?.length) {
      console.warn("Skip empty/missing ingest:", p);
      continue;
    }
    layers.push({ step, count: j.records.length, meta: j });
    all = all.concat(j.records);
  }
  if (!all.length) {
    throw new Error("No amenity ingest records — run build-park-amenities-us-all.mjs");
  }
  return { all, layers };
}

function buildCoverage(npsGeo, stateParks, master) {
  const npsByCode = new Map();
  const spById = new Map();
  for (const r of master) {
    const pu = r.parentUnit || {};
    if (pu.system === "nps" && r.parkCode) {
      if (!npsByCode.has(r.parkCode)) {
        npsByCode.set(r.parkCode, {
          campground: { developed: 0, backcountry: 0, primitive: 0 },
          picnic_area: 0,
          restroom: 0,
        });
      }
      accumulate(npsByCode.get(r.parkCode), r);
    } else if (pu.system === "state_park_us" && pu.id) {
      if (!spById.has(pu.id)) {
        spById.set(pu.id, {
          campground: { developed: 0, backcountry: 0, primitive: 0 },
          picnic_area: 0,
          restroom: 0,
        });
      }
      accumulate(spById.get(pu.id), r);
    }
  }

  return {
    npsCatalogUnits: (npsGeo.units || []).length,
    npsUnitsWithAnyAmenity: npsByCode.size,
    stateParkCatalogUnits: (stateParks.records || []).length,
    stateParksWithAnyAmenity: spById.size,
  };
}

function accumulate(row, r) {
  if (r.kind === "campground" && r.campTier) {
    row.campground[r.campTier] = (row.campground[r.campTier] || 0) + 1;
  } else if (r.kind === "picnic_area") row.picnic_area += 1;
  else if (r.kind === "restroom") row.restroom += 1;
}

function buildQa(master, suppressed, layers, coverage) {
  const byKind = {};
  const byCampTier = { developed: 0, backcountry: 0, primitive: 0 };
  const byAccessMode = { road: 0, trail: 0, unknown: 0 };
  const byManager = {};
  const byFlag = {};

  for (const r of master) {
    byKind[r.kind] = (byKind[r.kind] || 0) + 1;
    byManager[r.landManager] = (byManager[r.landManager] || 0) + 1;
    if (r.kind === "campground" && r.campTier) byCampTier[r.campTier] += 1;
    if (r.kind === "campground") byAccessMode[r.accessMode] = (byAccessMode[r.accessMode] || 0) + 1;
    for (const f of r.mapFlags || []) byFlag[f] = (byFlag[f] || 0) + 1;
  }

  return {
    generated: new Date().toISOString(),
    totalRecords: master.length,
    needsReviewCount: master.filter((r) => r.needsReview).length,
    suppressedDuplicateCount: suppressed.length,
    ingestLayers: layers.map((l) => ({ step: l.step, count: l.count })),
    byKind,
    byCampTier,
    byAccessMode,
    byManager,
    mapFlagCounts: byFlag,
    coverage,
    suppressedSample: suppressed.slice(0, 30),
  };
}

export async function buildMaster() {
  const { all, layers } = loadAllIngestRecords();
  const { master, suppressed } = dedupeAmenityRecords(all);
  const npsGeo = readJson(NPS_GEO_PATH, { units: [] });
  const stateParks = readStateParks(MASTER_US_PATH, { records: [] });
  const coverage = buildCoverage(npsGeo, stateParks, master);
  const qa = buildQa(master, suppressed, layers, coverage);

  for (const r of master) {
    if (r.kind === "campground" && !r.campTier) {
      addReview(r, "missing-camp-tier", "NO_CAMP_TIER");
      r.campTier = "developed";
    }
    if (!AMENITY_KINDS.includes(r.kind)) addReview(r, "unknown-kind", "UNKNOWN_KIND");
  }

  master.sort(
    (a, b) =>
      (a.landManager || "").localeCompare(b.landManager || "") ||
      (a.parkCode || "").localeCompare(b.parkCode || "") ||
      a.kind.localeCompare(b.kind) ||
      (a.campTier || "").localeCompare(b.campTier || "") ||
      a.name.localeCompare(b.name)
  );

  const out = {
    schemaVersion: 2,
    generated: new Date().toISOString(),
    description:
      "US park amenities: NPS + state parks — campgrounds (developed/backcountry/primitive), picnic, restroom; road/trail access on campgrounds.",
    recordCount: master.length,
    byKind: qa.byKind,
    byCampTier: qa.byCampTier,
    byAccessMode: qa.byAccessMode,
    records: master,
  };

  writeJson(MASTER_PATH, out);
  writeJson(QA_PATH, qa);

  console.log("US master:", master.length, "| tiers:", qa.byCampTier, "| access:", qa.byAccessMode);
  console.log("  NPS units w/ amenities:", coverage.npsUnitsWithAnyAmenity);
  console.log("  State parks w/ amenities:", coverage.stateParksWithAnyAmenity);
  return out;
}

if (process.argv[1]?.endsWith("build-park-amenities-us-master.mjs")) {
  await buildMaster();
}
