import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const US = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY VI PR GU AS MP".split(" "));

function npsCategory(designation) {
  const d = (designation || "").toLowerCase().trim();
  if (d.includes("national park and preserve") || d.includes("national historical park and preserve")) return "park";
  if (d.includes("national historical park") || d.includes("national historic park")) return "historic_park";
  if (d.includes("national historic site") || d.includes("national historical site") || d.includes("international historic site")) return "historic_site";
  if (d.includes("national monument")) return "monument";
  if (d.includes("national memorial")) return "memorial";
  if (d.includes("national recreation") || d.includes("national seashore") || d.includes("national lakeshore") || d.includes("national river") || d.includes("scenic river") || d.includes("wild river")) return "recreation";
  if (d.includes("national preserve") || d.includes("national reserve")) return "preserve";
  if (d.includes("national battlefield") || d.includes("national military") || d.includes("national cemetery")) return "historic_site";
  if (d.includes("national parkway") || d.includes("national scenic trail") || d.includes("national historic trail")) return "parkway_trail";
  if (d === "park" || d.includes("national park")) return "park";
  if (d.includes("affiliated") || d.includes("other designation")) return "affiliated";
  return "other";
}

async function fetchCentroids() {
  const url = "https://raw.githubusercontent.com/nationalparkservice/data/gh-pages/projects/web_services_division/find_a_park/park_centroids_and_bounds.json";
  const t = await (await fetch(url)).text();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  return JSON.parse(t.slice(start, end + 1));
}

async function fetchArcgisUnits() {
  const url = "https://services.northeastoceandata.org/arcgis1/rest/services/RecreationAndCulture/MapServer/28/query?where=1%3D1&outFields=UNIT_CODE,UNIT_NAME,UNIT_TYPE,STATE,PARKNAME&returnGeometry=false&f=json";
  const j = await (await fetch(url)).json();
  if (!j.features) throw new Error("ArcGIS query failed: " + JSON.stringify(j.error));
  return j.features.map((f) => f.attributes);
}

