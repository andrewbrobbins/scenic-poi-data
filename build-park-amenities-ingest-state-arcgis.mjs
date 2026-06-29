/**
 * State / provincial park amenities from official ArcGIS layers (parent via officialCode).
 */
import path from "path";
import fs from "fs";
import {
  STATE_SOURCES_PATH,
  addReview,
  amenityId,
  baseRecord,
  classifyCaCampTier,
  coordValid,
  fetchArcgisAllFeatures,
  readJson,
  writeJson,
  applyInferredCampgroundAccess,
} from "./park-amenities-us-lib.mjs";
import { INGEST_DIR as US_INGEST_DIR } from "./park-amenities-us-lib.mjs";
import { INGEST_DIR as CA_INGEST_DIR } from "./park-amenities-ca-lib.mjs";
import { loadStateParkIndex, resolveStateParkParent, resolveStateParkParentByName } from "./park-amenities-state-park-lib.mjs";
import { inferStateFromCoords } from "./camping-us-geo-utils.mjs";
import { inferStateFromCoords as inferProvinceFromCoords } from "./camping-ca-geo-utils.mjs";
import { coordValid as coordValidCa } from "./camping-ca-lib.mjs";

function attr(a, field) {
  if (!field) return "";
  const v = a[field];
  return v == null ? "" : String(v).trim();
}

function resolveKind(layer, a) {
  if (layer.kindFromTypeField && layer.kindFromTypeMap) {
    const tv = attr(a, layer.kindFromTypeField);
    if (!tv) return null;
    if (Object.prototype.hasOwnProperty.call(layer.kindFromTypeMap, tv)) {
      return layer.kindFromTypeMap[tv];
    }
    return null;
  }
  return layer.kind || null;
}

function coordsFromFeature(f, layer) {
  let lat = f.geometry?.y;
  let lon = f.geometry?.x;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    const a = f.attributes || {};
    lat = Number(attr(a, layer.latField));
    lon = Number(attr(a, layer.lonField));
  }
  return { lat, lon };
}

function buildName(layer, a, kind) {
  if (layer.nameTemplate) {
    return layer.nameTemplate
      .replace(/\{(\w+)\}/g, (_, key) => attr(a, key))
      .replace(/\s+/g, " ")
      .trim();
  }
  let name = attr(a, layer.nameField) || attr(a, layer.nameFallbackField);
  if (!name && kind === "picnic_area") name = "Picnic area";
  if (!name && kind === "parking") name = "Parking";
  if (!name && kind === "restroom") name = "Restroom";
  if (!name && kind === "visitor_center") name = "Visitor center";
  return name;
}

function ingestLayer(layer, stateCode, country, parkIndex, coordCheck) {
  const where = layer.where || "1=1";
  const features = fetchArcgisAllFeatures(layer.queryUrl, where, layer.outFields, 2000);
  return features.then((feats) => {
    const records = [];
    const skipped = { noCoords: 0, noName: 0, noParent: 0, unmappedType: 0 };
    for (const f of feats) {
      const a = f.attributes || {};
      const { lat, lon } = coordsFromFeature(f, layer);
      if (!coordCheck(lat, lon)) {
        skipped.noCoords++;
        continue;
      }

      const kind = resolveKind(layer, a);
      if (!kind) {
        skipped.unmappedType++;
        continue;
      }

      const name = buildName(layer, a, kind);
      if (!name) {
        skipped.noName++;
        continue;
      }
      const officialCode = attr(a, layer.codeField);
      const parkUnitName = attr(a, layer.parentNameField);
      const admin = country === "CA" ? inferProvinceFromCoords(lat, lon) : inferStateFromCoords(lat, lon);
      const parentUnit = layer.parentNameField
        ? resolveStateParkParentByName(
            { parkUnitName, lat, lon, state: admin || stateCode, country },
            parkIndex
          )
        : resolveStateParkParent(
            { officialCode, lat, lon, state: admin || stateCode, country },
            parkIndex
          );
      if (!parentUnit.id && !officialCode) skipped.noParent++;

      let campTier;
      let subtype = attr(a, layer.subtypeField) || kind;
      if (kind === "campground") {
        campTier = classifyCaCampTier(
          attr(a, layer.typeField) || attr(a, layer.kindFromTypeField),
          attr(a, layer.subtypeField),
          name
        );
        subtype = campTier;
      }

      const parentKey = parentUnit.id || officialCode || stateCode;
      const rec = baseRecord({
        id: amenityId(
          country === "CA" ? "SP-CA" : "SP-US",
          parentKey,
          kind,
          campTier,
          name,
          lat,
          lon
        ),
        name,
        kind,
        subtype,
        campTier,
        country,
        landManager: country === "CA" ? "Provincial" : "State",
        parkCode: parentUnit.parkCode || officialCode,
        parentUnit,
        state: admin || stateCode,
        lat,
        lon,
        coordSource: "state-arcgis",
        coordConfidence: "high",
        ingestSource: "02-state-arcgis",
        sourceIds: {
          state: stateCode,
          officialCode,
          type: attr(a, layer.typeField) || attr(a, layer.kindFromTypeField),
          subtype: attr(a, layer.subtypeField),
        },
        urls: layer.urlField ? { detail: attr(a, layer.urlField) } : {},
      });

      if (!parentUnit.id) addReview(rec, "missing-parent-unit", "NO_PARENT");
      applyInferredCampgroundAccess(rec);
      records.push(rec);
    }
    return { records, skipped, rawCount: feats.length };
  });
}

export async function ingestStateArcgis({ region = "us", ingestRoot = null } = {}) {
  const root = ingestRoot || (region === "ca" ? CA_INGEST_DIR : US_INGEST_DIR);
  const outDir = path.join(root, "02-state-arcgis");
  fs.mkdirSync(outDir, { recursive: true });
  const sources = readJson(STATE_SOURCES_PATH, { us: {}, ca: {} });
  const block = region === "ca" ? sources.ca || {} : sources.us || {};
  const allRecords = [];
  const layerStats = [];

  for (const [stateCode, cfg] of Object.entries(block)) {
    const country = cfg.country || (region === "ca" ? "CA" : "US");
    const parkIndex = loadStateParkIndex(country);
    console.log("State amenities ArcGIS:", stateCode, country, cfg.layers?.length || 0, "layers");
    for (const layer of cfg.layers || []) {
      const coordCheck = country === "CA" ? coordValidCa : coordValid;
      const result = await ingestLayer(layer, stateCode, country, parkIndex, coordCheck);
      allRecords.push(...result.records);
      layerStats.push({
        state: stateCode,
        kind: layer.kind || layer.label || "mixed",
        rawCount: result.rawCount,
        recordCount: result.records.length,
        skipped: result.skipped,
      });
      console.log(
        " ",
        stateCode,
        layer.kind || layer.label || "mixed",
        result.records.length + "/" + result.rawCount,
        "skipped",
        result.skipped
      );
    }
  }

  const payload = {
    generated: new Date().toISOString(),
    region,
    recordCount: allRecords.length,
    layerStats,
    records: allRecords,
  };
  writeJson(path.join(outDir, `amenities-${region}.json`), payload);
  console.log("State ArcGIS amenities saved:", allRecords.length);
  return payload;
}

if (process.argv[1]?.endsWith("build-park-amenities-ingest-state-arcgis.mjs")) {
  const region = process.argv.includes("--region=ca") ? "ca" : "us";
  await ingestStateArcgis({ region });
}
