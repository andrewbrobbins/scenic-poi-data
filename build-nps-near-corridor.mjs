/**
 * Fetch NPS units (Overpass), filter to within 100 mi of route corridors.
 * Usage: node tools/build-nps-near-corridor.mjs
 * Env: TRIP_TOOLS_DIR = output folder (default: same dir as script)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.env.TRIP_TOOLS_DIR || __dirname;

const ROUTES = {
  SW: [
    [32.3513, -95.3011], [35.222, -101.8313], [35.0844, -106.6504], [38.5733, -109.5498],
    [41.223, -111.9738], [43.615, -116.2023], [47.6062, -122.3321], [49.2827, -123.1207],
  ],
  CO: [
    [32.3513, -95.3011], [35.222, -101.8313], [36.9025, -104.439], [38.5458, -106.9253],
    [41.223, -111.9738], [43.615, -116.2023], [47.6062, -122.3321], [49.2827, -123.1207],
  ],
  SWY: [
    [32.3513, -95.3011], [35.222, -101.8313], [39.7392, -104.9903], [41.3114, -105.5911],
    [41.223, -111.9738], [43.615, -116.2023], [47.6062, -122.3321], [49.2827, -123.1207],
  ],
  MT: [
    [32.3513, -95.3011], [35.222, -101.8313], [39.7392, -104.9903], [44.7972, -106.9562],
    [46.8721, -114.0089], [47.6588, -117.426], [47.6062, -122.3321], [49.2827, -123.1207],
  ], [35.222, -101.8313], [39.7392, -104.9903], [44.7972, -106.9562],
    [46.8721, -114.0089], [43.615, -116.2023], [47.6588, -117.426], [47.6062, -122.3321],
    [49.2827, -123.1207],
  ],
};

const MILES = 100;
const MI_TO_KM = 1.60934;
const RADIUS_KM = MILES * MI_TO_KM;
const BBOX = { south: 31.5, west: -125.5, north: 50.5, east: -89.5 };

const OVERPASS = `
[out:json][timeout:180];
(
  nwr["boundary"="national_park"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  nwr["boundary"="protected_area"]["operator"="National Park Service"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  nwr["historic"="monument"]["protect_class"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
  nwr["leisure"="nature_reserve"]["operator"="National Park Service"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});
);
out center tags;
`;

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function densifyPath(path, stepKm = 20) {
  const pts = [];
  for (let i = 0; i < path.length - 1; i++) {
    const [lat1, lon1] = path[i];
    const [lat2, lon2] = path[i + 1];
    pts.push([lat1, lon1]);
    const segKm = haversineKm(lat1, lon1, lat2, lon2);
    const n = Math.max(1, Math.ceil(segKm / stepKm));
    for (let j = 1; j < n; j++) {
      const t = j / n;
      pts.push([lat1 + t * (lat2 - lat1), lon1 + t * (lon2 - lon1)]);
    }
  }
  pts.push(path[path.length - 1]);
  return pts;
}

const routeSamples = Object.fromEntries(
  Object.entries(ROUTES).map(([id, path]) => [id, densifyPath(path)])
);

function minDistKmToRoutes(lat, lon) {
  let min = Infinity;
  const nearRoutes = [];
  for (const [rid, samples] of Object.entries(routeSamples)) {
    let dMin = Infinity;
    for (const [rlat, rlon] of samples) {
      dMin = Math.min(dMin, haversineKm(lat, lon, rlat, rlon));
    }
    if (dMin <= RADIUS_KM) nearRoutes.push(rid);
    min = Math.min(min, dMin);
  }
  return { minKm: min, routes: nearRoutes.sort() };
}

function designation(tags) {
  return tags.protect_class || tags.boundary || tags.historic || tags.leisure || "NPS unit";
}

async function fetchOverpass() {
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "application/json",
      "User-Agent": "VancouverTripRouteExplorer/1.0",
    },
    body: "data=" + encodeURIComponent(OVERPASS.trim()),
  });
  if (!res.ok) throw new Error("Overpass HTTP " + res.status);
  return (await res.json()).elements || [];
}

async function fetchNpsApi(apiKey) {
  const out = [];
  let start = 0;
  const limit = 50;
  for (;;) {
    const url = `https://developer.nps.gov/api/v1/parks?limit=${limit}&start=${start}&fields=parkCode,fullName,latitude,longitude,states,designation`;
    const res = await fetch(url, { headers: { "X-Api-Key": apiKey } });
    if (!res.ok) throw new Error("NPS API " + res.status);
    const rows = (await res.json()).data || [];
    for (const p of rows) {
      const lat = parseFloat(p.latitude);
      const lon = parseFloat(p.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (lat < BBOX.south || lat > BBOX.north || lon < BBOX.west || lon > BBOX.east) continue;
      out.push({
        id: p.parkCode,
        name: p.fullName,
        lat,
        lon,
        state: (p.states || "").split(",")[0]?.trim() || "",
        designation: p.designation || "Park",
        url: `https://www.nps.gov/${p.parkCode}/index.htm`,
      });
    }
    if (rows.length < limit) break;
    start += limit;
    await new Promise((r) => setTimeout(r, 350));
  }
  return out;
}

function mergeUnits(list) {
  const byKey = new Map();
  for (const u of list) {
    const key = u.id || `${u.name}|${u.lat.toFixed(3)}|${u.lon.toFixed(3)}`;
    if (!byKey.has(key)) byKey.set(key, u);
  }
  return [...byKey.values()];
}

async function main() {
  console.log("Fetching NPS units from Overpass...");
  const elements = await fetchOverpass();
  console.log("Overpass elements:", elements.length);

  const fromOsm = [];
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    const name = el.tags?.name;
    if (!name || lat == null || lon == null) continue;
    const states = el.tags["addr:state"] || el.tags["is_in:state_code"] || "";
    fromOsm.push({
      id: `osm-${el.id}`,
      name,
      lat,
      lon,
      state: String(states).slice(0, 2).toUpperCase(),
      designation: designation(el.tags || {}),
      url: el.tags?.website || "",
    });
  }

  let fromApi = [];
  if (process.env.NPS_API_KEY) {
    console.log("Fetching NPS Developer API...");
    try {
      fromApi = await fetchNpsApi(process.env.NPS_API_KEY);
      console.log("NPS API units in bbox:", fromApi.length);
    } catch (e) {
      console.warn("NPS API skipped:", e.message);
    }
  }

  const filtered = [];
  for (const u of mergeUnits([...fromOsm, ...fromApi])) {
    const { minKm, routes } = minDistKmToRoutes(u.lat, u.lon);
    if (minKm <= RADIUS_KM && routes.length) {
      filtered.push({
        ...u,
        cat: "nps",
        pri: "H",
        nps: 1,
        routes,
        distMi: Math.round(minKm / MI_TO_KM),
      });
    }
  }
  filtered.sort((a, b) => a.distMi - b.distMi || a.name.localeCompare(b.name));
  console.log("Within", MILES, "mi:", filtered.length);

  const jsArray = filtered.map((u) => ({
    id: u.id,
    name: u.name,
    lat: +u.lat.toFixed(4),
    lon: +u.lon.toFixed(4),
    state: u.state,
    cat: "nps",
    pri: "H",
    routes: u.routes,
    nps: 1,
    distMi: u.distMi,
    designation: u.designation,
    url: u.url || undefined,
  }));

  const jsonPath = path.join(OUT_DIR, "nps-near-corridor.json");
  fs.writeFileSync(
    jsonPath,
    JSON.stringify({ generated: new Date().toISOString(), miles: MILES, units: filtered }, null, 2),
    "utf8"
  );
  console.log("Wrote", jsonPath);

  const htmlPath = path.join(OUT_DIR, "route-explorer.html");
  let html = fs.readFileSync(htmlPath, "utf8");
  if (html.charCodeAt(0) === 0xfeff) html = html.slice(1);
  const marker = "var NPS_NEAR = ";
  const endMarker = ";\n\n    var OSRM";
  const start = html.indexOf(marker);
  const end = html.indexOf(endMarker);
  const block =
    "var NPS_NEAR = " +
    JSON.stringify(jsArray, null, 2).replace(/\n/g, "\n    ") +
    ";\n\n    var OSRM";

  if (start >= 0 && end > start) {
    fs.writeFileSync(htmlPath, html.slice(0, start) + block + html.slice(end + endMarker.length), "utf8");
    console.log("Updated route-explorer.html");
  } else {
    fs.writeFileSync(path.join(OUT_DIR, "nps-near-embed.js"), "var NPS_NEAR = " + JSON.stringify(jsArray) + ";\n", "utf8");
    console.log("Wrote nps-near-embed.js (patch HTML manually)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
