/**
 * Merge all ingest steps into camping-us-master.json + QA report.
 * Priority: NPS POI > USFS > RIDB > OSM (dedupe by proximity + name).
 */
import fs from "fs";
import path from "path";
import {
  INGEST_DIR,
  MASTER_PATH,
  QA_PATH,
  TOOLS_DIR,
  addReview,
  haversineMi,
  readJson,
  slugify,
  writeJson,
} from "./camping-us-lib.mjs";
import { applyInferredState } from "./camping-us-geo-utils.mjs";

const SOURCE_PRIORITY = ["01-nps-poi", "02-usfs-recreation", "04-ridb", "03-osm"];
const DEDUPE_MI = 0.12;

function normName(n) {
  return (n || "")
    .toLowerCase()
    .replace(/\b(campground|camp|camping area|cg)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 40);
}

function namesSimilar(a, b) {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  return false;
}

function loadStepRecords(step) {
  const p = path.join(INGEST_DIR, step, "campgrounds.json");
  const j = readJson(p);
  if (!j?.records?.length) return { step, records: [], meta: j };
  return { step, records: j.records, meta: j };
}

function mergeRecords() {
  const layers = SOURCE_PRIORITY.map(loadStepRecords);
  const master = [];
  const suppressed = [];

  for (const { step, records } of layers) {
    for (const rec of records) {
      let dup = null;
      for (const existing of master) {
        const d = haversineMi([rec.lat, rec.lon], [existing.lat, existing.lon]);
        if (d <= DEDUPE_MI && namesSimilar(rec.name, existing.name)) {
          dup = existing;
          break;
        }
        if (d <= 0.05 && rec.landManager === existing.landManager) {
          dup = existing;
          break;
        }
      }
      if (dup) {
        suppressed.push({ kept: dup.id, dropped: rec.id, step, name: rec.name });
        if (step === "03-osm" && dup.ingestSource !== "03-osm") {
          if (!dup.sourceIds.osmSupplement) dup.sourceIds.osmSupplement = [];
          dup.sourceIds.osmSupplement.push(rec.sourceIds);
        }
        continue;
      }
      const copy = { ...rec, reviewReasons: [...(rec.reviewReasons || [])], mapFlags: [...(rec.mapFlags || [])] };
      if (step === "03-osm" && SOURCE_PRIORITY.indexOf(step) > 2) {
        addReview(copy, "osm-only-no-federal-confirm", "OSM_ONLY");
      }
      master.push(copy);
    }
  }

  for (const rec of master) applyInferredState(rec);
  return { master, suppressed, layers };
}

function attachNpsUnitGaps(master) {
  const geoPath = path.join(TOOLS_DIR, "nps-us-geo.json");
  if (!fs.existsSync(geoPath)) return { withCamping: [], noCamping: [] };
  const geo = readJson(geoPath);
  const campByCode = new Map();
  for (const r of master) {
    if (r.landManager !== "NPS") continue;
    const code = r.parentUnit?.parkCode?.toLowerCase();
    if (code) campByCode.set(code, (campByCode.get(code) || 0) + 1);
  }
  const eligible = geo.units.filter((u) =>
    ["park", "monument", "preserve", "recreation"].includes(u.category)
  );
  const withCamping = [];
  const noCamping = [];
  for (const u of eligible) {
    if (campByCode.has(u.parkCode)) withCamping.push(u.parkCode);
    else
      noCamping.push({
        parkCode: u.parkCode,
        name: u.name,
        category: u.category,
        lat: u.lat,
        lon: u.lon,
        needsReview: true,
        reviewReason: "nps-unit-no-campground-in-dataset",
        mapFlag: "NPS_NO_CG",
      });
  }
  return { withCamping, noCamping };
}

function buildQa(master, suppressed, layers, npsGaps) {
  const needsReview = master.filter((r) => r.needsReview);
  const byManager = {};
  const byFlag = {};
  for (const r of master) {
    byManager[r.landManager] = (byManager[r.landManager] || 0) + 1;
    for (const f of r.mapFlags || []) byFlag[f] = (byFlag[f] || 0) + 1;
  }
  return {
    generated: new Date().toISOString(),
    totalRecords: master.length,
    needsReviewCount: needsReview.length,
    suppressedDuplicateCount: suppressed.length,
    ingestLayers: layers.map((l) => ({
      step: l.step,
      inputCount: l.records.length,
      skipped: l.meta?.skipped,
      reason: l.meta?.reason,
    })),
    byLandManager: byManager,
    mapFlagCounts: byFlag,
    npsUnitsWithCamping: npsGaps.withCamping.length,
    npsUnitsMissingCampground: npsGaps.noCamping.length,
    npsMissingCampground: npsGaps.noCamping,
    needsReviewSample: needsReview.slice(0, 100).map((r) => ({
      id: r.id,
      name: r.name,
      landManager: r.landManager,
      lat: r.lat,
      lon: r.lon,
      mapFlags: r.mapFlags,
      reviewReasons: r.reviewReasons,
    })),
    suppressedSample: suppressed.slice(0, 50),
  };
}

export async function buildMaster() {
  const { master, suppressed, layers } = mergeRecords();
  const npsGaps = attachNpsUnitGaps(master);

  for (const gap of npsGaps.noCamping) {
    master.push({
      id: `CG-NPS-${gap.parkCode.toUpperCase()}-NO-CAMPGROUND-PLACEHOLDER`,
      name: `${gap.name} (no campground in dataset)`,
      type: "placeholder",
      landManager: "NPS",
      parentUnit: { system: "nps", parkCode: gap.parkCode, name: gap.name },
      state: "",
      lat: gap.lat,
      lon: gap.lon,
      coordSource: "nps-unit-centroid",
      coordConfidence: "low",
      cost: "unknown",
      commercial: false,
      dispersed: false,
      needsReview: true,
      reviewReasons: [gap.reviewReason],
      mapFlags: [gap.mapFlag],
      urls: { detail: `https://www.nps.gov/${gap.parkCode}/planyourvisit/camping.htm` },
      sourceIds: {},
      status: "unknown",
      verifiedAt: new Date().toISOString().slice(0, 10),
      ingestSource: "qa-nps-gap",
      isPlaceholder: true,
    });
  }

  const qa = buildQa(master, suppressed, layers, npsGaps);
  const out = {
    schemaVersion: 1,
    generated: new Date().toISOString(),
    description:
      "US public camping database (campground-level). Records with needsReview or mapFlags need human verification on map.",
    recordCount: master.length,
    records: master,
  };

  writeJson(MASTER_PATH, out);
  writeJson(QA_PATH, qa);
  writeJson(path.join(INGEST_DIR, "nps-units-no-campground.json"), {
    generated: new Date().toISOString(),
    count: npsGaps.noCamping.length,
    units: npsGaps.noCamping,
  });

  console.log("Master:", master.length, "records");
  console.log("Needs review:", qa.needsReviewCount);
  console.log("NPS units missing campground data:", npsGaps.noCamping.length);
  return out;
}

if (process.argv[1]?.endsWith("build-camping-us-master.mjs")) {
  await buildMaster();
}

