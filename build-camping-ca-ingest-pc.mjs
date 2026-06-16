/**
 * Parks Canada campgrounds / accommodation from federal ArcGIS (open data).
 */
import path from "path";
import {
  baseRecord,
  addReview,
  coordValid,
  ensureIngestDir,
  fetchArcgisAllFeatures,
  isCommercialName,
  slugify,
  writeJson,
} from "./camping-ca-lib.mjs";
import { inferStateFromCoords } from "./camping-ca-geo-utils.mjs";
import { formatCaCampgroundDisplayName } from "./camping-ca-display-name.mjs";

const QUERY_BASE =
  "https://services2.arcgis.com/wCOMu5IS7YdSyPNx/arcgis/rest/services/vw_Accommodation_Hebergement_V2_FGP/FeatureServer/0/query";

function pickName(a) {
  return (a.Name_e || a.Nom_f || "Parks Canada campground").trim();
}

function pickType(a) {
  return (a.Accommodation_Type || "").trim();
}

function parkCodeFromUrl(urlCode) {
  const m = (urlCode || "").match(/^([A-Za-z]{2,5})-/);
  return m ? m[1].toLowerCase() : slugify(urlCode).slice(0, 8) || "pc";
}

export async function ingestParksCanada() {
  const outDir = ensureIngestDir("01-parks-canada");
  console.log("Parks Canada accommodation: downloading...");
  const features = await fetchArcgisAllFeatures(
    QUERY_BASE,
    "Accommodation_Type='Camping'",
    "OBJECTID,Name_e,Nom_f,URL_e,URL_f,Accommodation_Type,Site_Num_Site",
    2000
  );
  console.log("Parks Canada: raw features", features.length);

  const records = [];
  const skipped = { noCoords: 0, notCamping: 0, commercial: 0 };

  for (const f of features) {
    const a = f.attributes || {};
    const g = f.geometry;
    const lat = g?.y;
    const lon = g?.x;
    if (!coordValid(lat, lon)) {
      skipped.noCoords++;
      continue;
    }
    const accType = pickType(a);
    if (accType !== "Camping") {
      skipped.notCamping++;
      continue;
    }
    const arcgisName = pickName(a);
    const urlCode = (a.URL_e || a.URL_f || "").trim();
    if (isCommercialName(arcgisName, "", "")) {
      skipped.commercial++;
      continue;
    }
    const parkCode = parkCodeFromUrl(urlCode);
    const parkName = urlCode.split("-")[0] || parkCode;
    const pr = inferStateFromCoords(lat, lon);

    const rec = baseRecord({
      id: `CG-PC-${parkCode}-${slugify(arcgisName)}-${a.OBJECTID || a.FID || records.length}`,
      name: arcgisName,
      type: /group/i.test(accType) ? "group" : "developed",
      landManager: "Parks Canada",
      parentUnit: urlCode ? { system: "pc", parkCode, name: parkName, siteCode: urlCode } : null,
      state: pr,
      lat,
      lon,
      coordSource: "parks-canada-arcgis",
      coordConfidence: "high",
      cost: "fee",
      reservable: null,
      commercial: false,
      ingestSource: "01-parks-canada",
      sourceIds: { objectId: a.OBJECTID, accType, urlCode, arcgisName },
      urls: { detail: "https://parks.canada.ca/voyage-travel/hebergement-accommodation/camping" },
    });

    if (!pr) addReview(rec, "missing-state", "NO_STATE");

    rec.name = formatCaCampgroundDisplayName(rec);
    records.push(rec);
  }

  const payload = {
    generated: new Date().toISOString(),
    source: "Parks Canada Accommodation (Open Government)",
    recordCount: records.length,
    skipped,
    records,
  };
  writeJson(path.join(outDir, "campgrounds.json"), payload);
  console.log("Parks Canada campgrounds:", records.length, "skipped", skipped);
  return payload;
}

if (process.argv[1]?.endsWith("build-camping-ca-ingest-pc.mjs")) {
  await ingestParksCanada();
}
