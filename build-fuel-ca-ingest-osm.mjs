/**
 * LEGACY: Overpass ingest for Canada branded fuel.
 * Prefer local PBF: node build-fuel-ca-ingest-pbf.mjs (see FUEL-CA.md).
 */
import fs from "fs";
import path from "path";
import { PROVINCE_BBOXES } from "./camping-ca-province-bboxes.mjs";

/** Split large provinces so Overpass does not 504/timeout. [south, west, north, east][] */
const OSM_SPLIT = {
  AB: [
    [49, -120, 54, -114],
    [49, -114, 54, -110],
    [54, -120, 60, -114],
    [54, -114, 60, -110],
  ],
  BC: [
    [48.3, -139, 52, -125],
    [48.3, -125, 52, -114],
    [52, -139, 56, -125],
    [52, -125, 56, -114],
    [56, -132, 60, -114],
  ],
  ON: [
    [41.5, -95.5, 49, -84],
    [41.5, -84, 49, -74],
    [49, -95.5, 57, -84],
    [49, -84, 57, -74],
  ],
};
import {
  INGEST_DIR,
  coordValid,
  ensureIngestDir,
  loadBrandCatalog,
  matchBrandFromTags,
  matchOnrouteServices,
  readJson,
  sleep,
  slugify,
  writeJson,
} from "./fuel-ca-lib.mjs";

const OVERPASS_URLS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

function mergeAllOsmCaches(outDir) {
  const allRecords = [];
  const stateStats = {};
  for (const f of fs.readdirSync(outDir).filter((n) => /^osm-[A-Z]{2}\.json$/.test(n)).sort()) {
    const j = readJson(path.join(outDir, f));
    const st = j?.state || f.slice(4, 6);
    if (j?.records?.length) {
      allRecords.push(...j.records);
      stateStats[st] = { count: j.recordCount, cached: true };
    } else if (j?.error) {
      stateStats[st] = { error: j.error, count: 0 };
    }
  }
  return { allRecords, stateStats };
}

function elementCoords(el) {
  if (el.type === "node") return { lat: el.lat, lon: el.lon };
  if (el.center) return { lat: el.center.lat, lon: el.center.lon };
  return null;
}

