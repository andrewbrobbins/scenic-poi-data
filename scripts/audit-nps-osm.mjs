/**
 * Audit NPS parks/monuments vs ArcGIS, centroids, and OSM Overpass.
 * Usage: node scripts/audit-nps-osm.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const US = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY VI PR GU AS MP".split(
    " "
  )
);

function readJson(p) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
}

function usStates(state) {
  return (state || "")
    .split(/[,;]/)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => US.has(s));
}

function parkName(tags) {
  return (tags?.name || tags?.["name:en"] || tags?.official_name || "").trim();
}

async function fetchArcgis() {
  const url =
    "https://services.northeastoceandata.org/arcgis1/rest/services/RecreationAndCulture/MapServer/28/query?where=1%3D1&outFields=UNIT_CODE,UNIT_NAME,UNIT_TYPE,STATE,PARKNAME&returnGeometry=false&f=json";
  const j = await (await fetch(url)).json();
  return j.features.map((f) => f.attributes);
}

async function fetchCentroids() {
  const url =
    "https://raw.githubusercontent.com/nationalparkservice/data/gh-pages/projects/web_services_division/find_a_park/park_centroids_and_bounds.json";
  const t = await (await fetch(url)).text();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  return JSON.parse(t.slice(start, end + 1));
}

async function queryOsm() {
  const query = `
[out:json][timeout:240];
area["ISO3166-1"="US"]["admin_level"="2"]->.us;
(
  relation["boundary"="national_park"](area.us);
  relation["boundary"="protected_area"]["protect_class"="2"](area.us);
  relation["boundary"="protected_area"]["operator"~"National Park Service",i](area.us);
);
out tags center;`;
  const res = await fetch("https://overpass.kumi.systems/api/interpreter", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "scenic-poi-data-audit/1.0",
    },
    body: "data=" + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error("Overpass HTTP " + res.status);
  const j = await res.json();
  return j.elements || [];
}

function normName(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/\bnational park\b/g, "")
    .replace(/\bnational monument\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const arcgis = await fetchArcgis();
const centroidsLive = await fetchCentroids();
const geo = readJson("nps-us-geo.json");
const centroidsCache = readJson("nps-centroids-cache.json").data;
const geoByCode = Object.fromEntries(geo.units.map((u) => [u.parkCode, u]));

const arcParks = arcgis.filter(
  (r) => r.UNIT_TYPE === "National Park" && usStates(r.STATE).length
);
const arcMonuments = arcgis.filter(
  (r) => r.UNIT_TYPE === "National Monument" && usStates(r.STATE).length
);

console.log("=== Official ArcGIS (live) ===");
console.log("National Park (US):", arcParks.length);
console.log("National Monument (US):", arcMonuments.length);

console.log("\n=== nps-us-geo.json ===");
console.log("Total units:", geo.units.length);
console.log(
  "designation National Park:",
  geo.units.filter((u) => u.designation === "National Park").length
);
console.log(
  "designation National Monument:",
  geo.units.filter((u) => u.designation === "National Monument").length
);
console.log("category park:", geo.categories?.park);
console.log("category monument:", geo.categories?.monument);

const missingMon = [];
const wrongParkDes = [];
for (const r of arcParks) {
  const code = r.UNIT_CODE.toLowerCase();
  const g = geoByCode[code];
  if (!g) wrongParkDes.push({ code, issue: "missing", name: r.UNIT_NAME });
  else if (g.designation !== "National Park")
    wrongParkDes.push({ code, issue: "wrong designation", name: g.name, designation: g.designation });
}
for (const r of arcMonuments) {
  const code = r.UNIT_CODE.toLowerCase();
  if (!geoByCode[code]) {
    const cenCache = centroidsCache[code];
    const cenLive = centroidsLive[code];
    missingMon.push({
      code,
      name: r.UNIT_NAME,
      state: r.STATE,
      centroidCache: cenCache?.c ? true : false,
      centroidLive: cenLive?.c ? true : false,
    });
  }
}

console.log("\n=== Parks: wrong designation or missing ===");
wrongParkDes.forEach((x) => console.log(" ", x.code, x.issue, x.name, x.designation || ""));

console.log("\n=== Monuments missing from geo (" + missingMon.length + ") ===");
missingMon.forEach((m) =>
  console.log(
    " ",
    m.code,
    m.name,
    m.state,
    "centroid cache:",
    m.centroidCache,
    "live:",
    m.centroidLive
  )
);

const osmEls = await queryOsm();
const npBoundary = osmEls.filter((e) => e.tags?.boundary === "national_park");
const npNames = [...new Set(npBoundary.map((e) => parkName(e.tags)).filter(Boolean))].sort();
const monumentOsm = osmEls.filter(
  (e) =>
    /national monument/i.test(parkName(e.tags)) ||
    /national monument/i.test(e.tags?.designation || "")
);
const monumentNames = [...new Set(monumentOsm.map((e) => parkName(e.tags)).filter(Boolean))].sort();

console.log("\n=== OSM (US relations) ===");
console.log("boundary=national_park relations:", npBoundary.length, "unique names:", npNames.length);
console.log("name/designation ~ national monument:", monumentOsm.length, "unique names:", monumentNames.length);

const arcParkNorm = new Map(
  arcParks.map((r) => [normName(r.UNIT_NAME || r.PARKNAME), r.UNIT_CODE.toLowerCase()])
);
const osmNotInArc = [];
for (const name of npNames) {
  const n = normName(name);
  if (!n) continue;
  let matched = false;
  for (const [an, code] of arcParkNorm) {
    if (an.includes(n) || n.includes(an)) {
      matched = true;
      break;
    }
  }
  if (!matched) osmNotInArc.push(name);
}
console.log("\nOSM national_park names with no ArcGIS National Park fuzzy match (" + osmNotInArc.length + "):");
osmNotInArc.slice(0, 30).forEach((n) => console.log(" ", n));
if (osmNotInArc.length > 30) console.log(" ... and", osmNotInArc.length - 30, "more");

const arcMonNorm = new Set(
  arcMonuments.map((r) => normName(r.UNIT_NAME || r.PARKNAME))
);
const osmMonNotInArc = monumentNames.filter((name) => {
  const n = normName(name);
  if (!n) return false;
  for (const an of arcMonNorm) {
    if (an.includes(n) || n.includes(an)) return false;
  }
  return true;
});
console.log("\nOSM monument names not fuzzy-matching ArcGIS (" + osmMonNotInArc.length + "):");
osmMonNotInArc.slice(0, 25).forEach((n) => console.log(" ", n));
