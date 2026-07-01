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
import { MASTER_PATH as PC_VC_MASTER } from "./parks-canada-visitor-centers-lib.mjs";
import { GEO_PATH as PC_GEO_PATH } from "./parks-canada-lib.mjs";
import { MASTER_US_PATH as STATE_PARKS_US_MASTER, MASTER_CA_PATH as STATE_PARKS_CA_MASTER, stateParkDisplayName } from "./state-parks-lib.mjs";
import { loadUsMasterRecords } from "./park-amenities-us-lib.mjs";
import { MASTER_PATH as PARK_AMENITIES_CA_MASTER } from "./park-amenities-ca-lib.mjs";
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

function loadParkAmenities(masterSource, filter = () => true) {
  const master =
    typeof masterSource === "string" ? readJson(masterSource, { records: [] }) : masterSource || { records: [] };
  return (master.records || []).filter(filter).map((r) => {
    const pu = r.parentUnit || {};
    const row = {
      id: r.id,
      name: r.name,
      lat: round5(r.lat),
      lon: round5(r.lon),
      state: r.state || "",
      country: r.country || "",
      kind: r.kind,
      subtype: r.subtype || "",
      parkCode: r.parkCode || pu.parkCode || "",
      parentName: pu.name || "",
      parentCategory: pu.category || "",
      parentDesignation: pu.designation || "",
      landManager: r.landManager || "NPS",
      ingestSource: r.ingestSource || "",
      url: r.urls?.detail || r.urls?.park || r.urls?.osm || "",
      coordConfidence: r.coordConfidence || "",
      needsReview: !!r.needsReview,
    };
    if (r.kind === "campground") {
      row.campTier = r.campTier || "developed";
      row.accessMode = r.accessMode || "unknown";
      row.accessConfidence = r.accessConfidence || "";
      if (r.roadDistanceM != null) row.roadDistanceM = r.roadDistanceM;
      if (r.trailDistanceM != null) row.trailDistanceM = r.trailDistanceM;
    }
    return row;
  });
}

function addParkAmenityLayers(region, masterSource) {
  const prefix = region === "ca" ? "amenities_ca" : "amenities";
  const group = "amenities";
  const developed = loadParkAmenities(masterSource, (r) => r.kind === "campground" && r.campTier === "developed");
  const backcountry = loadParkAmenities(masterSource, (r) => r.kind === "campground" && r.campTier === "backcountry");
  const primitive = loadParkAmenities(masterSource, (r) => r.kind === "campground" && r.campTier === "primitive");
  const picnic = loadParkAmenities(masterSource, (r) => r.kind === "picnic_area");
  const restroom = loadParkAmenities(masterSource, (r) => r.kind === "restroom");
  const roadCamp = loadParkAmenities(masterSource, (r) => r.kind === "campground" && r.accessMode === "road");
  const trailCamp = loadParkAmenities(masterSource, (r) => r.kind === "campground" && r.accessMode === "trail");
  if (!developed.length && !picnic.length && !restroom.length) return;

  const all = loadParkAmenities(masterSource, () => true);
  const srcPc = all.filter((r) => r.landManager === "Parks Canada");
  const srcProvArcgis = all.filter((r) => r.landManager === "Provincial" && r.ingestSource === "02-state-arcgis");
  const srcProvOsm = all.filter((r) => r.ingestSource?.includes("osm"));
  const srcNps = all.filter((r) => r.landManager === "NPS");
  const srcStateArcgis = all.filter((r) => r.landManager === "State" && r.ingestSource === "02-state-arcgis");
  const srcStateOsm = all.filter((r) => r.landManager === "State" && r.ingestSource === "03-state-osm");

  if (region === "ca") {
    if (srcPc.length) {
      addLayer(`${prefix}_src_pc`, "★ Parks Canada (all kinds)", group, region, srcPc, {
        defaultInCategory: true,
        validationLayer: true,
      });
    }
    if (srcProvArcgis.length) {
      addLayer(`${prefix}_src_prov_arcgis`, "★ Provincial — ArcGIS", group, region, srcProvArcgis, {
        defaultInCategory: true,
        validationLayer: true,
      });
    }
    if (srcProvOsm.length) {
      addLayer(`${prefix}_src_prov_osm`, "★ Provincial — OSM PBF", group, region, srcProvOsm, {
        defaultInCategory: true,
        validationLayer: true,
      });
    }
  } else {
    if (srcNps.length) {
      addLayer(`${prefix}_src_nps`, "★ NPS ArcGIS (all kinds)", group, region, srcNps, {
        defaultInCategory: true,
        validationLayer: true,
      });
    }
    if (srcStateArcgis.length) {
      addLayer(`${prefix}_src_state_arcgis`, "★ State parks — ArcGIS", group, region, srcStateArcgis, {
        defaultInCategory: true,
        validationLayer: true,
      });
    }
    if (srcStateOsm.length) {
      addLayer(`${prefix}_src_state_osm`, "★ State parks — OSM PBF", group, region, srcStateOsm, {
        defaultInCategory: true,
        validationLayer: true,
      });
    }
  }

  addLayer(`${prefix}_camp_developed`, "Campgrounds (developed)", group, region, developed, {
    defaultInCategory: true,
    amenityKind: "campground",
    campTier: "developed",
  });
  addLayer(`${prefix}_camp_backcountry`, "Campgrounds (backcountry)", group, region, backcountry, {
    defaultInCategory: true,
    amenityKind: "campground",
    campTier: "backcountry",
  });
  addLayer(`${prefix}_camp_primitive`, "Campgrounds (primitive)", group, region, primitive, {
    defaultInCategory: true,
    amenityKind: "campground",
    campTier: "primitive",
  });
  addLayer(`${prefix}_camp_road`, "Campgrounds (road access)", group, region, roadCamp, {
    defaultInCategory: true,
    amenityKind: "campground",
    accessMode: "road",
  });
  addLayer(`${prefix}_camp_trail`, "Campgrounds (trail access)", group, region, trailCamp, {
    defaultInCategory: true,
    amenityKind: "campground",
    accessMode: "trail",
  });
  addLayer(`${prefix}_picnic`, "Picnic areas", group, region, picnic, {
    defaultInCategory: true,
    amenityKind: "picnic_area",
  });
  addLayer(`${prefix}_restroom`, "Restrooms", group, region, restroom, {
    defaultInCategory: true,
    amenityKind: "restroom",
  });
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
  return (master.records || []).map((r) => {
    const displayName = r.displayName || stateParkDisplayName(r.name, r.designation, r.country);
    return {
      id: r.id,
      name: displayName,
      catalogName: r.name,
      displayName,
      lat: round5(r.lat),
      lon: round5(r.lon),
      state: r.state || "",
      country: r.country || (region === "ca" ? "CA" : "US"),
      designation: r.designation || "",
      category: r.category || "park",
      alsoHistoricSite: !!r.alsoHistoricSite,
      unitType: r.alsoHistoricSite
        ? "park_and_historic"
        : r.category === "historic_site"
          ? "historic_site"
          : "park",
      url: r.url || "",
      needsReview: !!r.needsReview,
    };
  });
}

