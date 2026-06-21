import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fetchArcgisAllFeatures } from "./camping-ca-lib.mjs";
import { MIN_SECTION_AREA_DEG2, MIN_SECTION_AREA_RATIO } from "./park-boundary-pins.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));
const NPS_GEO_PATH = path.join(tools, "nps-us-geo.json");
const PC_GEO_PATH = path.join(tools, "parks-canada-geo.json");
const BOUNDARY_QA_PATH = path.join(tools, "park-boundaries-qa.json");

const US_QUERY =
  "https://services1.arcgis.com/fBc8EJBxQRMcHlei/ArcGIS/rest/services/National_Park_Service_Boundaries/FeatureServer/0/query";
const CA_QUERY =
  "https://services2.arcgis.com/wCOMu5IS7YdSyPNx/arcgis/rest/services/vw_Places_Public_lieux_public_APCA/FeatureServer/0/query";

/** Server-side generalization for fetch (~15 m); main ring keeps more detail client-side. */
const ARCGIS_OFFSET = 0.00015;
/** Points on the primary (largest) boundary ring. */
const MAX_PTS_MAIN_RING = 256;
/** Max extra disjoint sections per unit (after area filter). */
const MAX_SECONDARY_RINGS = 32;
/** Drop specks below this bbox-area (deg²). */
const MIN_RING_AREA_DEG2 = MIN_SECTION_AREA_DEG2;
/** Secondary section must be at least this share of the main ring bbox area. */
const MIN_SECONDARY_AREA_RATIO = MIN_SECTION_AREA_RATIO;

function ptsForSecondaryRing(area, mainArea) {
  const ratio = mainArea > 0 ? area / mainArea : 0;
  if (ratio >= 0.2) return 160;
  if (ratio >= 0.08) return 120;
  if (ratio >= 0.05) return 96;
  return 64;
}

/** In-scope for boundary backfill (excludes memorials and linear trails/parkways — PB-001). */
const US_TYPES_EXCLUDED = new Set([
  "National Memorial",
  "National Parkway",
  "Parkway",
  "National Historic Trail",
  "National Scenic Trail",
  "National Monument and Historic Shrine",
]);

const US_TYPES = new Set([
  "National Park",
  "National Monument",
  "National Preserve",
  "Other Designation",
  "National Historical Park",
  "National Historical Park and Preserve",
  "National Historic Site",
  "International Historic Site",
  "National Recreation Area",
  "National Seashore",
  "National Lakeshore",
  "National Battlefield",
  "National Battlefield Park",
  "National Battlefield Site",
  "National Military Park",
  "National Historical Reserve",
  "Ecological and Historic Preserve",
  "National Recreation River",
  "National River",
  "National River and Recreation Area",
  "National Scenic River",
  "National Scenic Riverway",
  "Scenic and Recreational River",
  "Wild River",
  "Wild and Scenic River",
  "National Reserve",
  "Park",
]);

const IN_SCOPE_NPS_CATEGORIES = new Set([
  "park",
  "monument",
  "preserve",
  "historic_park",
  "historic_site",
  "recreation",
  "affiliated",
  "other",
]);

const CA_TYPES = new Set([
  "National Park",
  "National Park Reserve",
  "National Historic Site",
  "National Marine Conservation Area",
  "National Marine Conservation Area Reserve",
]);

const UNIT_TYPE_RANK = {
  "National Park": 100,
  "National Monument": 90,
  "National Memorial": 70,
  "National Preserve": 50,
  "Other Designation": 20,
};

function unitTypeRank(unitType) {
  return UNIT_TYPE_RANK[unitType] || 40;
}

function ringBbox(ring) {
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
  return { south, west, north, east };
}

function ringBBoxArea(ring) {
  const b = ringBbox(ring);
  return (b.north - b.south) * (b.east - b.west);
}

