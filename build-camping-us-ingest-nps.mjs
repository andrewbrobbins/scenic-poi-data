/**
 * Step 1: NPS developed campgrounds from NPS Public POIs ArcGIS (no API key).
 */
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import {
  baseRecord,
  addReview,
  coordValid,
  ensureIngestDir,
  fetchArcgisAllFeatures,
  isCommercialName,
  slugify,
  writeJson,
  readJson,
  TOOLS_DIR,
} from "./camping-us-lib.mjs";

const QUERY_BASE =
  "https://mapservices.nps.gov/arcgis/rest/services/NationalDatasets/NPS_Public_POIs/FeatureServer/0/query";

function stateByParkCode() {
  const geo = readJson(path.join(TOOLS_DIR, "nps-us-geo.json"));
  const map = {};
  if (!geo?.units) return map;
  for (const u of geo.units) map[u.parkCode.toLowerCase()] = u.state;
  return map;
}

export async function ingestNps() {
  const outDir = ensureIngestDir("01-nps-poi");
  const outFields = "POINAME,POITYPE,UNITCODE,UNITNAME";
  const parkStates = stateByParkCode();
  console.log("NPS POI: downloading Campground features...");
  const features = await fetchArcgisAllFeatures(
    QUERY_BASE,
    "POITYPE='Campground'",
    outFields,
    2000
  );
  console.log("NPS POI: raw features", features.length);

  const records = [];
  const skipped = { noCoords: 0, commercial: 0 };

  for (const f of features) {
    const a = f.attributes || {};
    const g = f.geometry;
    const lat = g?.y;
    const lon = g?.x;
    if (!coordValid(lat, lon)) {
      skipped.noCoords++;
      continue;
    }
    const name = (a.POINAME || "NPS Campground").trim();
    if (isCommercialName(name)) {
      skipped.commercial++;
      continue;
    }
    const parkCode = (a.UNITCODE || "").toLowerCase();
    const state = parkCode && parkStates[parkCode] ? parkStates[parkCode].split(",")[0] : "";

    const rec = baseRecord({
      id: `CG-NPS-${(parkCode || "unk").toUpperCase()}-${slugify(name)}`,
      name,
      type: /group/i.test(a.POITYPE || "") ? "group" : "developed",
      landManager: "NPS",
      parentUnit: parkCode
        ? { system: "nps", parkCode, name: a.UNITNAME || parkCode }
        : null,
      state,
      lat,
      lon,
      coordSource: "nps-arcgis-poi",
      coordConfidence: "medium",
      cost: "fee",
      reservable: null,
      commercial: false,
      ingestSource: "01-nps-poi",
      sourceIds: { poiType: a.POITYPE },
      urls: parkCode ? { detail: `https://www.nps.gov/${parkCode}/planyourvisit/camping.htm` } : {},
    });

    if (!parkCode) addReview(rec, "missing-parent-unit", "NO_PARENT");
    if (!rec.state) addReview(rec, "missing-state", "NO_STATE");

    records.push(rec);
  }

  const payload = {
    generated: new Date().toISOString(),
    source: "mapservices.nps.gov NPS_Public_POIs",
    where: "POITYPE='Campground'",
    rawCount: features.length,
    recordCount: records.length,
    skipped,
    records,
  };
  writeJson(path.join(outDir, "campgrounds.json"), payload);
  console.log("NPS ingest saved:", payload.recordCount, "records");
  return payload;
}

if (process.argv[1]?.endsWith("build-camping-us-ingest-nps.mjs")) {
  await ingestNps();
}