function pickVisitorCenter(list) {
  if (!list || !list.length) return null;
  const scored = list.map((vc) => {
    const n = (vc.name || "").toLowerCase();
    let score = 0;
    if (/visitor center/.test(n)) score += 20;
    if (/contact station/.test(n)) score += 8;
    if (/headquarters/.test(n)) score += 4;
    if (/campground/.test(n)) score -= 5;
    return { vc, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].vc;
}

async function loadVisitorCentersByPark(refreshNetwork, toolsDir) {
  const vcCachePath = path.join(toolsDir, "nps-visitor-centers-cache.json");
  if (!refreshNetwork && fs.existsSync(vcCachePath)) {
    const cached = JSON.parse(fs.readFileSync(vcCachePath, "utf8"));
    return cached.byPark || {};
  }
  const apiKey = process.env.NPS_API_KEY;
  if (!apiKey) {
    console.log("No NPS_API_KEY — visitor centers not downloaded (use park-list coords or existing cache).");
    if (fs.existsSync(vcCachePath)) {
      return JSON.parse(fs.readFileSync(vcCachePath, "utf8")).byPark || {};
    }
    return {};
  }
  console.log("Downloading NPS visitor centers (API)...");
  const byPark = {};
  let start = 0;
  const limit = 50;
  while (true) {
    const url =
      "https://developer.nps.gov/api/v1/visitorcenters?limit=" +
      limit +
      "&start=" +
      start;
    const res = await fetch(url, { headers: { "X-Api-Key": apiKey } });
    if (!res.ok) throw new Error("NPS visitorcenters HTTP " + res.status);
    const data = await res.json();
    const rows = data.data || [];
    for (const vc of rows) {
      const code = (vc.parkCode || "").toLowerCase();
      if (!code) continue;
      const lat = parseFloat(vc.latitude);
      const lon = parseFloat(vc.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (!byPark[code]) byPark[code] = [];
      byPark[code].push({
        name: vc.name || "Visitor Center",
        latitude: lat,
        longitude: lon,
        description: (vc.description || "").slice(0, 120),
      });
    }
    if (rows.length < limit) break;
    start += limit;
  }
  fs.writeFileSync(
    vcCachePath,
    JSON.stringify({ generated: new Date().toISOString(), byPark }, null, 2),
    "utf8"
  );
  console.log("Visitor centers cached for", Object.keys(byPark).length, "parks");
  return byPark;
}

export async function buildNpsCache(refreshNetwork = false) {
  const tools = __dirname;
  const metaPath = path.join(tools, "nps-us-cache-meta.json");
  const geoPath = path.join(tools, "nps-us-geo.json");
  const embedPath = path.join(tools, "nps-us-embed.js");
  const centroidsPath = path.join(tools, "nps-centroids-cache.json");
  const arcgisPath = path.join(tools, "nps-arcgis-units-cache.json");
  const parksCachePath = path.join(tools, "nps-parks-cache.json");

  let centroids, arcgis;
  if (refreshNetwork || !fs.existsSync(centroidsPath) || !fs.existsSync(arcgisPath)) {
    console.log("Downloading NPS centroids + ArcGIS unit list...");
    [centroids, arcgis] = await Promise.all([fetchCentroids(), fetchArcgisUnits()]);
    fs.writeFileSync(centroidsPath, JSON.stringify({ generated: new Date().toISOString(), data: centroids }, null, 2), "utf8");
    fs.writeFileSync(arcgisPath, JSON.stringify({ generated: new Date().toISOString(), units: arcgis }, null, 2), "utf8");
  } else {
    console.log("Using cached centroids + ArcGIS");
    centroids = JSON.parse(fs.readFileSync(centroidsPath, "utf8")).data;
    arcgis = JSON.parse(fs.readFileSync(arcgisPath, "utf8")).units;
  }

  const richByCode = {};
  if (fs.existsSync(parksCachePath)) {
    for (const p of JSON.parse(fs.readFileSync(parksCachePath, "utf8"))) richByCode[p.parkCode.toLowerCase()] = p;
  }

  const visitorByPark = await loadVisitorCentersByPark(refreshNetwork, tools);

  const units = [];
  const seen = new Set();
  for (const row of arcgis) {
    const code = (row.UNIT_CODE || "").toLowerCase();
    if (!code || seen.has(code)) continue;
    const states = (row.STATE || "").split(/[,;]/).map((s) => s.trim().toUpperCase()).filter((s) => US.has(s));
    if (!states.length) continue;
    const designation = row.UNIT_TYPE || "Park";
    const rich = richByCode[code];
    const cen = centroids[code];
    const vc = pickVisitorCenter(visitorByPark[code]);
    let lat;
    let lon;
    let coordSource = "centroid";
    let visitorCenter = null;
    if (vc) {
      lat = vc.latitude;
      lon = vc.longitude;
      coordSource = "visitor_center";
      visitorCenter = { name: vc.name, lat, lon };
    } else if (rich && Number.isFinite(+rich.latitude) && Number.isFinite(+rich.longitude)) {
      lat = +rich.latitude;
      lon = +rich.longitude;
      coordSource = "park_list";
    } else if (cen?.c && cen.c.length >= 2) {
      lat = cen.c[0];
      lon = cen.c[1];
      coordSource = "centroid";
    } else {
      continue;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    units.push({
      id: "nps-" + code,
      parkCode: code,
      name: rich?.fullName || row.UNIT_NAME || row.PARKNAME || code.toUpperCase(),
      designation,
      category: npsCategory(designation),
      lat,
      lon,
      visitorCenter,
      coordSource,
      state: states.join(","),
      url: rich?.url || "https://www.nps.gov/" + code + "/",
      jr: rich?.activities && /junior ranger/i.test(rich.activities) ? "yes" : "unknown",
      activities: (rich?.activities || "").slice(0, 200),
    });
    seen.add(code);
  }
  units.sort((a, b) => a.name.localeCompare(b.name));
  const cats = {};
  units.forEach((u) => { cats[u.category] = (cats[u.category] || 0) + 1; });
  const vcCount = units.filter((u) => u.coordSource === "visitor_center").length;
  const geo = {
    generated: new Date().toISOString(),
    source: "arcgis+visitorcenters+park-list+centroids",
    count: units.length,
    visitorCenterCount: vcCount,
    categories: cats,
    units,
  };
  fs.writeFileSync(geoPath, JSON.stringify(geo, null, 2), "utf8");
  fs.writeFileSync(embedPath, "/* Auto-generated */\nvar NPS_US=" + JSON.stringify(units) + ";\n", "utf8");
  fs.writeFileSync(metaPath, JSON.stringify({ generated: geo.generated, count: units.length, categories: cats }, null, 2) + "\n", "utf8");
  console.log("NPS cache:", units.length, cats);
  return units.length;
}
