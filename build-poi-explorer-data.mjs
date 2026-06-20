/**
 * Build dev-only map explorer bundles (poi-explorer.html).
 * Does NOT modify scenic-router ingest artifacts — reads masters/embeds and writes poi-explorer-data/.
 *
 * Usage: node build-poi-explorer-data.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { readJson, masterPath, POI_KINDS } from "./poi-osm-lib.mjs";
import { MASTER_PATH as FUEL_US_MASTER } from "./fuel-us-lib.mjs";
import { MASTER_PATH as FUEL_CA_MASTER } from "./fuel-ca-lib.mjs";
import { MASTER_PATH as NPS_VC_MASTER } from "./nps-visitor-centers-lib.mjs";
import { MASTER_US_PATH as STATE_PARKS_US_MASTER, MASTER_CA_PATH as STATE_PARKS_CA_MASTER } from "./state-parks-lib.mjs";
import { brandGroupLabel, brandIdToSelectId, buildBrandGroups, normalizeFuelType } from "./fuel-brand-lib.mjs";

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(TOOLS, "poi-explorer-data");
const BENCHMARK_PATH = path.join(TOOLS, "scenic-road-access-benchmark.json");
const NPS_PATH = path.join(TOOLS, "nps-us-geo.json");
const FUEL_CATALOG_PATHS = {
  us: path.join(TOOLS, "fuel-us-brand-catalog.json"),
  ca: path.join(TOOLS, "fuel-ca-brand-catalog.json"),
};

function round5(n) {
  return Math.round(n * 1e5) / 1e5;
}

function writeSlice(name, records) {
  const file = path.join(OUT_DIR, `${name}.js`);
  const json = JSON.stringify(records);
  fs.writeFileSync(
    file,
    `/* Auto-generated — node build-poi-explorer-data.mjs */\nwindow.POI_EXPLORER_SLICES=window.POI_EXPLORER_SLICES||{};\nwindow.POI_EXPLORER_SLICES[${JSON.stringify(name)}]=${json};\n`,
    "utf8"
  );
  return { slice: `poi-explorer-data/${name}.js`, count: records.length, bytes: Buffer.byteLength(json) };
}

function scenicRow(r, status) {
  const f = r.roadAccessFeatures || {};
  return {
    id: r.id,
    name: r.name,
    lat: round5(r.lat),
    lon: round5(r.lon),
    state: r.state || "",
    url: r.url || "",
    status,
    roadDistanceM: r.roadDistanceM ?? null,
    dLean: f.dLean ?? null,
    dPath: f.dPath ?? null,
    dParking: f.dParking ?? null,
    displayTier: r.displayTier || "",
  };
}

function loadScenic(region) {
  const master = readJson(masterPath(region, "viewpoint"), { records: [] });
  const kept = (master.records || []).map((r) => scenicRow(r, "kept"));

  const ingestDir = path.join(TOOLS, `scenic-${region}-ingest`, "01-osm");
  const unfiltered = readJson(path.join(ingestDir, "merged-unfiltered.json"));
  const keptIds = new Set(kept.map((r) => r.id));
  let excluded = [];
  if (unfiltered?.records?.length) {
    excluded = unfiltered.records
      .filter((r) => !keptIds.has(r.id))
      .map((r) => scenicRow(r, "excluded"));
  } else {
    const report = readJson(path.join(ingestDir, "road-access-report.json"));
    if (report?.excludedSample?.length) {
      excluded = report.excludedSample.map((r) => ({
        id: r.id,
        name: r.name,
        lat: round5(r.lat),
        lon: round5(r.lon),
        state: r.state || "",
        url: "",
        status: "excluded",
        roadDistanceM: r.roadDistanceM ?? null,
        dLean: r.roadAccessFeatures?.dLean ?? null,
        dPath: r.roadAccessFeatures?.dPath ?? null,
        dParking: r.roadAccessFeatures?.dParking ?? null,
        displayTier: "",
        sampleOnly: true,
      }));
    }
  }
  return { kept, excluded, generated: master.generated };
}

function loadPoiMaster(region, kind) {
  const master = readJson(masterPath(region, kind), { records: [] });
  return (master.records || []).map((r) => {
    const row = {
      id: r.id,
      name: r.name,
      lat: round5(r.lat),
      lon: round5(r.lon),
      state: r.state || "",
      url: r.url || "",
    };
    if (r.subtype) row.subtype = r.subtype;
    if (r.parkName) row.parkName = r.parkName;
    if (r.displayTier) row.displayTier = r.displayTier;
    return row;
  });
}

function loadCampingMaster(region) {
  const p = path.join(TOOLS, `camping-${region}-master.json`);
  const master = readJson(p, { records: [] });
  return (master.records || []).map((r) => ({
    id: r.id,
    name: r.name,
    lat: round5(r.lat),
    lon: round5(r.lon),
    state: r.state || "",
    url: r.urls?.detail || "",
    landManager: r.landManager || "",
    displayTier: r.displayTier || "",
    excludeReason: r.excludeReason || "",
    roadDistanceM: r.roadDistanceM ?? null,
    cost: r.cost || "",
  }));
}

function loadFuelBySelectId() {
  const bySelect = {};
  for (const [region, masterPath] of [
    ["us", FUEL_US_MASTER],
    ["ca", FUEL_CA_MASTER],
  ]) {
    const master = readJson(masterPath, { records: [] });
    for (const r of master.records || []) {
      const selectId = brandIdToSelectId(r.brandId);
      if (!bySelect[selectId]) bySelect[selectId] = [];
      bySelect[selectId].push({
        id: r.id,
        name: r.name,
        lat: round5(r.lat),
        lon: round5(r.lon),
        state: r.state || "",
        brand: r.brand || "",
        brandId: r.brandId,
        brandSelectId: selectId,
        fuelType: normalizeFuelType(r.type),
        region,
        diesel: !!r.fuels?.diesel,
        url: r.url || "",
        highway: r.highway || "",
      });
    }
  }
  return bySelect;
}

function loadFuelGeneric(region) {
  const p = path.join(TOOLS, `fuel-generic-${region}-master.json`);
  if (fs.existsSync(p)) {
    const master = readJson(p, { records: [] });
    return (master.records || []).map((r) => ({
      id: r.id,
      name: r.name,
      lat: round5(r.lat),
      lon: round5(r.lon),
      state: r.state || "",
      url: r.url || "",
    }));
  }
  const embedPath = path.join(TOOLS, `fuel-generic-${region}-explorer-embed.js`);
  if (!fs.existsSync(embedPath)) return [];
  const text = fs.readFileSync(embedPath, "utf8");
  const m = text.match(/var FUEL_GENERIC_[A-Z]+=(\{[\s\S]+\});/);
  if (!m) return [];
  const payload = JSON.parse(m[1]);
  return (payload.records || []).map((r) => ({
    id: r.id,
    name: r.name,
    lat: round5(r.lat),
    lon: round5(r.lon),
    state: r.state || "",
    url: r.url || "",
  }));
}

function loadBenchmark() {
  const b = readJson(BENCHMARK_PATH, { cases: [] });
  return (b.cases || []).map((c) => ({
    id: c.id,
    name: c.name,
    lat: round5(c.lat),
    lon: round5(c.lon),
    region: c.region,
    tier: c.tier,
    category: c.category || "",
    expect: c.expectFilter120,
    osmNodeId: c.osmNodeId || null,
    notes: c.notes || "",
  }));
}

function loadNpsVisitorCenters() {
  const master = readJson(NPS_VC_MASTER, { records: [] });
  return (master.records || []).map((r) => {
    const pu = r.parentUnit || {};
    return {
      id: r.id,
      name: r.name,
      lat: round5(r.lat),
      lon: round5(r.lon),
      state: r.state || "",
      parkCode: r.parkCode || pu.parkCode || "",
      parentName: pu.name || "",
      parentCategory: pu.category || "",
      parentDesignation: pu.designation || "",
      hoursSummary: r.hoursSummary || { hasHours: false, summary: "", seasonalNote: "" },
      seasonal: r.seasonal || { isSeasonal: null, description: "" },
      url: r.urls?.detail || r.urls?.visitorCenters || r.urls?.park || "",
      coordConfidence: r.coordConfidence || "",
      needsReview: !!r.needsReview,
    };
  });
}

function loadStateParks(region) {
  const masterPath = region === "us" ? STATE_PARKS_US_MASTER : STATE_PARKS_CA_MASTER;
  const master = readJson(masterPath, { records: [] });
  return (master.records || []).map((r) => ({
    id: r.id,
    name: r.name,
    lat: round5(r.lat),
    lon: round5(r.lon),
    state: r.state || "",
    designation: r.designation || "",
    category: r.category || "",
    url: r.url || "",
    needsReview: !!r.needsReview,
  }));
}

function loadNpsByCategory() {
  const nps = readJson(NPS_PATH, { units: [] });
  const byCat = {};
  for (const u of nps.units || []) {
    const cat = u.category || "other";
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat].push({
      id: u.id,
      name: u.name,
      lat: round5(u.lat),
      lon: round5(u.lon),
      state: u.state || "",
      category: cat,
      parkCode: u.parkCode || "",
      url: u.url || "",
    });
  }
  return byCat;
}

const NPS_LABELS = {
  park: "National parks",
  monument: "National monuments",
  historic_park: "National historic parks",
  historic_site: "National historic sites",
  recreation: "National recreation areas",
  memorial: "National memorials",
  preserve: "National preserves",
  parkway_trail: "Parkways & trails",
  affiliated: "Affiliated areas",
  other: "Other",
};

fs.mkdirSync(OUT_DIR, { recursive: true });

const SLICE_THRESHOLD = 8000;
const layers = {};

function addLayer(id, label, group, region, records, opts = {}) {
  const key = region ? `${id}_${region}` : id;
  if (records.length > SLICE_THRESHOLD) {
    layers[key] = { id, label, group, region, ...writeSlice(key, records), large: true, ...opts };
  } else {
    layers[key] = { id, label, group, region, inline: records, count: records.length, ...opts };
  }
}

for (const region of ["us", "ca"]) {
  const scenic = loadScenic(region);
  addLayer("scenic_kept", "Kept (road-filtered)", "scenic", region, scenic.kept, {
    defaultInCategory: true,
    generated: scenic.generated,
  });
  if (scenic.excluded.length) {
    addLayer("scenic_excluded", "Excluded (no road access)", "scenic", region, scenic.excluded, {
      defaultInCategory: false,
    });
  }
}

addLayer("benchmark", "All benchmark cases", "benchmark", null, loadBenchmark(), {
  defaultInCategory: true,
  noRegion: true,
});

const npsByCat = loadNpsByCategory();
for (const cat of Object.keys(npsByCat).sort()) {
  addLayer(`nps_${cat}`, NPS_LABELS[cat] || cat, "nps", "us", npsByCat[cat], {
    defaultInCategory: true,
    noRegionFilter: true,
    npsCategory: cat,
  });
}

const npsVc = loadNpsVisitorCenters();
if (npsVc.length) {
  addLayer("nps_visitor_centers", "Visitor centers", "nps", "us", npsVc, {
    defaultInCategory: true,
    noRegionFilter: true,
    npsCategory: "visitor_center",
  });
}

const fuelBrandGroups = buildBrandGroups(readJson(FUEL_CATALOG_PATHS.us), readJson(FUEL_CATALOG_PATHS.ca));
const fuelBySelectId = loadFuelBySelectId();
for (const group of fuelBrandGroups) {
  const records = fuelBySelectId[group.id] || [];
  if (!records.length) continue;
  addLayer(`fuel_${group.id}`, brandGroupLabel(group), "fuel", null, records, {
    defaultInCategory: true,
    fuelBrandId: group.id,
    fuelType: group.type,
    noRegion: true,
  });
}
for (const region of ["us", "ca"]) {
  addLayer("fuel_generic", "Generic (non-catalog)", "fuel", region, loadFuelGeneric(region), { defaultInCategory: false });
  addLayer("camping", "Campgrounds (master + tiers)", "camping", region, loadCampingMaster(region), { defaultInCategory: true });
}

for (const region of ["us", "ca"]) {
  const sp = loadStateParks(region);
  if (sp.length) {
    addLayer("state_parks", "State / provincial parks", "state_parks", region, sp, {
      defaultInCategory: true,
    });
  }
}

for (const kind of ["playground", "historic"]) {
  const label = kind === "playground" ? "Playgrounds" : "Historic";
  for (const region of ["us", "ca"]) {
    addLayer(kind, label, kind, region, loadPoiMaster(region, kind), { defaultInCategory: true });
  }
}

const manifest = {
  generated: new Date().toISOString(),
  ingestDoc: "SCENIC-ROUTER-INGEST.md",
  sliceThreshold: SLICE_THRESHOLD,
  defaultCategory: "scenic",
  layers,
  poiKinds: Object.keys(POI_KINDS),
};

const manifestPath = path.join(TOOLS, "poi-explorer-data.js");
fs.writeFileSync(
  manifestPath,
  `/* Auto-generated — node build-poi-explorer-data.mjs */\nvar POI_EXPLORER=${JSON.stringify(manifest)};\n`,
  "utf8"
);

let totalRecords = 0;
for (const L of Object.values(layers)) totalRecords += L.count || 0;
console.log(`Wrote ${manifestPath} (${Object.keys(layers).length} layer keys, ${totalRecords.toLocaleString()} total records)`);
console.log(`Slices in ${OUT_DIR}/`);
console.log("Open poi-explorer.html in a browser");
