import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  APCA_PLACES_QUERY,
  GEO_PATH,
  EMBED_PATH,
  centroidFromEsriGeometry,
  coordValid,
  fetchArcgisAllFeatures,
  parkCodeFromPlaceName,
  pcCategory,
  pcUrlFromName,
  readJson,
  writeJson,
} from "./parks-canada-lib.mjs";
import { computeMapPinsFromFeature, loadBoundaryIndex } from "./park-boundary-pins.mjs";
import { inferStateFromCoords } from "./camping-ca-geo-utils.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = path.join(tools, "parks-canada-arcgis-cache.json");

const PLACE_TYPES = [
  "National Park",
  "National Park Reserve",
  "National Historic Site",
  "National Marine Conservation Area",
  "National Marine Conservation Area Reserve",
];

export async function buildParksCanadaCache(refreshNetwork = false) {
  let raw;
  if (!refreshNetwork && fs.existsSync(CACHE_PATH)) {
    console.log("Using cached Parks Canada ArcGIS places");
    raw = readJson(CACHE_PATH, { features: [] }).features || [];
  } else {
    const where = PLACE_TYPES.map((t) => `PLACE_TYPE_E='${t.replace(/'/g, "''")}'`).join(" OR ");
    console.log("Parks Canada places:", where);
    raw = await fetchArcgisAllFeatures(
      APCA_PLACES_QUERY,
      where,
      "BAID,PLACE_TYPE_E,TYPE_DE_LIEUX_F,DESC_EN,DESC_FR,Public_Information_Publique",
      200,
      0
    );
    writeJson(CACHE_PATH, { generated: new Date().toISOString(), features: raw });
  }

  const boundaryIndex = loadBoundaryIndex();
  const byBaid = new Map();
  for (const f of raw) {
    const a = f.attributes || {};
    const baid = a.BAID;
    if (!baid) continue;
    if (!byBaid.has(baid)) byBaid.set(baid, []);
    byBaid.get(baid).push(f);
  }

  const units = [];
  for (const [baid, list] of byBaid) {
    const primary = list[0];
    const a = primary.attributes || {};
    const name = (a.DESC_EN || a.DESC_FR || "Parks Canada place").trim();
    const nameFr = (a.DESC_FR || "").trim();
    const designation = a.PLACE_TYPE_E || "";
    const parkCode = parkCodeFromPlaceName(name);
    const boundaryFeature = boundaryIndex.byCaCode.get(parkCode);
    const pinResult = boundaryFeature
      ? computeMapPinsFromFeature(boundaryFeature, { parkCode })
      : null;
    const fallbackCen = centroidFromEsriGeometry(primary.geometry);
    const primaryPin = pinResult?.primary;
    const lat = primaryPin?.lat ?? fallbackCen?.lat;
    const lon = primaryPin?.lon ?? fallbackCen?.lon;
    if (!coordValid(lat, lon)) continue;
    const province = inferStateFromCoords(lat, lon);

    units.push({
      id: `pc-${parkCode}`,
      parkCode,
      baid,
      name,
      nameFr: nameFr || undefined,
      designation,
      category: pcCategory(designation),
      lat: Math.round(lat * 1e5) / 1e5,
      lon: Math.round(lon * 1e5) / 1e5,
      coordSource: primaryPin ? "boundary_centroid" : "apca-boundary-centroid",
      pinStrategy: pinResult?.strategy || "single",
      mapPins: pinResult?.pins?.length ? pinResult.pins : undefined,
      state: province,
      url: pcUrlFromName(name, province),
      publicInfo: a.Public_Information_Publique === 1,
    });
  }

  units.sort((a, b) => a.name.localeCompare(b.name));
  const cats = {};
  units.forEach((u) => {
    cats[u.category] = (cats[u.category] || 0) + 1;
  });

  const geo = {
    generated: new Date().toISOString(),
    source: "apca-places-arcgis",
    count: units.length,
    categories: cats,
    units,
  };

  writeJson(GEO_PATH, geo);
  fs.writeFileSync(
    EMBED_PATH,
    "/* Auto-generated — node build-parks-canada-cache.mjs */\nvar PARKS_CANADA=" + JSON.stringify(units) + ";\n",
    "utf8"
  );

  console.log("Parks Canada catalog:", units.length, cats);
  return geo;
}
