/**
 * Merge ArcGIS + NPS API visitor centers into nps-visitor-centers-us-master.json.
 * API is authoritative for coordinates and operating hours when available.
 *
 * Usage:
 *   node build-nps-visitor-centers-master.mjs
 *   node build-nps-visitor-centers-master.mjs --verify-osm
 */
import path from "path";
import {
  INGEST_DIR,
  MASTER_PATH,
  TOOLS_DIR,
  addReview,
  baseRecord,
  coordValid,
  haversineM,
  loadNpsUnitMaps,
  matchKey,
  normalizeName,
  normalizeOperatingHours,
  readJson,
  resolveParentUnit,
  seasonFromArcgis,
  summarizeHours,
  vcId,
  writeJson,
} from "./nps-visitor-centers-lib.mjs";

const QA_PATH = path.join(TOOLS_DIR, "nps-visitor-centers-qa.json");
const COORD_MISMATCH_M = 200;
const OSM_VERIFY_RADIUS_M = 350;
const OSM_DELAY_MS = 1100;

function loadArcgisRecords() {
  const p = path.join(INGEST_DIR, "01-arcgis-poi", "visitor-centers.json");
  const j = readJson(p, { records: [] });
  return j.records || [];
}

function loadApiRecords() {
  const p = path.join(INGEST_DIR, "02-nps-api", "visitor-centers.json");
  const j = readJson(p, { records: [] });
  return j.records || [];
}

function stateFromApi(vc, parentUnit, parkStates) {
  const addr = (vc.addresses || []).find((a) => a.stateCode) || vc.addresses?.[0];
  if (addr?.stateCode) return addr.stateCode;
  const code = parentUnit?.parkCode?.toLowerCase();
  if (code && parkStates[code]) return parkStates[code].split(",")[0];
  return "";
}

function urlsFromApi(vc, parentUnit) {
  const code = parentUnit.parkCode;
  const urls = {
    park: `https://www.nps.gov/${code}/`,
    visitorCenters: `https://www.nps.gov/${code}/planyourvisit/visitorcenters.htm`,
  };
  for (const u of vc.urls || []) {
    if (u.url) urls.detail = u.url;
  }
  return urls;
}

function findArcgisMatch(apiRec, arcgisByKey, arcgisList) {
  const key = matchKey(apiRec.parkCode, apiRec.name);
  if (arcgisByKey.has(key)) return arcgisByKey.get(key);

  const apiPoint = { lat: apiRec.lat, lon: apiRec.lon };
  if (!coordValid(apiPoint.lat, apiPoint.lon)) return null;

  let best = null;
  let bestD = Infinity;
  for (const ar of arcgisList) {
    if (ar.parkCode !== apiRec.parkCode && ar.parentUnit?.parkCode !== apiRec.parkCode) continue;
    const d = haversineM(apiPoint, { lat: ar.lat, lon: ar.lon });
    if (d > 400) continue;
    const na = normalizeName(apiRec.name);
    const nb = normalizeName(ar.name);
    if (na && nb && (na === nb || na.includes(nb) || nb.includes(na)) && d < bestD) {
      best = ar;
      bestD = d;
    }
  }
  return best;
}

