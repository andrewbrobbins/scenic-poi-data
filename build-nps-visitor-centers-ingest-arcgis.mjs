/**
 * Step 1: NPS visitor centers from NPS Public POIs ArcGIS (no API key).
 */
import path from "path";
import {
  ARCGIS_POI_QUERY,
  addReview,
  baseRecord,
  coordValid,
  ensureIngestDir,
  fetchArcgisAllFeatures,
  loadNpsUnitMaps,
  readJson,
  resolveParentUnit,
  resolveVisitorCenterState,
  seasonFromArcgis,
  vcId,
  writeJson,
  NPS_GEO_PATH,
} from "./nps-visitor-centers-lib.mjs";

function stateByParkCode() {
  const geo = readJson(NPS_GEO_PATH, { units: [] });
  const map = {};
  for (const u of geo.units || []) map[u.parkCode.toLowerCase()] = u.state;
  return map;
}

export async function ingestArcgis() {
  const outDir = ensureIngestDir("01-arcgis-poi");
  const parkStates = stateByParkCode();
  const unitMaps = loadNpsUnitMaps();
  const outFields = "POINAME,POITYPE,UNITCODE,UNITNAME,SEASONAL,SEASDESC";

  console.log("ArcGIS: downloading Visitor Center features...");
  const features = await fetchArcgisAllFeatures(
    ARCGIS_POI_QUERY,
    "POITYPE='Visitor Center'",
    outFields,
    2000
  );
  console.log("ArcGIS: raw features", features.length);

  const records = [];
  const skipped = { noCoords: 0, noPark: 0 };

  for (const f of features) {
    const a = f.attributes || {};
    const g = f.geometry;
    const lat = g?.y;
    const lon = g?.x;
    if (!coordValid(lat, lon)) {
      skipped.noCoords++;
      continue;
    }
    const name = (a.POINAME || "Visitor Center").trim();
    const parkCode = (a.UNITCODE || "").toLowerCase();
    if (!parkCode) {
      skipped.noPark++;
      continue;
    }
    const parentUnit = resolveParentUnit(parkCode, unitMaps);
    const state = resolveVisitorCenterState({
      state: "",
      lat,
      lon,
      parkCode: parentUnit.parkCode,
      parkStates,
    });

    const rec = baseRecord({
      id: vcId(parentUnit.parkCode, name, lat, lon),
      name,
      parkCode: parentUnit.parkCode,
      parentUnit,
      state,
      lat,
      lon,
      coordSource: "nps-arcgis-poi",
      coordConfidence: "medium",
      seasonal: seasonFromArcgis(a),
      ingestSource: "01-arcgis-poi",
      sourceIds: {
        poiType: a.POITYPE,
        unitCode: a.UNITCODE,
        unitName: a.UNITNAME,
      },
      urls: {
        park: `https://www.nps.gov/${parentUnit.parkCode}/`,
        visitorCenters: `https://www.nps.gov/${parentUnit.parkCode}/planyourvisit/visitorcenters.htm`,
      },
    });

    if (!rec.state) addReview(rec, "missing-state", "NO_STATE");
    records.push(rec);
  }

  const payload = {
    generated: new Date().toISOString(),
    source: "mapservices.nps.gov NPS_Public_POIs",
    where: "POITYPE='Visitor Center'",
    rawCount: features.length,
    recordCount: records.length,
    skipped,
    records,
  };
  writeJson(path.join(outDir, "visitor-centers.json"), payload);
  console.log("ArcGIS ingest saved:", payload.recordCount, "records");
  return payload;
}

if (process.argv[1]?.endsWith("build-nps-visitor-centers-ingest-arcgis.mjs")) {
  await ingestArcgis();
}