function collectionBbox(features) {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const f of features) {
    const geom = f.geometry;
    const rings =
      geom?.type === "Polygon"
        ? geom.coordinates
        : geom?.type === "MultiPolygon"
          ? geom.coordinates.map((p) => p[0])
          : [];
    for (const ring of rings) {
      const b = ringBbox(ring);
      if (b.south < south) south = b.south;
      if (b.west < west) west = b.west;
      if (b.north > north) north = b.north;
      if (b.east > east) east = b.east;
    }
  }
  if (!Number.isFinite(south)) return null;
  return [west, south, east, north];
}

function simplifyRing(ring, maxPts = MAX_PTS_MAIN_RING) {
  if (!ring?.length || ring.length <= maxPts) return ring;
  const out = [];
  const step = Math.ceil(ring.length / maxPts);
  for (let i = 0; i < ring.length; i += step) out.push(ring[i]);
  const last = ring[ring.length - 1];
  const tail = out[out.length - 1];
  if (!tail || tail[0] !== last[0] || tail[1] !== last[1]) out.push(last);
  return out;
}

function prepareRings(rings) {
  const sorted = rings
    .filter((ring) => ring?.length >= 4)
    .sort((a, b) => ringBBoxArea(b) - ringBBoxArea(a));

  if (!sorted.length) return [];

  const mainArea = ringBBoxArea(sorted[0]);
  const main = simplifyRing(sorted[0], MAX_PTS_MAIN_RING);

  const secondary = [];
  for (let i = 1; i < sorted.length; i++) {
    const area = ringBBoxArea(sorted[i]);
    if (area < MIN_RING_AREA_DEG2) continue;
    if (area < mainArea * MIN_SECONDARY_AREA_RATIO) continue;
    secondary.push({
      area,
      ring: simplifyRing(sorted[i], ptsForSecondaryRing(area, mainArea)),
    });
  }

  secondary.sort((a, b) => b.area - a.area);
  const keptSecondary = secondary.slice(0, MAX_SECONDARY_RINGS).map((s) => s.ring);

  return keptSecondary.length ? [main, ...keptSecondary] : [main];
}

function esriToGeoJsonGeometry(geom) {
  if (!geom?.rings?.length) return null;
  const rings = prepareRings(geom.rings);
  if (!rings.length) return null;
  if (rings.length === 1) return { type: "Polygon", coordinates: rings };
  return { type: "MultiPolygon", coordinates: rings.map((ring) => [ring]) };
}

function usCategory(unitType) {
  const t = (unitType || "").toLowerCase();
  if (t.includes("national historical park") || t.includes("national historic park")) return "historic_park";
  if (t.includes("national historic site") || t.includes("international historic site")) return "historic_site";
  if (t.includes("national park") && !t.includes("historical") && !t.includes("historic")) return "park";
  if (t.includes("monument")) return "monument";
  if (t.includes("memorial")) return "memorial";
  if (
    t.includes("recreation") ||
    t.includes("seashore") ||
    t.includes("lakeshore") ||
    t.includes("scenic river") ||
    t.includes("wild river")
  ) {
    return "recreation";
  }
  if (t.includes("preserve") || t.includes("reserve")) return "preserve";
  if (t.includes("battlefield") || t.includes("military")) return "historic_site";
  if (t.includes("parkway") || t.includes("trail")) return "parkway_trail";
  return "other";
}

function caCategory(placeType) {
  const t = (placeType || "").toLowerCase();
  if (t.includes("historic site")) return "historic_site";
  if (t.includes("marine conservation")) return "marine";
  if (t.includes("national park")) return "park";
  return "other";
}

function toFeature(props, geometry) {
  if (!geometry) return null;
  return { type: "Feature", properties: props, geometry };
}

function groupByParkCode(features) {
  const byCode = new Map();
  for (const f of features) {
    const code = (f.attributes?.UNIT_CODE || "").toLowerCase();
    if (!code) continue;
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push(f);
  }
  return byCode;
}

function combinedEsriRings(featureList) {
  const rings = [];
  for (const f of featureList) {
    if (f.geometry?.rings?.length) rings.push(...f.geometry.rings);
  }
  return rings.length ? { rings } : null;
}