function recordFromApi(vc, unitMaps, parkStates, arcgisMatch) {
  const parentUnit = resolveParentUnit(vc.parkCode, unitMaps);
  const lat = vc.lat;
  const lon = vc.lon;
  const operatingHours = normalizeOperatingHours(vc.operatingHours);
  const hoursSummary = summarizeHours(operatingHours);

  let seasonal = { isSeasonal: null, description: "", source: "" };
  if (hoursSummary.seasonalNote) {
    seasonal = { isSeasonal: true, description: hoursSummary.seasonalNote, source: "nps-api-hours" };
  } else if (arcgisMatch?.seasonal?.description) {
    seasonal = arcgisMatch.seasonal;
  }

  const rec = baseRecord({
    id: vcId(parentUnit.parkCode, vc.name, lat, lon),
    name: vc.name,
    parkCode: parentUnit.parkCode,
    parentUnit,
    state: stateFromApi(vc, parentUnit, parkStates),
    lat,
    lon,
    coordSource: "nps-api",
    coordConfidence: coordValid(lat, lon) ? "high" : "low",
    seasonal,
    operatingHours,
    hoursSummary,
    phones: (vc.phoneNumbers || []).map((p) => p.phoneNumber).filter(Boolean),
    emails: (vc.emailAddresses || []).map((e) => e.emailAddress).filter(Boolean),
    urls: urlsFromApi(vc, parentUnit),
    ingestSource: "02-nps-api",
    sourceIds: {
      npsApiId: vc.id,
      arcgisPoiId: arcgisMatch?.sourceIds?.unitCode || null,
    },
  });

  if (!coordValid(lat, lon)) addReview(rec, "missing-coordinates", "NO_COORDS");
  if (!hoursSummary.hasHours) addReview(rec, "missing-hours", "NO_HOURS");
  if (!rec.state) addReview(rec, "missing-state", "NO_STATE");

  if (arcgisMatch && coordValid(lat, lon) && coordValid(arcgisMatch.lat, arcgisMatch.lon)) {
    const d = haversineM({ lat, lon }, { lat: arcgisMatch.lat, lon: arcgisMatch.lon });
    rec.verification.arcgisDistanceM = Math.round(d);
    if (d > COORD_MISMATCH_M) {
      addReview(rec, "arcgis-api-coord-mismatch", "COORD_MISMATCH");
    }
  }

  return rec;
}

function recordFromArcgis(ar) {
  const copy = {
    ...ar,
    reviewReasons: [...(ar.reviewReasons || [])],
    mapFlags: [...(ar.mapFlags || [])],
    verification: { ...(ar.verification || {}), reviewReasons: [...(ar.verification?.reviewReasons || [])] },
  };
  if (!copy.hoursSummary?.hasHours) addReview(copy, "missing-hours", "NO_HOURS");
  return copy;
}

async function overpassNearest(lat, lon) {
  const query = `
[out:json][timeout:60];
(
  node(around:${OSM_VERIFY_RADIUS_M},${lat},${lon})["tourism"="information"];
  node(around:${OSM_VERIFY_RADIUS_M},${lat},${lon})["information"="visitor_centre"];
  node(around:${OSM_VERIFY_RADIUS_M},${lat},${lon})["amenity"="ranger_station"];
  way(around:${OSM_VERIFY_RADIUS_M},${lat},${lon})["tourism"="information"];
  way(around:${OSM_VERIFY_RADIUS_M},${lat},${lon})["information"="visitor_centre"];
);
out center tags;`;
  const res = await fetch("https://overpass.kumi.systems/api/interpreter", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "scenic-poi-data-nps-vc/1.0",
    },
    body: "data=" + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error("Overpass HTTP " + res.status);
  const j = await res.json();
  const elements = j.elements || [];
  let best = null;
  let bestD = Infinity;
  for (const el of elements) {
    const elat = el.lat ?? el.center?.lat;
    const elon = el.lon ?? el.center?.lon;
    if (!Number.isFinite(elat) || !Number.isFinite(elon)) continue;
    const d = haversineM({ lat, lon }, { lat: elat, lon: elon });
    if (d < bestD) {
      bestD = d;
      best = { id: el.id, type: el.type, lat: elat, lon: elon, tags: el.tags || {}, distanceM: d };
    }
  }
  return best;
}

async function runOsmVerification(master) {
  console.log("OSM verification:", master.length, "records (slow)...");
  let checked = 0;
  for (const rec of master) {
    if (!coordValid(rec.lat, rec.lon)) continue;
    try {
      const hit = await overpassNearest(rec.lat, rec.lon);
      if (hit) {
        rec.verification.osmDistanceM = Math.round(hit.distanceM);
        rec.verification.osmId = `${hit.type}/${hit.id}`;
        if (hit.distanceM > 150) {
          addReview(rec, "osm-far-from-vc", "OSM_FAR");
        }
      } else {
        rec.verification.osmDistanceM = null;
        addReview(rec, "no-osm-nearby", "NO_OSM");
      }
    } catch (e) {
      console.warn("OSM verify failed for", rec.id, e.message);
    }
    checked++;
    if (checked % 25 === 0) console.log("OSM verified", checked, "/", master.length);
    await new Promise((r) => setTimeout(r, OSM_DELAY_MS));
  }
}

