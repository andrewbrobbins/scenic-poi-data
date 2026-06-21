import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  buildPinCatalog,
  loadBoundaryIndex,
  loadPinOverrides,
} from "./park-boundary-pins.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const US = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY VI PR GU AS MP".split(" "));

const ARCGIS_UNITS_URL =
  "https://services.northeastoceandata.org/arcgis1/rest/services/RecreationAndCulture/MapServer/28/query";

/** Prefer National Park / Monument rows when ArcGIS returns multiple UNIT_CODE rows. */
const UNIT_TYPE_RANK = {
  "National Park": 100,
  "National Park and Preserve": 95,
  "National Monument": 90,
  "National Historical Park": 80,
  "National Historic Park": 80,
  "National Memorial": 70,
  "National Recreation Area": 60,
  "National Seashore": 60,
  "National Lakeshore": 60,
  "National Preserve": 50,
  Park: 10,
};

function unitTypeRank(unitType) {
  return UNIT_TYPE_RANK[unitType] || 40;
}

function dedupeArcgisUnits(rows) {
  const byCode = new Map();
  for (const row of rows) {
    const code = (row.UNIT_CODE || "").toLowerCase();
    if (!code) continue;
    const prev = byCode.get(code);
    if (!prev || unitTypeRank(row.UNIT_TYPE) > unitTypeRank(prev.UNIT_TYPE)) {
      byCode.set(code, row);
    }
  }
  return [...byCode.values()];
}

/** ArcGIS sometimes uses a separate preserve code (e.g. CRMP) for the same PARKNAME as the monument (CRMO). */
function isSubsidiaryPreserveUnit(row, allRows) {
  const code = (row.UNIT_CODE || "").toLowerCase();
  const park = (row.PARKNAME || "").trim();
  if (!code || !park || row.UNIT_TYPE !== "National Preserve") return false;
  return allRows.some(
    (other) =>
      (other.PARKNAME || "").trim() === park &&
      (other.UNIT_CODE || "").toLowerCase() !== code &&
      unitTypeRank(other.UNIT_TYPE) > unitTypeRank(row.UNIT_TYPE)
  );
}

function centroidFromGeometry(geom) {
  if (!geom) return null;
  if (geom.x != null && geom.y != null) {
    return { lat: geom.y, lon: geom.x };
  }
  const ring = geom.rings?.[0];
  if (!ring?.length) return null;
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const [lon, lat] of ring) {
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lon < west) west = lon;
    if (lon > east) east = lon;
  }
  if (!Number.isFinite(south)) return null;
  return { lat: (south + north) / 2, lon: (west + east) / 2 };
}

async function fetchArcgisGeometryMap(codes) {
  if (!codes.length) return {};
  const out = {};
  const batch = 20;
  for (let i = 0; i < codes.length; i += batch) {
    const chunk = codes.slice(i, i + batch);
    const where = `UNIT_CODE IN ('${chunk.map((c) => c.toUpperCase()).join("','")}')`;
    const url =
      ARCGIS_UNITS_URL +
      "?where=" +
      encodeURIComponent(where) +
      "&outFields=UNIT_CODE,UNIT_TYPE&returnGeometry=true&outSR=4326&f=json";
    const j = await (await fetch(url)).json();
    if (!j.features) {
      console.warn("ArcGIS geometry batch failed:", j.error || "no features");
      continue;
    }
    for (const f of j.features) {
      const code = (f.attributes?.UNIT_CODE || "").toLowerCase();
      const c = centroidFromGeometry(f.geometry);
      if (!code || !c) continue;
      const rank = unitTypeRank(f.attributes?.UNIT_TYPE);
      const prev = out[code];
      if (!prev || rank > prev.rank) out[code] = { lat: c.lat, lon: c.lon, rank };
    }
  }
  return out;
}

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
  if (d === "park") return "other";
  if (d.includes("national park")) return "park";
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
  const url = ARCGIS_UNITS_URL + "?where=1%3D1&outFields=UNIT_CODE,UNIT_NAME,UNIT_TYPE,STATE,PARKNAME&returnGeometry=false&f=json";
  const j = await (await fetch(url)).json();
  if (!j.features) throw new Error("ArcGIS query failed: " + JSON.stringify(j.error));
  return j.features.map((f) => f.attributes);
}

/** Park-list units missing from ArcGIS (e.g. KLSE) — skip linear trails and affiliated areas. */
const SUPPLEMENTAL_SKIP_DESIGNATION =
  /national historic trail|national scenic trail|national geologic trail|affiliated area/i;

