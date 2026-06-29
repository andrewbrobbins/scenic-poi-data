/**
 * Parks Canada amenities: camping + facilities (picnic, restroom).
 */
import path from "path";
import {
  PC_FACILITIES_QUERY,
  coordValid,
  fetchArcgisAllFeatures,
  loadPcUnitMaps,
  resolveParentUnit,
  slugify,
  writeJson,
} from "./parks-canada-lib.mjs";
import { inferStateFromCoords } from "./camping-ca-geo-utils.mjs";
import {
  amenityId,
  baseRecord,
  addReview,
  applyInferredCampgroundAccess,
} from "./park-amenities-lib.mjs";
import { ensureIngestDir } from "./park-amenities-ca-lib.mjs";

const PC_ACCOMMODATION_QUERY =
  "https://services2.arcgis.com/wCOMu5IS7YdSyPNx/arcgis/rest/services/vw_Accommodation_Hebergement_V2_FGP/FeatureServer/0/query";

/** Facility type codes → amenity kind (Parks Canada open data). */
const PC_FACILITY_KIND = {
  picnic: "picnic_area",
  "picnic area": "picnic_area",
  "day use": "picnic_area",
  toilet: "restroom",
  washroom: "restroom",
  restroom: "restroom",
  "comfort station": "restroom",
  shower: "restroom",
};

function parkCodeFromUrl(urlCode) {
  const m = (urlCode || "").match(/^([A-Za-z]{2,5})-/);
  return m ? m[1].toLowerCase() : slugify(urlCode).slice(0, 8) || "pc";
}

function classifyPcFacility(nameEn, labelEn, typeCode) {
  const blob = `${nameEn || ""} ${labelEn || ""} ${typeCode || ""}`.toLowerCase();
  for (const [needle, kind] of Object.entries(PC_FACILITY_KIND)) {
    if (blob.includes(needle)) return kind;
  }
  if (/camp/i.test(blob)) return "campground";
  return null;
}