async function overpassQuery(query, urlIndex = 0) {
  const url = OVERPASS_URLS[urlIndex % OVERPASS_URLS.length];
  const body = "data=" + encodeURIComponent(query);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "VancouverTripFuelCA/1.0 (brand fuel stops; contact: local-dev)",
    },
    body,
    signal: AbortSignal.timeout(600000),
  });
  const text = await res.text();
  if (!res.ok) {
    if (urlIndex < OVERPASS_URLS.length - 1) return overpassQuery(query, urlIndex + 1);
    throw new Error(`Overpass HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    if (urlIndex < OVERPASS_URLS.length - 1) return overpassQuery(query, urlIndex + 1);
    throw new Error("Overpass invalid JSON");
  }
  if (j.remark && /rate|too busy/i.test(j.remark)) {
    await sleep(15000);
    if (urlIndex < 4) return overpassQuery(query, urlIndex + 1);
  }
  return j;
}

function buildProvinceQuery(pr, bbox) {
  const [s, w, n, e] = bbox;
  return `
[out:json][timeout:300];
(
  node["amenity"="fuel"](${s},${w},${n},${e});
  way["amenity"="fuel"](${s},${w},${n},${e});
  node["shop"="fuel"](${s},${w},${n},${e});
  way["shop"="fuel"](${s},${w},${n},${e});
);
out center tags;
`;
}

function buildOnrouteServicesQuery(bbox) {
  const [s, w, n, e] = bbox;
  return `
[out:json][timeout:300];
(
  node["highway"="services"]["name"~"ONroute|OnRoute",i](${s},${w},${n},${e});
  way["highway"="services"]["name"~"ONroute|OnRoute",i](${s},${w},${n},${e});
  node["highway"="services"]["brand"~"ONroute|OnRoute",i](${s},${w},${n},${e});
  way["highway"="services"]["brand"~"ONroute|OnRoute",i](${s},${w},${n},${e});
);
out center tags;
`;
}

function osmElementKey(el) {
  return `${el.type}:${el.id}`;
}

function elementsToRecords(st, elements, catalog, seen) {
  const records = [];
  for (const el of elements) {
    const tags = el.tags || {};
    const coords = elementCoords(el);
    if (!coords || !coordValid(coords.lat, coords.lon)) continue;

    let match = matchBrandFromTags(tags, catalog);
    if (!match) match = matchOnrouteServices(tags);
    if (!match) continue;

    const key = osmElementKey(el);
    if (seen.has(key)) continue;
    seen.add(key);

    const name = (tags.name || tags["name:fr"] || tags["addr:housename"] || match.displayName).trim();
    records.push({
      id: `FUEL-CA-${match.brandId.toUpperCase()}-${st}-${slugify(name)}-${el.id}`,
      name,
      brand: match.displayName,
      brandId: match.brandId,
      brandTier: match.tier,
      type: match.type,
      mergeWith: match.mergeWith,
      state: st,
      lat: coords.lat,
      lon: coords.lon,
      highway: tags.highway || "",
      exit: tags.ref || tags["exit"] || "",
      fuels: {
        gasoline: true,
        diesel: tags["fuel:diesel"] === "yes" || tags.diesel === "yes",
      },
      amenities: {
        restroom: tags.toilets ? String(tags.toilets) : "assumed",
        food: tags.shop === "convenience" ? "yes" : "unknown",
      },
      sources: ["osm"],
      osm: { type: el.type, id: el.id },
      osmTags: {
        brand: tags.brand || tags["brand:fr"] || "",
        operator: tags.operator || tags["operator:fr"] || "",
      },
      mapFlags: [],
      needsReview: false,
      manualVerified: false,
      url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    });
  }
  return records;
}

export async function ingestFuelOsm(provincesFilter = null, options = {}) {
  const refresh = options.refresh ?? process.argv.includes("--refresh");
  const catalog = loadBrandCatalog();
  const outDir = ensureIngestDir("01-osm");
  const provinces = provincesFilter || Object.keys(PROVINCE_BBOXES);
  const stateStats = {};

  for (const pr of provinces) {
    const bboxes = OSM_SPLIT[pr] || (PROVINCE_BBOXES[pr] ? [PROVINCE_BBOXES[pr]] : []);
    if (!bboxes.length) continue;
    const cachePath = path.join(outDir, `osm-${pr}.json`);
    const cached = !refresh && readJson(cachePath);
    if (cached?.records?.length) {
      console.log(`Fuel CA OSM ${pr}: cache hit (${cached.records.length})`);
      stateStats[pr] = { cached: true, count: cached.records.length };
      continue;
    }

    console.log(`Fuel CA OSM ${pr}: querying (${bboxes.length} bbox part(s))...`);
    let elements = [];
    let lastErr = null;
    for (let bi = 0; bi < bboxes.length; bi++) {
      const bbox = bboxes[bi];
      const label = bboxes.length > 1 ? `${pr} part ${bi + 1}/${bboxes.length}` : pr;
      try {
        const j = await overpassQuery(buildProvinceQuery(pr, bbox));
        elements.push(...(j.elements || []));
        await sleep(4000);
      } catch (e) {
        lastErr = e.message;
        console.warn(`Fuel CA OSM ${label}:`, e.message);
      }
    }

    if (!elements.length && lastErr) {
      const prev = readJson(cachePath);
      if (prev?.records?.length) {
        console.warn(`Fuel CA OSM ${pr}: fetch failed, keeping prior cache (${prev.records.length})`);
        stateStats[pr] = { error: lastErr, count: prev.records.length, keptCache: true };
        await sleep(2000);
        continue;
      }
      writeJson(cachePath, { generated: new Date().toISOString(), state: pr, error: lastErr, records: [] });
      stateStats[pr] = { error: lastErr, count: 0 };
      await sleep(2000);
      continue;
    }

    const seen = new Set();
    const records = elementsToRecords(pr, elements, catalog, seen);
    const byBrand = {};
    for (const r of records) byBrand[r.brandId] = (byBrand[r.brandId] || 0) + 1;

    writeJson(cachePath, {
      generated: new Date().toISOString(),
      state: pr,
      elementCount: elements.length,
      recordCount: records.length,
      byBrand,
      records,
    });
    stateStats[pr] = { count: records.length, elements: elements.length, byBrand };
    console.log(`Fuel CA OSM ${pr}: ${records.length} matched (${elements.length} raw)`);
    await sleep(5000);
  }

  const merged = mergeAllOsmCaches(outDir);
  const payload = {
    generated: new Date().toISOString(),
    source: "OpenStreetMap Overpass (Canada)",
    catalogBrands: catalog.brands.map((b) => b.id),
    recordCount: merged.allRecords.length,
    stateStats: merged.stateStats,
    records: merged.allRecords,
  };
  writeJson(path.join(outDir, "fuel-merged.json"), payload);
  console.log("Fuel CA OSM total:", payload.recordCount);
  return payload;
}

function parseProvinceArgs() {
  const multi = process.argv.find((a) => a.startsWith("--provinces="));
  if (multi) return multi.split("=")[1].split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const one = process.argv.find((a) => a.startsWith("--province="));
  if (one) return [one.split("=")[1].toUpperCase()];
  return null;
}

if (process.argv[1]?.endsWith("build-fuel-ca-ingest-osm.mjs")) {
  await ingestFuelOsm(parseProvinceArgs());
}