function pickPrimaryFeature(featureList) {
  return [...featureList].sort(
    (a, b) => unitTypeRank(b.attributes?.UNIT_TYPE) - unitTypeRank(a.attributes?.UNIT_TYPE)
  )[0];
}

function parkNameKey(attrs) {
  return (attrs?.PARKNAME || "").trim().toLowerCase();
}

/** Merge subsidiary preserve codes (e.g. CRMP) into the primary unit (CRMO) for one boundary per park. */
function consolidateSubsidiaryPreserveCodes(byCode) {
  const codesByPark = new Map();
  for (const [code, list] of byCode) {
    const park = parkNameKey(pickPrimaryFeature(list).attributes);
    if (!park) continue;
    if (!codesByPark.has(park)) codesByPark.set(park, []);
    codesByPark.get(park).push(code);
  }

  const skipCodes = new Set();
  for (const codes of codesByPark.values()) {
    if (codes.length < 2) continue;
    const ranked = codes
      .map((code) => {
        const attrs = pickPrimaryFeature(byCode.get(code)).attributes || {};
        return { code, rank: unitTypeRank(attrs.UNIT_TYPE), unitType: attrs.UNIT_TYPE || "" };
      })
      .sort((a, b) => b.rank - a.rank);
    const primary = ranked[0];
    for (let i = 1; i < ranked.length; i++) {
      const sub = ranked[i];
      if (sub.unitType === "National Preserve" && sub.code !== primary.code) {
        byCode.get(primary.code).push(...byCode.get(sub.code));
        skipCodes.add(sub.code);
      }
    }
  }
  for (const code of skipCodes) byCode.delete(code);
}

async function fetchUsByCodes(codes) {
  if (!codes.length) return [];
  const out = [];
  const batch = 25;
  for (let i = 0; i < codes.length; i += batch) {
    const chunk = codes.slice(i, i + batch);
    const where = `UNIT_CODE IN ('${chunk.map((c) => c.toUpperCase()).join("','")}')`;
    const feats = await fetchArcgisAllFeatures(
      US_QUERY,
      where,
      "UNIT_CODE,UNIT_NAME,UNIT_TYPE,STATE,PARKNAME",
      500,
      ARCGIS_OFFSET
    );
    out.push(...feats);
  }
  return out;
}

async function fetchUsBoundaries(npsGeo) {
  const where = [...US_TYPES].map((t) => `UNIT_TYPE='${t.replace(/'/g, "''")}'`).join(" OR ");
  console.log("US boundaries:", where);
  const feats = await fetchArcgisAllFeatures(
    US_QUERY,
    where,
    "UNIT_CODE,UNIT_NAME,UNIT_TYPE,STATE,PARKNAME",
    500,
    ARCGIS_OFFSET
  );

  const byCode = groupByParkCode(feats);
  const wantCodes = (npsGeo?.units || [])
    .filter((u) => IN_SCOPE_NPS_CATEGORIES.has(u.category))
    .map((u) => u.parkCode);
  const missingCodes = wantCodes.filter((code) => !byCode.has(code));
  if (missingCodes.length) {
    console.log("Fetching", missingCodes.length, "supplemental US codes from NPS geo...");
    const extra = await fetchUsByCodes(missingCodes);
    for (const f of extra) {
      const code = (f.attributes?.UNIT_CODE || "").toLowerCase();
      if (!code) continue;
      if (!byCode.has(code)) byCode.set(code, []);
      byCode.get(code).push(f);
    }
  }

  consolidateSubsidiaryPreserveCodes(byCode);

  const features = [];
  for (const [code, list] of byCode) {
    const primary = pickPrimaryFeature(list);
    const a = primary.attributes || {};
    const poly = esriToGeoJsonGeometry(combinedEsriRings(list));
    if (!poly) continue;
    const npsUnit = (npsGeo?.units || []).find((u) => u.parkCode === code);
    features.push(
      toFeature(
        {
          id: "us-" + code,
          country: "US",
          name: npsUnit?.name || a.UNIT_NAME || a.PARKNAME || "NPS unit",
          parkCode: code,
          category: npsUnit?.category || usCategory(a.UNIT_TYPE),
          unitType: npsUnit?.designation || a.UNIT_TYPE || "",
          state: npsUnit?.state || a.STATE || "",
        },
        poly
      )
    );
  }
  return features.filter(Boolean);
}

