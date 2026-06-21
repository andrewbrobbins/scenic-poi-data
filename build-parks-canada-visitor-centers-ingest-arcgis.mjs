/**
 * Step 1: Parks Canada visitor centres from Facilities ArcGIS layer.
 */
import path from "path";
import {
  PC_FACILITIES_QUERY,
  addReview,
  baseRecord,
  coordValid,
  ensureIngestDir,
  fetchArcgisAllFeatures,
  loadPcUnitMaps,
  parkSlugFromPcUrl,
  resolveParentUnit,
  resolveVisitorCenterProvince,
  stateByParkCode,
  vcId,
  writeJson,
} from "./parks-canada-visitor-centers-lib.mjs";
import { isVisitorCentreFacilityType } from "./parks-canada-lib.mjs";

function pickName(a) {
  return (a.Name_e || a.Nom_f || "Visitor Centre").replace(/\n/g, " ").trim();
}

export async function ingestArcgis() {
  const outDir = ensureIngestDir("01-arcgis-facilities");
  const unitMaps = loadPcUnitMaps();
  const parkProvinces = stateByParkCode();

  console.log("ArcGIS: downloading Parks Canada visitor centre facilities...");
  const features = await fetchArcgisAllFeatures(
    PC_FACILITIES_QUERY,
    "Facility_Type_Installation LIKE '%Visitor%'",
    "OBJECTID,Name_e,Nom_f,Facility_Type_Installation,URL_e,URL_f,Public_Access",
    2000
  );
  console.log("ArcGIS: raw features", features.length);

  const records = [];
  const skipped = { noCoords: 0, notVc: 0 };

  for (const f of features) {
    const a = f.attributes || {};
    const facilityType = a.Facility_Type_Installation || "";
    if (!isVisitorCentreFacilityType(facilityType)) {
      skipped.notVc++;
      continue;
    }
    const lat = f.geometry?.y;
    const lon = f.geometry?.x;
    if (!coordValid(lat, lon)) {
      skipped.noCoords++;
      continue;
    }

    const name = pickName(a);
    const url = (a.URL_e || a.URL_f || "").trim();
    const parkSlug = parkSlugFromPcUrl(url);
    const parentUnit = resolveParentUnit({ parkSlug, name, lat, lon }, unitMaps);
    const state = resolveVisitorCenterProvince({
      state: "",
      lat,
      lon,
      parkCode: parentUnit.parkCode,
      parkProvinces,
    });

    const rec = baseRecord({
      id: vcId(parentUnit.parkCode, name, lat, lon),
      name,
      parkCode: parentUnit.parkCode,
      parentUnit,
      state,
      lat,
      lon,
      coordSource: "pc-arcgis-facilities",
      coordConfidence: "high",
      seasonal: { isSeasonal: null, description: "", source: "" },
      ingestSource: "01-arcgis-facilities",
      sourceIds: {
        objectId: a.OBJECTID,
        facilityType,
        url,
      },
      urls: {
        park: parentUnit.parkCode ? `https://parks.canada.ca/pn-np/${(state || "ca").toLowerCase()}/${parentUnit.parkCode}` : "https://parks.canada.ca/",
        detail: url || undefined,
      },
    });

    addReview(rec, "missing-hours", "NO_HOURS");
    if (!rec.state) addReview(rec, "missing-state", "NO_STATE");
    if (parentUnit.category === "other" && !unitMaps.byCode.has(parentUnit.parkCode)) {
      addReview(rec, "weak-parent-link", "WEAK_PARENT");
    }
    records.push(rec);
  }

  const payload = {
    generated: new Date().toISOString(),
    source: "Parks Canada Facilities (Open Government)",
    where: "Facility_Type_Installation LIKE '%Visitor%'",
    rawCount: features.length,
    recordCount: records.length,
    skipped,
    records,
  };
  writeJson(path.join(outDir, "visitor-centers.json"), payload);
  console.log("ArcGIS ingest saved:", payload.recordCount, "records");
  return payload;
}

if (process.argv[1]?.endsWith("build-parks-canada-visitor-centers-ingest-arcgis.mjs")) {
  await ingestArcgis();
}
