/**
 * Merge Parks Canada visitor center ingest into master JSON.
 *
 * Usage:
 *   node build-parks-canada-visitor-centers-master.mjs
 *   node build-parks-canada-visitor-centers-master.mjs --verify-osm [--refresh-osm]
 */
import path from "path";
import {
  INGEST_DIR,
  MASTER_PATH,
  QA_PATH,
  addReview,
  coordValid,
  readJson,
  writeJson,
} from "./parks-canada-visitor-centers-lib.mjs";
import {
  loadOsmCandidateIndex,
  nearestOsmFromIndex,
  OSM_FAR_THRESHOLD_M,
  OSM_VERIFY_RADIUS_M,
} from "./parks-canada-visitor-centers-osm-verify.mjs";

function loadArcgisRecords() {
  const p = path.join(INGEST_DIR, "01-arcgis-facilities", "visitor-centers.json");
  return readJson(p, { records: [] }).records || [];
}

async function runOsmVerification(master, { refreshOsm = false } = {}) {
  const index = await loadOsmCandidateIndex({ refresh: refreshOsm });
  if (!index.length) {
    console.log("OSM verification skipped — no candidate index");
    return;
  }
  console.log("OSM verification (local CA PBF):", master.length, "records...");
  let checked = 0;
  for (const rec of master) {
    if (!coordValid(rec.lat, rec.lon)) continue;
    const hit = nearestOsmFromIndex(index, rec.lat, rec.lon, OSM_VERIFY_RADIUS_M);
    rec.verification.osmChecked = true;
    if (hit) {
      rec.verification.osmDistanceM = Math.round(hit.distanceM);
      rec.verification.osmId = `${hit.type}/${hit.id}`;
      if (hit.distanceM > OSM_FAR_THRESHOLD_M) addReview(rec, "osm-far-from-vc", "OSM_FAR");
    } else {
      rec.verification.osmDistanceM = null;
      addReview(rec, "no-osm-nearby", "NO_OSM");
    }
    checked++;
  }
  console.log("OSM verification done:", checked, "records checked");
}

function buildQa(master, meta) {
  const needsReview = master.filter((r) => r.needsReview);
  const byCategory = {};
  const byFlag = {};
  let osmChecked = 0;
  let osmMatched = 0;
  for (const r of master) {
    const cat = r.parentUnit?.category || "other";
    byCategory[cat] = (byCategory[cat] || 0) + 1;
    for (const f of r.mapFlags || []) byFlag[f] = (byFlag[f] || 0) + 1;
    if (r.verification?.osmChecked) {
      osmChecked += 1;
      if (r.verification.osmId) osmMatched += 1;
    }
  }
  return {
    generated: new Date().toISOString(),
    totalRecords: master.length,
    withHours: master.filter((r) => r.hoursSummary?.hasHours).length,
    needsReview: needsReview.length,
    needsReviewSample: needsReview.slice(0, 20).map((r) => ({
      id: r.id,
      name: r.name,
      parkCode: r.parkCode,
      flags: r.mapFlags,
      reasons: r.reviewReasons,
    })),
    byParentCategory: byCategory,
    mapFlagCounts: byFlag,
    osmChecked,
    osmMatched,
    ...meta,
  };
}

export async function buildMaster({ verifyOsm = false, refreshOsm = false } = {}) {
  const arcgis = loadArcgisRecords();
  const master = arcgis.map((r) => ({
    ...r,
    reviewReasons: [...(r.reviewReasons || [])],
    mapFlags: [...(r.mapFlags || [])],
    verification: { ...(r.verification || {}), reviewReasons: [...(r.verification?.reviewReasons || [])] },
  }));

  if (verifyOsm) await runOsmVerification(master, { refreshOsm });

  master.sort((a, b) => a.name.localeCompare(b.name));
  const payload = {
    generated: new Date().toISOString(),
    source: "pc-arcgis-facilities",
    recordCount: master.length,
    records: master,
  };
  writeJson(MASTER_PATH, payload);
  writeJson(QA_PATH, buildQa(master, { arcgisInput: arcgis.length }));
  console.log("Master:", master.length, "records →", MASTER_PATH);
  return payload;
}

if (process.argv[1]?.endsWith("build-parks-canada-visitor-centers-master.mjs")) {
  const verifyOsm = process.argv.includes("--verify-osm");
  const refreshOsm = process.argv.includes("--refresh-osm");
  await buildMaster({ verifyOsm, refreshOsm });
}