function parkCodeFromPcDesc(descEn, pcGeo) {
  const key = slug(
    (descEn || "")
      .replace(/\s+of Canada$/i, "")
      .replace(/\s+National (Park|Historic Site|Park Reserve|Marine Conservation Area).*$/i, "")
      .trim()
  );
  const unit = (pcGeo?.units || []).find((u) => u.parkCode === key || slug(u.name) === key);
  return unit?.parkCode || key;
}

async function fetchCaBoundaries(pcGeo) {
  const where = [...CA_TYPES].map((t) => `PLACE_TYPE_E='${t.replace(/'/g, "''")}'`).join(" OR ");
  console.log("CA boundaries:", where);
  const feats = await fetchArcgisAllFeatures(
    CA_QUERY,
    where,
    "BAID,PLACE_TYPE_E,DESC_EN,DESC_FR",
    200,
    ARCGIS_OFFSET
  );
  const features = [];
  for (const f of feats) {
    const a = f.attributes || {};
    const poly = esriToGeoJsonGeometry(f.geometry);
    if (!poly) continue;
    const placeType = a.PLACE_TYPE_E || "";
    const name = a.DESC_EN || a.DESC_FR || "Parks Canada place";
    const parkCode = parkCodeFromPcDesc(name, pcGeo);
    const pcUnit = (pcGeo?.units || []).find((u) => u.parkCode === parkCode || u.baid === a.BAID);
    features.push(
      toFeature(
        {
          id: "ca-" + (parkCode || slug(name)),
          country: "CA",
          name: pcUnit?.name || name,
          parkCode,
          category: pcUnit?.category || caCategory(placeType),
          unitType: placeType,
          state: pcUnit?.state || "",
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

function summarizeFeatures(features) {
  let totalVerts = 0;
  let maxVerts = 0;
  let maxName = "";
  const byCat = {};
  for (const f of features) {
    const cat = f.properties?.category || "?";
    byCat[cat] = (byCat[cat] || 0) + 1;
    const geom = f.geometry;
    let verts = 0;
    if (geom?.type === "Polygon") {
      verts = geom.coordinates.reduce((s, ring) => s + ring.length, 0);
    } else if (geom?.type === "MultiPolygon") {
      verts = geom.coordinates.reduce((s, poly) => s + poly[0].length, 0);
    }
    totalVerts += verts;
    if (verts > maxVerts) {
      maxVerts = verts;
      maxName = f.properties?.name || "";
    }
  }
  return {
    byCat,
    totalVerts,
    avgVerts: features.length ? Math.round(totalVerts / features.length) : 0,
    maxVerts,
    maxName,
  };
}

function buildCoverageReport(npsGeo, pcGeo, features) {
  const usCodes = new Set(features.filter((f) => f.properties.country === "US").map((f) => f.properties.parkCode));
  const caCodes = new Set(features.filter((f) => f.properties.country === "CA").map((f) => f.properties.parkCode));

  const usByCategory = {};
  const usMissing = [];
  for (const u of npsGeo?.units || []) {
    if (!IN_SCOPE_NPS_CATEGORIES.has(u.category)) continue;
    usByCategory[u.category] = usByCategory[u.category] || { total: 0, withBoundary: 0 };
    usByCategory[u.category].total += 1;
    if (usCodes.has(u.parkCode)) usByCategory[u.category].withBoundary += 1;
    else usMissing.push({ parkCode: u.parkCode, name: u.name, category: u.category, designation: u.designation });
  }

  const caByType = {};
  const caMissing = [];
  for (const u of pcGeo?.units || []) {
    const t = u.designation || u.category;
    caByType[t] = caByType[t] || { total: 0, withBoundary: 0 };
    caByType[t].total += 1;
    if (caCodes.has(u.parkCode)) caByType[t].withBoundary += 1;
    else caMissing.push({ parkCode: u.parkCode, name: u.name, designation: u.designation });
  }

  const usInScope = Object.values(usByCategory).reduce((n, c) => n + c.total, 0);
  const usWith = Object.values(usByCategory).reduce((n, c) => n + c.withBoundary, 0);
  const caTotal = Object.values(caByType).reduce((n, c) => n + c.total, 0);
  const caWith = Object.values(caByType).reduce((n, c) => n + c.withBoundary, 0);

  return {
    generated: new Date().toISOString(),
    us: {
      inScopeUnits: usInScope,
      withBoundary: usWith,
      coveragePct: usInScope ? Math.round((1000 * usWith) / usInScope) / 10 : 0,
      byCategory: usByCategory,
      missing: usMissing,
    },
    ca: {
      catalogUnits: caTotal,
      withBoundary: caWith,
      coveragePct: caTotal ? Math.round((1000 * caWith) / caTotal) / 10 : 0,
      byType: caByType,
      missing: caMissing,
    },
    excludedCategories: ["memorial", "parkway_trail"],
    excludedUsTypes: [...US_TYPES_EXCLUDED],
  };
}

async function main() {
  const npsGeo = fs.existsSync(NPS_GEO_PATH) ? JSON.parse(fs.readFileSync(NPS_GEO_PATH, "utf8")) : null;
  const pcGeo = fs.existsSync(PC_GEO_PATH) ? JSON.parse(fs.readFileSync(PC_GEO_PATH, "utf8")) : null;

  const us = await fetchUsBoundaries(npsGeo);
  console.log("US features:", us.length);
  const ca = await fetchCaBoundaries(pcGeo);
  console.log("CA features:", ca.length);

  const features = [...us, ...ca];
  const stats = summarizeFeatures(features);
  console.log("Categories:", stats.byCat);
  console.log(
    "Vertices: total",
    stats.totalVerts,
    "avg",
    stats.avgVerts,
    "max",
    stats.maxVerts,
    stats.maxName
  );

  const bbox = collectionBbox(features);
  const fc = {
    type: "FeatureCollection",
    generated: new Date().toISOString(),
    source: "nps-boundaries-arcgis+simplified",
    bbox,
    count: features.length,
    features,
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
  console.log("Wrote", embedPath, (fs.statSync(embedPath).size / 1024 / 1024).toFixed(2), "MB");

  const coverage = buildCoverageReport(npsGeo, pcGeo, features);
  fs.writeFileSync(BOUNDARY_QA_PATH, JSON.stringify(coverage, null, 2) + "\n", "utf8");
  console.log(
    "US boundary coverage:",
    coverage.us.withBoundary + "/" + coverage.us.inScopeUnits,
    "(" + coverage.us.coveragePct + "%)"
  );
  console.log("US by category:", coverage.us.byCategory);
  console.log(
    "CA boundary coverage:",
    coverage.ca.withBoundary + "/" + coverage.ca.catalogUnits,
    "(" + coverage.ca.coveragePct + "%)"
  );
  console.log("CA by type:", coverage.ca.byType);
  if (coverage.us.missing.length) {
    console.log(
      "US in-scope units without boundary:",
      coverage.us.missing.length,
      "— see",
      BOUNDARY_QA_PATH
    );
  }
  if (coverage.ca.missing.length) {
    console.log("CA catalog units without boundary:", coverage.ca.missing.length);
  }

  if (npsGeo) {
    const codes = new Set(features.filter((f) => f.properties.country === "US").map((f) => f.properties.parkCode));
    const missingParks = npsGeo.units.filter(
      (u) => u.category === "park" && IN_SCOPE_NPS_CATEGORIES.has(u.category) && !codes.has(u.parkCode)
    );
    const missingMon = npsGeo.units.filter(
      (u) => u.category === "monument" && !codes.has(u.parkCode)
    );
    if (missingParks.length) console.log("Still missing National Park boundaries:", missingParks.map((u) => u.parkCode));
    if (missingMon.length) console.log("Still missing National Monument boundaries:", missingMon.map((u) => u.parkCode));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
