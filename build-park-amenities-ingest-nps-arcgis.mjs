/**
 * NPS park amenities from Public POIs ArcGIS (campgrounds by tier, picnic, restroom).
 */
import path from "path";
import {
  addReview,
  allNpsPoiTypes,
  baseRecord,
  buildPoiTypeWhere,
  classifyNpsPoiType,
  coordValid,
  ensureIngestDir,
  fetchArcgisAllFeatures,
  loadNpsUnitMaps,
  loadPoiTypeConfig,
  npsAmenityId,
  applyInferredCampgroundAccess,
  resolveParentUnit,
  resolveState,
  stateByParkCode,
  writeJson,
} from "./park-amenities-us-lib.mjs";
import { ARCGIS_POI_QUERY } from "./nps-visitor-centers-lib.mjs";

const OUT_FIELDS = "POINAME,POITYPE,UNITCODE,UNITNAME";

export async function ingestNpsArcgis() {
  const outDir = ensureIngestDir("01-nps-arcgis");
  const config = loadPoiTypeConfig();
  const types = allNpsPoiTypes(config);
  const parkStates = stateByParkCode();
  const unitMaps = loadNpsUnitMaps();
  const where = buildPoiTypeWhere(types);

  console.log("NPS amenities ArcGIS: fetching", types.length, "POITYPE values...");
  const features = await fetchArcgisAllFeatures(ARCGIS_POI_QUERY, where, OUT_FIELDS, 2000);
  console.log("NPS amenities ArcGIS: raw features", features.length);

  const records = [];
  const skipped = { noCoords: 0, noPark: 0, unclassified: 0 };
  const byKind = { campground: 0, picnic_area: 0, restroom: 0 };
  const byCampTier = { developed: 0, backcountry: 0, primitive: 0 };

  for (const f of features) {
    const a = f.attributes || {};
    const lat = f.geometry?.y;
    const lon = f.geometry?.x;
    if (!coordValid(lat, lon)) {
      skipped.noCoords++;
      continue;
    }

    const poiType = (a.POITYPE || "").trim();
    const name = (a.POINAME || poiType || "Park amenity").trim();
    const classified = classifyNpsPoiType(poiType, name, config);
    if (!classified) {
      skipped.unclassified++;
      continue;
    }

    const parkCodeRaw = (a.UNITCODE || "").toLowerCase();
    if (!parkCodeRaw) {
      skipped.noPark++;
      continue;
    }

    const parentUnit = resolveParentUnit(parkCodeRaw, unitMaps);
    const rec = baseRecord({
      id: npsAmenityId(
        parentUnit.parkCode,
        classified.kind,
        classified.campTier,
        name,
        lat,
        lon
      ),
      name,
      kind: classified.kind,
      subtype: classified.subtype,
      campTier: classified.campTier,
      landManager: "NPS",
      country: "US",
      parkCode: parentUnit.parkCode,
      parentUnit,
      state: "",
      lat,
      lon,
      coordSource: "nps-arcgis-poi",
      coordConfidence: "medium",
      ingestSource: "01-nps-arcgis",
      sourceIds: {
        poiType,
        unitCode: a.UNITCODE,
        unitName: a.UNITNAME,
      },
      urls: amenityUrls(parentUnit.parkCode, classified.kind),
    });

    resolveState(rec, parkStates);
    applyInferredCampgroundAccess(rec);
    if (!rec.state) addReview(rec, "missing-state", "NO_STATE");
    if (poiType === "Camping") addReview(rec, "ambiguous-camp-tier", "CAMP_TIER_GUESS");

    records.push(rec);
    byKind[classified.kind] = (byKind[classified.kind] || 0) + 1;
    if (classified.kind === "campground" && classified.campTier) {
      byCampTier[classified.campTier] = (byCampTier[classified.campTier] || 0) + 1;
    }
  }

  const payload = {
    generated: new Date().toISOString(),
    source: "mapservices.nps.gov NPS_Public_POIs",
    poiTypeCount: types.length,
    rawCount: features.length,
    recordCount: records.length,
    skipped,
    byKind,
    byCampTier,
    records,
  };

  writeJson(path.join(outDir, "amenities.json"), payload);
  console.log(
    "NPS amenities ArcGIS saved:",
    payload.recordCount,
    "| campground tiers:",
    JSON.stringify(byCampTier)
  );
  return payload;
}

function amenityUrls(parkCode, kind) {
  const base = `https://www.nps.gov/${parkCode}/`;
  if (kind === "campground") {
    return { park: base, detail: `${base}planyourvisit/camping.htm` };
  }
  return { park: base };
}

if (process.argv[1]?.endsWith("build-park-amenities-ingest-nps-arcgis.mjs")) {
  await ingestNpsArcgis();
}