function buildQa(master, meta) {
  const needsReview = master.filter((r) => r.needsReview);
  const byCategory = {};
  const byFlag = {};
  for (const r of master) {
    const cat = r.parentUnit?.category || "other";
    byCategory[cat] = (byCategory[cat] || 0) + 1;
    for (const f of r.mapFlags || []) byFlag[f] = (byFlag[f] || 0) + 1;
  }
  return {
    generated: new Date().toISOString(),
    ...meta,
    totalRecords: master.length,
    needsReviewCount: needsReview.length,
    byParentCategory: byCategory,
    mapFlagCounts: byFlag,
    withHours: master.filter((r) => r.hoursSummary?.hasHours).length,
    apiSourced: master.filter((r) => r.coordSource === "nps-api").length,
    arcgisOnly: master.filter((r) => r.ingestSource === "01-arcgis-poi").length,
    needsReviewSample: needsReview.slice(0, 80).map((r) => ({
      id: r.id,
      name: r.name,
      parkCode: r.parkCode,
      lat: r.lat,
      lon: r.lon,
      mapFlags: r.mapFlags,
      reviewReasons: r.reviewReasons,
      arcgisDistanceM: r.verification?.arcgisDistanceM,
      osmDistanceM: r.verification?.osmDistanceM,
    })),
  };
}

export async function buildMaster({ verifyOsm = false } = {}) {
  const unitMaps = loadNpsUnitMaps();
  const geo = readJson(path.join(TOOLS_DIR, "nps-us-geo.json"), {
    units: [],
  });
  const parkStates = {};
  for (const u of geo.units || []) parkStates[u.parkCode.toLowerCase()] = u.state;

  const arcgisList = loadArcgisRecords();
  const apiList = loadApiRecords();
  const arcgisByKey = new Map();
  for (const ar of arcgisList) arcgisByKey.set(matchKey(ar.parkCode, ar.name), ar);

  const consumedArcgis = new Set();
  const master = [];

  for (const vc of apiList) {
    if (!vc.parkCode) continue;
    const arcgisMatch = findArcgisMatch(vc, arcgisByKey, arcgisList);
    if (arcgisMatch) consumedArcgis.add(arcgisMatch.id);
    master.push(recordFromApi(vc, unitMaps, parkStates, arcgisMatch));
  }

  for (const ar of arcgisList) {
    if (consumedArcgis.has(ar.id)) continue;
    master.push(recordFromArcgis(ar));
  }

  master.sort((a, b) => {
    const pa = a.parentUnit?.name || a.parkCode;
    const pb = b.parentUnit?.name || b.parkCode;
    if (pa !== pb) return pa.localeCompare(pb);
    return a.name.localeCompare(b.name);
  });

  if (verifyOsm) await runOsmVerification(master);

  const meta = {
    arcgisInput: arcgisList.length,
    apiInput: apiList.length,
    mergedCount: master.length,
  };
  const qa = buildQa(master, meta);

  const out = {
    schemaVersion: 1,
    generated: new Date().toISOString(),
    description:
      "US NPS visitor centers with parent park/unit, designation category, coordinates, and operating hours.",
    recordCount: master.length,
    records: master,
  };

  writeJson(MASTER_PATH, out);
  writeJson(QA_PATH, qa);
  console.log(
    "Master:",
    master.length,
    "records | API",
    meta.apiInput,
    "| ArcGIS-only",
    qa.arcgisOnly,
    "| needsReview",
    qa.needsReviewCount
  );
  return out;
}

if (process.argv[1]?.endsWith("build-nps-visitor-centers-master.mjs")) {
  const verifyOsm = process.argv.includes("--verify-osm");
  await buildMaster({ verifyOsm });
}
