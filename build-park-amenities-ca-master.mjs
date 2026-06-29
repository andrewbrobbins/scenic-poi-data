/**
 * Merge Canada park amenity ingests → master + QA.
 */
import path from "path";
import {
  AMENITY_KINDS,
  addReview,
  dedupeAmenityRecords,
  readJson,
  writeJson,
} from "./park-amenities-lib.mjs";
import { INGEST_DIR, MASTER_PATH, QA_PATH } from "./park-amenities-ca-lib.mjs";
import { GEO_PATH as PC_GEO_PATH } from "./parks-canada-lib.mjs";
import { MASTER_CA_PATH } from "./state-parks-lib.mjs";

function loadAllIngestRecords() {
  const layers = [];
  let all = [];
  const steps = [
    { step: "01-pc-arcgis", file: "amenities.json" },
    { step: "02-state-arcgis", file: "amenities-ca.json" },
    { step: "03-provincial-osm", file: "amenities.json" },
  ];
  for (const { step, file } of steps) {
    const p = path.join(INGEST_DIR, step, file);
    const j = readJson(p, null);
    if (!j?.records?.length) {
      console.warn("Skip empty/missing ingest:", p);
      continue;
    }
    layers.push({ step, count: j.records.length });
    all = all.concat(j.records);
  }
  if (!all.length) throw new Error("No CA amenity ingest — run build-park-amenities-ca-all.mjs");
  return { all, layers };
}

export async function buildMaster() {
  const { all, layers } = loadAllIngestRecords();
  const { master, suppressed } = dedupeAmenityRecords(all);
  const pcGeo = readJson(PC_GEO_PATH, { units: [] });
  const spMaster = readJson(MASTER_CA_PATH, { records: [] });

  const byKind = {};
  const byCampTier = { developed: 0, backcountry: 0, primitive: 0 };
  const byManager = {};
  for (const r of master) {
    byKind[r.kind] = (byKind[r.kind] || 0) + 1;
    byManager[r.landManager] = (byManager[r.landManager] || 0) + 1;
    if (r.kind === "campground" && r.campTier) byCampTier[r.campTier] += 1;
    if (r.kind === "campground" && !r.campTier) {
      addReview(r, "missing-camp-tier", "NO_CAMP_TIER");
      r.campTier = "developed";
    }
    if (!AMENITY_KINDS.includes(r.kind)) addReview(r, "unknown-kind", "UNKNOWN_KIND");
  }

  const qa = {
    generated: new Date().toISOString(),
    totalRecords: master.length,
    needsReviewCount: master.filter((r) => r.needsReview).length,
    suppressedDuplicateCount: suppressed.length,
    ingestLayers: layers,
    byKind,
    byCampTier,
    byManager,
    coverage: {
      pcCatalogUnits: (pcGeo.units || []).length,
      provincialCatalogUnits: (spMaster.records || []).length,
    },
  };

  master.sort(
    (a, b) =>
      (a.landManager || "").localeCompare(b.landManager || "") ||
      (a.parkCode || "").localeCompare(b.parkCode || "") ||
      a.kind.localeCompare(b.kind) ||
      a.name.localeCompare(b.name)
  );

  const out = {
    schemaVersion: 2,
    generated: new Date().toISOString(),
    description: "Canada park amenities: Parks Canada + provincial parks.",
    recordCount: master.length,
    byKind,
    byCampTier,
    records: master,
  };

  writeJson(MASTER_PATH, out);
  writeJson(QA_PATH, qa);
  console.log("CA master:", master.length, byKind, byCampTier);
  return out;
}

if (process.argv[1]?.endsWith("build-park-amenities-ca-master.mjs")) {
  await buildMaster();
}