function parseParkListStates(statesStr) {
  return (statesStr || "")
    .split(/[,;]/)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => US.has(s));
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

function loadVisitorCenterMasterCounts(toolsDir) {
  const masterPath = path.join(toolsDir, "nps-visitor-centers-us-master.json");
  if (!fs.existsSync(masterPath)) return { byPark: {}, primaryByPark: {}, listByPark: {}, total: 0 };
  const master = JSON.parse(fs.readFileSync(masterPath, "utf8"));
  const byPark = {};
  const primaryByPark = {};
  const listByPark = {};
  for (const r of master.records || []) {
    const code = (r.parkCode || "").toLowerCase();
    if (!code) continue;
    byPark[code] = (byPark[code] || 0) + 1;
    if (!listByPark[code]) listByPark[code] = [];
    listByPark[code].push({ name: r.name, lat: r.lat, lon: r.lon });
    if (!primaryByPark[code] && Number.isFinite(r.lat) && Number.isFinite(r.lon)) {
      primaryByPark[code] = { name: r.name || "Visitor Center", lat: r.lat, lon: r.lon };
    }
  }
  return { byPark, primaryByPark, listByPark, total: (master.records || []).length };
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
  const vcMaster = loadVisitorCenterMasterCounts(tools);
  const boundaryIndex = loadBoundaryIndex();
  const pinOverrides = loadPinOverrides();
  const pinCatalog = buildPinCatalog({
    country: "US",
    boundaryIndex,
    overrides: pinOverrides,
    visitorCentersByPark: vcMaster.listByPark,
  });
  const pinsPath = path.join(tools, "nps-us-park-pins.json");
  const multiPinParks = Object.values(pinCatalog).filter((p) => p.pinCount > 1);
  fs.writeFileSync(
    pinsPath,
    JSON.stringify(
      {
        generated: new Date().toISOString(),
        source: "park-boundaries.geojson+overrides",
        parkCount: Object.keys(pinCatalog).length,
        multiPinCount: multiPinParks.length,
        parks: pinCatalog,
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  console.log("Park map pins:", Object.keys(pinCatalog).length, "| multi-pin:", multiPinParks.length);

  const arcgisRows = dedupeArcgisUnits(arcgis);
  const pendingGeometry = [];
  const units = [];
  const seen = new Set();

  for (const row of arcgisRows) {
    const code = (row.UNIT_CODE || "").toLowerCase();
    if (!code || seen.has(code)) continue;
    if (isSubsidiaryPreserveUnit(row, arcgis)) continue;
    const states = (row.STATE || "").split(/[,;]/).map((s) => s.trim().toUpperCase()).filter((s) => US.has(s));
    if (!states.length) continue;
    const designation = row.UNIT_TYPE || "Park";
    const rich = richByCode[code];
    const cen = centroids[code];
    const vcCount = vcMaster.byPark[code] ?? 0;
    const vcFromMaster = vcMaster.primaryByPark[code];
    const vc = vcFromMaster || pickVisitorCenter(visitorByPark[code]);
    const pins = pinCatalog[code];
    let lat;
    let lon;
    let coordSource = "centroid";
    let visitorCenter = null;
    let mapPins = null;
    let pinStrategy = "fallback";

    if (pins?.primary) {
      lat = pins.primary.lat;
      lon = pins.primary.lon;
      coordSource = "boundary_centroid";
      pinStrategy = pins.strategy;
      mapPins = pins.pins;
    } else if (rich && Number.isFinite(+rich.latitude) && Number.isFinite(+rich.longitude)) {
      lat = +rich.latitude;
      lon = +rich.longitude;
      coordSource = "park_list";
    } else if (cen?.c && cen.c.length >= 2) {
      lat = cen.c[0];
      lon = cen.c[1];
      coordSource = "centroid";
    } else {
      pendingGeometry.push(code);
      continue;
    }

    if (vc) {
      visitorCenter = { name: vc.name, lat: vc.latitude ?? vc.lat, lon: vc.longitude ?? vc.lon };
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
      visitorCenterCount: vcCount,
      coordSource,
      pinStrategy,
      mapPins: mapPins || undefined,
      state: states.join(","),
      url: rich?.url || "https://www.nps.gov/" + code + "/",
      jr: rich?.activities && /junior ranger/i.test(rich.activities) ? "yes" : "unknown",
      activities: (rich?.activities || "").slice(0, 200),
    });
    seen.add(code);
  }

  if (pendingGeometry.length) {
    console.log("Fetching ArcGIS geometry for", pendingGeometry.length, "units without centroids...");
    const geomMap = await fetchArcgisGeometryMap(pendingGeometry);
    for (const row of arcgisRows) {
      const code = (row.UNIT_CODE || "").toLowerCase();
      if (!code || seen.has(code)) continue;
      if (isSubsidiaryPreserveUnit(row, arcgis)) continue;
      const geom = geomMap[code];
      if (!geom) continue;
      const states = (row.STATE || "").split(/[,;]/).map((s) => s.trim().toUpperCase()).filter((s) => US.has(s));
      if (!states.length) continue;
      const designation = row.UNIT_TYPE || "Park";
      const rich = richByCode[code];
      units.push({
        id: "nps-" + code,
        parkCode: code,
        name: rich?.fullName || row.UNIT_NAME || row.PARKNAME || code.toUpperCase(),
        designation,
        category: npsCategory(designation),
        lat: geom.lat,
        lon: geom.lon,
        visitorCenter: null,
        visitorCenterCount: vcMaster.byPark[code] ?? 0,
        coordSource: "arcgis_geometry",
        state: states.join(","),
        url: rich?.url || "https://www.nps.gov/" + code + "/",
        jr: rich?.activities && /junior ranger/i.test(rich.activities) ? "yes" : "unknown",
        activities: (rich?.activities || "").slice(0, 200),
      });
      seen.add(code);
    }
  }

  for (const rich of Object.values(richByCode)) {
    const code = (rich.parkCode || "").toLowerCase();
    if (!code || seen.has(code)) continue;
    if (SUPPLEMENTAL_SKIP_DESIGNATION.test(rich.designation || "") || SUPPLEMENTAL_SKIP_DESIGNATION.test(rich.fullName || "")) {
      continue;
    }
    const states = parseParkListStates(rich.states);
    if (!states.length) continue;
    const lat = +rich.latitude;
    const lon = +rich.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const designation = rich.designation || "Park";
    const vcFromMaster = vcMaster.primaryByPark[code];
    const vc = vcFromMaster || pickVisitorCenter(visitorByPark[code]);
    const pins = pinCatalog[code];
    units.push({
      id: "nps-" + code,
      parkCode: code,
      name: rich.fullName || code.toUpperCase(),
      designation,
      category: npsCategory(designation),
      lat: pins?.primary?.lat ?? lat,
      lon: pins?.primary?.lon ?? lon,
      visitorCenter: vc
        ? { name: vc.name, lat: vc.latitude ?? vc.lat, lon: vc.longitude ?? vc.lon }
        : null,
      visitorCenterCount: vcMaster.byPark[code] ?? 0,
      coordSource: pins?.primary ? "boundary_centroid" : "park_list",
      pinStrategy: pins?.strategy || "single",
      mapPins:
        pins?.pins ||
        [
          {
            id: `${code}-primary`,
            label: "",
            lat: Math.round(lat * 1e5) / 1e5,
            lon: Math.round(lon * 1e5) / 1e5,
            role: "primary",
            clusterIndex: 0,
            sectionCount: 0,
            sectionIndices: [],
            areaDeg2: 0,
            labelSource: "park_list",
          },
        ],
      state: states.join(","),
      url: rich.url || "https://www.nps.gov/" + code + "/",
      jr: rich.activities && /junior ranger/i.test(rich.activities) ? "yes" : "unknown",
      activities: (rich.activities || "").slice(0, 200),
    });
    seen.add(code);
  }

  units.sort((a, b) => a.name.localeCompare(b.name));
  const cats = {};
  units.forEach((u) => { cats[u.category] = (cats[u.category] || 0) + 1; });
  const vcCount = vcMaster.total || units.reduce((n, u) => n + (u.visitorCenterCount || 0), 0);
  const geo = {
    generated: new Date().toISOString(),
    source: "arcgis+boundary-pins+park-list+centroids+arcgis_geometry",
    pinPolicy: "boundary_centroid; multi_pin when sections >= 18 km apart (see nps-us-park-pins.json)",
    count: units.length,
    visitorCenterCount: vcCount,
    multiPinCount: units.filter((u) => u.pinStrategy === "multi_pin").length,
    categories: cats,
    units,
  };
  fs.writeFileSync(geoPath, JSON.stringify(geo, null, 2), "utf8");
  fs.writeFileSync(embedPath, "/* Auto-generated */\nvar NPS_US=" + JSON.stringify(units) + ";\n", "utf8");
  fs.writeFileSync(metaPath, JSON.stringify({ generated: geo.generated, count: units.length, categories: cats }, null, 2) + "\n", "utf8");
  console.log("NPS cache:", units.length, cats);
  return units.length;
}