/** Roll individual PC campsite features up to one amenity per campground. */
function aggregatePcCampgrounds(campFeats, unitMaps, skipped) {
  const groups = new Map();

  for (const f of campFeats) {
    const a = f.attributes || {};
    const lat = f.geometry?.y;
    const lon = f.geometry?.x;
    if (!coordValid(lat, lon)) {
      skipped.noCoords++;
      continue;
    }
    const name = (a.Name_e || a.Nom_f || "Parks Canada campground").trim();
    const urlCode = (a.URL_e || a.URL_f || "").trim();
    const parkCode = parkCodeFromUrl(urlCode);
    const parentUnit = resolveParentUnit({ parkCode, name, lat, lon }, unitMaps);
    const province = inferStateFromCoords(lat, lon);
    const campTier = /backcountry|walk.?in|wilderness|random/i.test(name) ? "backcountry" : "developed";
    const groupKey = `${parentUnit.parkCode || parkCode}:${name.toLowerCase()}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        name,
        urlCode,
        parkCode,
        parentUnit,
        province,
        campTier,
        sites: [],
      });
    }
    groups.get(groupKey).sites.push({
      lat,
      lon,
      objectId: a.OBJECTID,
      siteNum: a.Site_Num_Site,
    });
  }

  const records = [];
  for (const g of groups.values()) {
    let lat = 0;
    let lon = 0;
    for (const s of g.sites) {
      lat += s.lat;
      lon += s.lon;
    }
    lat /= g.sites.length;
    lon /= g.sites.length;

    const rec = baseRecord({
      id: amenityId("PC", g.parentUnit.parkCode || g.parkCode, "campground", g.campTier, g.name, lat, lon),
      name: g.name,
      kind: "campground",
      subtype: g.campTier,
      campTier: g.campTier,
      country: "CA",
      landManager: "Parks Canada",
      parkCode: g.parentUnit.parkCode || g.parkCode,
      parentUnit: { ...g.parentUnit, system: "pc" },
      state: g.province,
      lat,
      lon,
      coordSource: "pc-arcgis-accommodation-centroid",
      coordConfidence: "high",
      ingestSource: "01-pc-arcgis",
      sourceIds: {
        urlCode: g.urlCode,
        accType: "Camping",
        siteCount: g.sites.length,
      },
      urls: { detail: "https://parks.canada.ca/voyage-travel/hebergement-accommodation/camping" },
    });
    applyInferredCampgroundAccess(rec);
    records.push(rec);
  }

  return records;
}

export async function ingestPcArcgis() {
  const outDir = ensureIngestDir("01-pc-arcgis");
  const unitMaps = loadPcUnitMaps();
  const records = [];
  const skipped = { noCoords: 0, unclassified: 0 };

  console.log("PC accommodation (camping)...");
  const campFeats = await fetchArcgisAllFeatures(
    PC_ACCOMMODATION_QUERY,
    "Accommodation_Type='Camping'",
    "OBJECTID,Name_e,Nom_f,URL_e,URL_f,Accommodation_Type,Site_Num_Site",
    2000
  );
  const campRecords = aggregatePcCampgrounds(campFeats, unitMaps, skipped);
  records.push(...campRecords);
  console.log("  →", campFeats.length, "campsite features →", campRecords.length, "campgrounds");

  console.log("PC facilities (picnic/restroom)...");
  const facFeats = await fetchArcgisAllFeatures(
    PC_FACILITIES_QUERY,
    "1=1",
    "OBJECTID,Name_e,Nom_f,Label_e,Etiquette_f,Facility_Type_Installation,URL_e,URL_f",
    2000
  );
  for (const f of facFeats) {
    const a = f.attributes || {};
    const lat = f.geometry?.y;
    const lon = f.geometry?.x;
    if (!coordValid(lat, lon)) {
      skipped.noCoords++;
      continue;
    }
    const name = (a.Name_e || a.Nom_f || a.Label_e || "Facility").trim();
    const kind = classifyPcFacility(name, a.Label_e, a.Facility_Type_Installation);
    if (!kind || kind === "campground") {
      skipped.unclassified++;
      continue;
    }
    const url = (a.URL_e || a.URL_f || "").trim();
    const parkSlug = url.match(/pn-np\/[a-z]{2}\/([^/?#]+)/i)?.[1]?.toLowerCase() || "";
    const parkCode = parkSlug || parkCodeFromUrl(name);
    const parentUnit = resolveParentUnit({ parkCode, parkSlug, name, lat, lon }, unitMaps);
    const province = inferStateFromCoords(lat, lon);

    records.push(
      baseRecord({
        id: amenityId("PC", parentUnit.parkCode || parkCode, kind, null, name, lat, lon),
        name,
        kind,
        subtype: kind === "restroom" ? "restroom" : "area",
        country: "CA",
        landManager: "Parks Canada",
        parkCode: parentUnit.parkCode || parkCode,
        parentUnit: { ...parentUnit, system: "pc" },
        state: province,
        lat,
        lon,
        coordSource: "pc-arcgis-facilities",
        coordConfidence: "medium",
        ingestSource: "01-pc-arcgis",
        sourceIds: { objectId: a.OBJECTID, facilityType: a.Facility_Type_Installation },
        urls: { park: parentUnit.parkCode ? `https://parks.canada.ca/pn-np/${(province || "ab").toLowerCase()}/${parentUnit.parkCode}` : "https://parks.canada.ca/" },
      })
    );
  }

  const payload = {
    generated: new Date().toISOString(),
    source: "Parks Canada ArcGIS",
    rawCamping: campFeats.length,
    aggregatedCampgrounds: campRecords.length,
    rawFacilities: facFeats.length,
    recordCount: records.length,
    skipped,
    records,
  };
  writeJson(path.join(outDir, "amenities.json"), payload);
  console.log("PC amenities saved:", records.length);
  return payload;
}

if (process.argv[1]?.endsWith("build-park-amenities-ingest-pc-arcgis.mjs")) {
  await ingestPcArcgis();
}
