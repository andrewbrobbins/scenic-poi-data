import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fetchArcgisAllFeatures } from "./camping-ca-lib.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));
const US_QUERY =
  "https://services1.arcgis.com/fBc8EJBxQRMcHlei/ArcGIS/rest/services/National_Park_Service_Boundaries/FeatureServer/0/query";
const CA_QUERY =
  "https://services2.arcgis.com/wCOMu5IS7YdSyPNx/arcgis/rest/services/vw_Places_Public_lieux_public_APCA/FeatureServer/0/query";

const US_TYPES = new Set([
  "National Park",
  "National Monument",
  "National Memorial",
  "National Preserve",
]);
const CA_TYPES = new Set(["National Park", "National Park Reserve", "National Historic Site"]);

const TRIP_BBOX = { south: 31.5, west: -125.5, north: 54.0, east: -89.5 };

function ringBbox(ring) {
  let s = Infinity;
  let w = Infinity;
  let n = -Infinity;
  let e = -Infinity;
  for (const [lon, lat] of ring) {
    if (lat < s) s = lat;
    if (lat > n) n = lat;
    if (lon < w) w = lon;
    if (lon > e) e = lon;
  }
  return { south: s, west: w, north: n, east: e };
}

function bboxIntersectsTrip(b) {
  return !(
    b.north < TRIP_BBOX.south ||
    b.south > TRIP_BBOX.north ||
    b.east < TRIP_BBOX.west ||
    b.west > TRIP_BBOX.east
  );
}

function simplifyRing(ring, maxPts = 120) {
  if (!ring?.length || ring.length <= maxPts) return ring;
  const out = [];
  const step = Math.ceil(ring.length / maxPts);
  for (let i = 0; i < ring.length; i += step) out.push(ring[i]);
  const last = ring[ring.length - 1];
  const tail = out[out.length - 1];
  if (!tail || tail[0] !== last[0] || tail[1] !== last[1]) out.push(last);
  return out.length > maxPts ? out.filter((_, i) => i % 2 === 0 || i === out.length - 1) : out;
}

function esriToGeoJsonPolygon(geom) {
  if (!geom?.rings?.length) return null;
  const rings = geom.rings.map((ring) => simplifyRing(ring));
  return { type: "Polygon", coordinates: rings };
}

function usCategory(unitType) {
  const t = (unitType || "").toLowerCase();
  if (t.includes("national park") && !t.includes("historical")) return "park";
  if (t.includes("monument")) return "monument";
  if (t.includes("memorial")) return "memorial";
  if (t.includes("preserve")) return "preserve";
  return "other";
}

function toFeature(props, polygon) {
  if (!polygon) return null;
  return {
    type: "Feature",
    properties: props,
    geometry: polygon,
  };
}

async function fetchUsBoundaries() {
  const where = [...US_TYPES].map((t) => `UNIT_TYPE='${t.replace(/'/g, "''")}'`).join(" OR ");
  console.log("US boundaries:", where);
  const feats = await fetchArcgisAllFeatures(
    US_QUERY,
    where,
    "UNIT_CODE,UNIT_NAME,UNIT_TYPE,STATE,PARKNAME",
    500
  );
  const features = [];
  for (const f of feats) {
    const a = f.attributes || {};
    const poly = esriToGeoJsonPolygon(f.geometry);
    if (!poly) continue;
    const bb = ringBbox(poly.coordinates[0] || []);
    if (!bboxIntersectsTrip(bb)) continue;
    features.push(
      toFeature(
        {
          id: "us-" + (a.UNIT_CODE || a.UNIT_NAME || "unknown").toLowerCase(),
          country: "US",
          name: a.UNIT_NAME || a.PARKNAME || "NPS unit",
          parkCode: (a.UNIT_CODE || "").toLowerCase(),
          category: usCategory(a.UNIT_TYPE),
          unitType: a.UNIT_TYPE || "",
          state: a.STATE || "",
        },
        poly
      )
    );
  }
  return features.filter(Boolean);
}

async function fetchCaBoundaries() {
  const where = [...CA_TYPES].map((t) => `PLACE_TYPE_E='${t.replace(/'/g, "''")}'`).join(" OR ");
  console.log("CA boundaries:", where);
  const feats = await fetchArcgisAllFeatures(CA_QUERY, where, "PLACE_TYPE_E,DESC_EN,DESC_FR", 200);
  const features = [];
  for (const f of feats) {
    const a = f.attributes || {};
    const poly = esriToGeoJsonPolygon(f.geometry);
    if (!poly) continue;
    const bb = ringBbox(poly.coordinates[0] || []);
    if (!bboxIntersectsTrip(bb)) continue;
    const placeType = a.PLACE_TYPE_E || "";
    const category = /historic site/i.test(placeType) ? "monument" : "park";
    features.push(
      toFeature(
        {
          id: "ca-" + slug(a.DESC_EN || a.DESC_FR || "pc"),
          country: "CA",
          name: a.DESC_EN || a.DESC_FR || "Parks Canada place",
          parkCode: "",
          category,
          unitType: placeType,
          state: "",
        },
        poly
      )
    );
  }
  return features.filter(Boolean);
}

function slug(s) {
  return (s || "place")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

async function main() {
  const us = await fetchUsBoundaries();
  console.log("US features in corridor bbox:", us.length);
  const ca = await fetchCaBoundaries();
  console.log("CA features in corridor bbox:", ca.length);
  const fc = {
    type: "FeatureCollection",
    generated: new Date().toISOString(),
    bbox: [TRIP_BBOX.west, TRIP_BBOX.south, TRIP_BBOX.east, TRIP_BBOX.north],
    count: us.length + ca.length,
    features: [...us, ...ca],
  };
  const outJson = path.join(tools, "park-boundaries.geojson");
  fs.writeFileSync(outJson, JSON.stringify(fc), "utf8");
  console.log("Wrote", outJson, fc.count, "features", (fs.statSync(outJson).size / 1024 / 1024).toFixed(2), "MB");

  const embedPath = path.join(tools, "park-boundaries-embed.js");
  fs.writeFileSync(
    embedPath,
    "/* Auto-generated — node build-park-boundaries.mjs */\nvar PARK_BOUNDARIES=" + JSON.stringify(fc) + ";\n",
    "utf8"
  );
  console.log("Wrote", embedPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