function addStateParkLayers(region, records) {
  if (!records.length) return;
  const group = "state_parks";
  const parks = records.filter((r) => r.unitType !== "historic_site");
  const historic = records.filter((r) => r.unitType === "historic_site" || r.unitType === "park_and_historic");
  const parkLabel = region === "ca" ? "Provincial parks" : "State parks";
  const historicLabel = region === "ca" ? "Provincial historic sites" : "State historic sites";
  if (parks.length) {
    addLayer("state_park", parkLabel, group, region, parks, {
      defaultInCategory: true,
      stateParkUnitType: "park",
    });
  }
  if (historic.length) {
    addLayer("state_historic", historicLabel, group, region, historic, {
      defaultInCategory: true,
      stateParkUnitType: "historic_site",
    });
  }
}

function npsExplorerRows(units) {
  const rows = [];
  for (const u of units) {
    const pins = u.mapPins?.length ? u.mapPins : [{ id: u.id, label: "", lat: u.lat, lon: u.lon, role: "primary" }];
    for (const pin of pins) {
      const suffix = pin.label ? ` — ${pin.label}` : "";
      rows.push({
        id: pin.id || u.id,
        name: u.name + suffix,
        lat: round5(pin.lat),
        lon: round5(pin.lon),
        state: u.state || "",
        category: u.category || "other",
        parkCode: u.parkCode || "",
        pinLabel: pin.label || "",
        pinRole: pin.role || "",
        pinStrategy: u.pinStrategy || "",
        url: u.url || "",
      });
    }
  }
  return rows;
}

function loadNpsByCategory() {
  const nps = readJson(NPS_PATH, { units: [] });
  const byCat = {};
  for (const u of nps.units || []) {
    const cat = u.category || "other";
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat].push(...npsExplorerRows([u]));
  }
  return byCat;
}

function loadPcByCategory() {
  const pc = readJson(PC_GEO_PATH, { units: [] });
  const byCat = {};
  for (const u of pc.units || []) {
    const cat = u.category || "other";
    if (!byCat[cat]) byCat[cat] = [];
    const pins = u.mapPins?.length ? u.mapPins : [{ id: u.id, label: "", lat: u.lat, lon: u.lon, role: "primary" }];
    for (const pin of pins) {
      const suffix = pin.label ? ` — ${pin.label}` : "";
      byCat[cat].push({
        id: pin.id || u.id,
        name: u.name + suffix,
        lat: round5(pin.lat),
        lon: round5(pin.lon),
        state: u.state || "",
        category: cat,
        parkCode: u.parkCode || "",
        designation: u.designation || "",
        pinLabel: pin.label || "",
        pinRole: pin.role || "",
        url: u.url || "",
      });
    }
  }
  return byCat;
}

function loadPcVisitorCenters() {
  const master = readJson(PC_VC_MASTER, { records: [] });
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
      url: r.urls?.detail || r.urls?.park || "",
      coordConfidence: r.coordConfidence || "",
      needsReview: !!r.needsReview,
    };
  });
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

const PC_LABELS = {
  park: "National parks",
  historic_site: "National historic sites",
  marine: "Marine conservation areas",
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

addParkAmenityLayers("us", loadUsMasterRecords());
addParkAmenityLayers("ca", PARK_AMENITIES_CA_MASTER);

const pcByCat = loadPcByCategory();
for (const cat of Object.keys(pcByCat).sort()) {
  addLayer(`pc_${cat}`, PC_LABELS[cat] || cat, "pc", "ca", pcByCat[cat], {
    defaultInCategory: true,
    pcCategory: cat,
  });
}

const pcVc = loadPcVisitorCenters();
if (pcVc.length) {
  addLayer("pc_visitor_centers", "Visitor centres", "pc", "ca", pcVc, {
    defaultInCategory: true,
    pcCategory: "visitor_center",
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
  addStateParkLayers(region, loadStateParks(region));
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
