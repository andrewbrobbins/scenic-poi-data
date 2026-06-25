/**
 * Merge park amenity ingest → park-amenities-us-master.json + QA.
 */
import path from "path";
import {
  AMENITY_KINDS,
  CAMP_TIERS,
  INGEST_DIR,
  MASTER_PATH,
  QA_PATH,
  addReview,
  haversineM,
  matchKey,
  normalizeAmenityName,
  readJson,
  writeJson,
  NPS_GEO_PATH,
} from "./park-amenities-us-lib.mjs";

const DEDUPE_M = 80;

function loadIngest() {
  const p = path.join(INGEST_DIR, "01-nps-arcgis", "amenities.json");
  const j = readJson(p);
  if (!j?.records?.length) {
    throw new Error(`Missing ingest at ${p} — run build-park-amenities-ingest-nps-arcgis.mjs first`);
  }
  return j;
}

function namesSimilar(a, b) {
  const na = normalizeAmenityName(a);
  const nb = normalizeAmenityName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  return false;
}

function isDuplicate(a, b) {
  if (a.parkCode !== b.parkCode || a.kind !== b.kind) return false;
  if (a.kind === "campground" && a.campTier !== b.campTier) return false;
  const d = haversineM({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon });
  if (d > DEDUPE_M) return false;
  if (namesSimilar(a.name, b.name)) return true;
  if (d <= 25 && a.subtype === b.subtype) return true;
  return false;
}

function dedupeRecords(records) {
  const master = [];
  const suppressed = [];

  for (const rec of records) {
    let dup = null;
    for (const existing of master) {
      if (isDuplicate(rec, existing)) {
        dup = existing;
        break;
      }
    }
    if (dup) {
      suppressed.push({ kept: dup.id, dropped: rec.id, name: rec.name, kind: rec.kind });
      continue;
    }
    master.push({ ...rec, reviewReasons: [...(rec.reviewReasons || [])], mapFlags: [...(rec.mapFlags || [])] });
  }

  return { master, suppressed };
}

function buildCoverage(npsGeo, master) {
  const byCode = new Map();
  for (const r of master) {
    const code = r.parkCode?.toLowerCase();
    if (!code) continue;
    if (!byCode.has(code)) {
      byCode.set(code, {
        campground: { developed: 0, backcountry: 0, primitive: 0 },
        picnic_area: 0,
        restroom: 0,
      });
    }
    const row = byCode.get(code);
    if (r.kind === "campground" && r.campTier) {
      row.campground[r.campTier] = (row.campground[r.campTier] || 0) + 1;
    } else if (r.kind === "picnic_area") {
      row.picnic_area += 1;
    } else if (r.kind === "restroom") {
      row.restroom += 1;
    }
  }

  const units = npsGeo.units || [];
  const withAny = [];
  const withDevelopedCamp = [];
  const withBackcountryCamp = [];
  const withPrimitiveCamp = [];
  const withPicnic = [];
  const withRestroom = [];

  for (const u of units) {
    const stats = byCode.get(u.parkCode);
    if (!stats) continue;
    const campTotal =
      stats.campground.developed + stats.campground.backcountry + stats.campground.primitive;
    if (campTotal || stats.picnic_area || stats.restroom) withAny.push(u.parkCode);
    if (stats.campground.developed) withDevelopedCamp.push(u.parkCode);
    if (stats.campground.backcountry) withBackcountryCamp.push(u.parkCode);
    if (stats.campground.primitive) withPrimitiveCamp.push(u.parkCode);
    if (stats.picnic_area) withPicnic.push(u.parkCode);
    if (stats.restroom) withRestroom.push(u.parkCode);
  }

  return {
    catalogUnits: units.length,
    unitsWithAnyAmenity: withAny.length,
    unitsWithDevelopedCampground: withDevelopedCamp.length,
    unitsWithBackcountryCampground: withBackcountryCamp.length,
    unitsWithPrimitiveCampground: withPrimitiveCamp.length,
    unitsWithPicnicArea: withPicnic.length,
    unitsWithRestroom: withRestroom.length,
  };
}

function buildQa(master, suppressed, ingestMeta, coverage) {
  const byKind = {};
  const byCampTier = { developed: 0, backcountry: 0, primitive: 0 };
  const bySubtype = {};
  const byFlag = {};

  for (const r of master) {
    byKind[r.kind] = (byKind[r.kind] || 0) + 1;
    if (r.kind === "campground" && r.campTier) {
      byCampTier[r.campTier] = (byCampTier[r.campTier] || 0) + 1;
    }
    const stKey = `${r.kind}:${r.subtype || "unknown"}`;
    bySubtype[stKey] = (bySubtype[stKey] || 0) + 1;
    for (const f of r.mapFlags || []) byFlag[f] = (byFlag[f] || 0) + 1;
  }

  return {
    generated: new Date().toISOString(),
    totalRecords: master.length,
    needsReviewCount: master.filter((r) => r.needsReview).length,
    suppressedDuplicateCount: suppressed.length,
    ingest: {
      source: ingestMeta.source,
      rawCount: ingestMeta.rawCount,
      skipped: ingestMeta.skipped,
    },
    byKind,
    byCampTier,
    bySubtype,
    mapFlagCounts: byFlag,
    coverage,
    suppressedSample: suppressed.slice(0, 30),
  };
}

export async function buildMaster() {
  const ingest = loadIngest();
  const { master, suppressed } = dedupeRecords(ingest.records);
  const npsGeo = readJson(NPS_GEO_PATH, { units: [] });
  const coverage = buildCoverage(npsGeo, master);
  const qa = buildQa(master, suppressed, ingest, coverage);

  for (const r of master) {
    if (r.kind === "campground" && !r.campTier) {
      addReview(r, "missing-camp-tier", "NO_CAMP_TIER");
      r.campTier = "developed";
    }
    if (!AMENITY_KINDS.includes(r.kind)) {
      addReview(r, "unknown-kind", "UNKNOWN_KIND");
    }
  }

  master.sort(
    (a, b) =>
      a.parkCode.localeCompare(b.parkCode) ||
      a.kind.localeCompare(b.kind) ||
      (a.campTier || "").localeCompare(b.campTier || "") ||
      a.name.localeCompare(b.name)
  );

  const out = {
    schemaVersion: 1,
    generated: new Date().toISOString(),
    description:
      "US NPS park amenities (campgrounds by tier, picnic areas, restrooms) linked to parent park units.",
    recordCount: master.length,
    byKind: qa.byKind,
    byCampTier: qa.byCampTier,
    records: master,
  };

  writeJson(MASTER_PATH, out);
  writeJson(QA_PATH, qa);

  console.log("Master:", master.length, "records");
  console.log("  campground tiers:", qa.byCampTier);
  console.log("  kinds:", qa.byKind);
  console.log("  NPS units with any amenity:", coverage.unitsWithAnyAmenity);
  return out;
}

if (process.argv[1]?.endsWith("build-park-amenities-us-master.mjs")) {
  await buildMaster();
}
