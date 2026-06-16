import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const tools = path.dirname(fileURLToPath(import.meta.url));

/** Legacy manual camping seeds (superseded by camping-us-explorer for the route editor). */
const campingSource = {
  note: "Manual USFS/BLM camping seeds for legacy stopping-points embed. Corridor city lists removed.",
  campingManual: [
    {
      id: "C-USFS-ashley",
      name: "Ashley National Forest (dispersed/developed)",
      state: "UT",
      lat: 40.9,
      lon: -109.8,
      landManager: "USFS",
      cost: "mixed",
      corridors: ["SW", "CO", "SWY", "MT"],
    },
    {
      id: "C-USFS-sawtooth",
      name: "Sawtooth National Forest",
      state: "ID",
      lat: 44.1,
      lon: -114.8,
      landManager: "USFS",
      cost: "mixed",
      corridors: ["SW", "CO", "SWY", "MT"],
    },
    {
      id: "C-BLM-utah",
      name: "Utah BLM dispersed (Moab/Vernal vicinity)",
      state: "UT",
      lat: 38.7,
      lon: -109.5,
      landManager: "BLM",
      cost: "free",
      corridors: ["SW", "CO"],
    },
  ],
};

function haversineMi(a, b) {
  const R = 3958.8;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function distPointToPathMi(pt, path) {
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    for (let t = 0; t <= 1; t += 0.05) {
      const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const d = haversineMi(pt, q);
      if (d < best) best = d;
    }
  }
  for (const p of path) best = Math.min(best, haversineMi(pt, p));
  return best;
}

const NPS_CAMPING_MAX_MI = 65;
const OTHER_CAMPING_MAX_MI = 50;

function npsCampingEligible(u) {
  const c = u.category;
  return c === "park" || c === "monument";
}

function npsCostGuess(u) {
  if (u.category === "recreation" || /recreation|lakeshore|seashore/i.test(u.designation || "")) return "fee";
  if (u.category === "preserve") return "mixed";
  return "fee";
}

const ROUTES_PATHS = {
  SW: [
    [32.3513, -95.3011],
    [35.222, -101.8313],
    [35.0844, -106.6504],
    [38.5733, -109.5498],
    [41.223, -111.9738],
    [43.615, -116.2023],
    [47.6062, -122.3321],
    [49.2827, -123.1207],
  ],
  CO: [
    [32.3513, -95.3011],
    [35.222, -101.8313],
    [36.9025, -104.439],
    [38.5458, -106.9253],
    [41.223, -111.9738],
    [43.615, -116.2023],
    [47.6062, -122.3321],
    [49.2827, -123.1207],
  ],
  SWY: [
    [32.3513, -95.3011],
    [35.222, -101.8313],
    [39.7392, -104.9903],
    [41.3114, -105.5911],
    [41.223, -111.9738],
    [43.615, -116.2023],
    [47.6062, -122.3321],
    [49.2827, -123.1207],
  ],
  MT: [
    [32.3513, -95.3011],
    [35.222, -101.8313],
    [39.7392, -104.9903],
    [44.7972, -106.9562],
    [46.8721, -114.0089],
    [47.6588, -117.426],
    [47.6062, -122.3321],
    [49.2827, -123.1207],
  ],
};

const stateParksSource = JSON.parse(
  fs.readFileSync(path.join(tools, "state-parks-camping-source.json"), "utf8")
);
const usfsSource = JSON.parse(fs.readFileSync(path.join(tools, "usfs-camping-source.json"), "utf8"));

function buildCache() {
  const ROUTES = Object.fromEntries(Object.keys(ROUTES_PATHS).map((k) => [k, { path: ROUTES_PATHS[k] }]));

  const npsGeo = JSON.parse(fs.readFileSync(path.join(tools, "nps-us-geo.json"), "utf8"));
  const out = { generated: new Date().toISOString(), routes: {} };

  for (const rid of Object.keys(ROUTES)) {
    const pathPts = ROUTES[rid].path;

    const campingNps = npsGeo.units
      .filter(npsCampingEligible)
      .map((u) => {
        const dist = distPointToPathMi([u.lat, u.lon], pathPts);
        return {
          id: "C-NPS-" + u.parkCode,
          name: u.name,
          state: u.state,
          lat: u.lat,
          lon: u.lon,
          landManager: "NPS",
          cost: npsCostGuess(u),
          category: u.category,
          parkCode: u.parkCode,
          url: u.url,
          distToRouteMi: Math.round(dist * 10) / 10,
          corridors: [rid],
          campingAssumed: true,
        };
      })
      .filter((c) => c.distToRouteMi <= NPS_CAMPING_MAX_MI);

    const usfsAll = [
      ...(usfsSource.forests || []),
      ...(usfsSource.campgrounds || []),
      ...(campingSource.campingManual || []),
    ];
    const campingUsfs = usfsAll
      .filter((c) => c.corridors.includes(rid))
      .map((c) => ({
        ...c,
        distToRouteMi: Math.round(distPointToPathMi([c.lat, c.lon], pathPts) * 10) / 10,
      }))
      .filter((c) => c.distToRouteMi <= OTHER_CAMPING_MAX_MI);

    const campingState = (stateParksSource.stateParks || [])
      .filter((c) => c.corridors.includes(rid))
      .map((c) => ({
        ...c,
        distToRouteMi: Math.round(distPointToPathMi([c.lat, c.lon], pathPts) * 10) / 10,
      }))
      .filter((c) => c.distToRouteMi <= OTHER_CAMPING_MAX_MI);

    const seen = new Set();
    const camping = [...campingUsfs, ...campingState, ...campingNps]
      .filter((c) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      })
      .sort((a, b) => a.distToRouteMi - b.distToRouteMi);
    const campingStateCount = camping.filter(
      (c) => c.landManager === "State" || c.landManager === "Provincial"
    ).length;
    const campingNpsCount = camping.filter((c) => c.landManager === "NPS").length;
    const campingUsfsCount = camping.filter(
      (c) => c.landManager === "USFS" || c.landManager === "BLM"
    ).length;
    out.routes[rid] = {
      camping,
      campingCount: camping.length,
      campingStateCount,
      campingNpsCount,
      campingUsfsCount,
    };
  }

  fs.writeFileSync(path.join(tools, "stopping-points-source.json"), JSON.stringify(campingSource, null, 2), "utf8");
  fs.writeFileSync(path.join(tools, "stopping-points-cache.json"), JSON.stringify(out, null, 2), "utf8");
  const flat = { camping: [] };
  for (const rid of Object.keys(out.routes)) {
    out.routes[rid].camping.forEach((c) => flat.camping.push({ ...c, route: rid }));
  }
  fs.writeFileSync(
    path.join(tools, "stopping-points-embed.js"),
    "/* Auto-generated — node tools/build-stopping-points-cache.mjs */\nvar STOPPING_POINTS=" +
      JSON.stringify(flat) +
      ";\n",
    "utf8"
  );
  console.log(
    "Stopping points cached per route:",
    Object.fromEntries(
      Object.keys(out.routes).map((k) => [
        k,
        out.routes[k].campingCount +
          " camp (nps:" +
          (out.routes[k].campingNpsCount || 0) +
          " usfs:" +
          (out.routes[k].campingUsfsCount || 0) +
          " state:" +
          (out.routes[k].campingStateCount || 0) +
          ")",
      ])
    )
  );
}

buildCache();
