/**
 * Ingest amenity=fuel from OSM; keep only fuel-us-brand-catalog.json brands.
 *
 * NOTE: Prefer local PBF ingest — do NOT use Overpass for routine builds.
 *   node build-fuel-us-ingest-pbf.mjs
 * See FUEL-US.md and POI-OSM-PBF.md.
 */
import fs from "fs";
import path from "path";
import { STATE_BBOXES } from "./camping-us-state-bboxes.mjs";
import { OSM_SPLIT } from "./camping-us-osm-split-states.mjs";
import {
  INGEST_DIR,
  coordValid,
  ensureIngestDir,
  loadBrandCatalog,
  matchBrandFromTags,
  readJson,
  sleep,
  slugify,
  writeJson,
} from "./fuel-us-lib.mjs";

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
      "User-Agent": "VancouverTripFuelDB/1.0 (brand fuel stops; contact: local-dev)",
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

function buildBrandDiscoveryLines(catalog) {
  const lines = [];
  const seen = new Set();
  for (const b of catalog.brands) {
    for (const frag of b.osm?.nameContains || []) {
      const f = String(frag).trim();
      if (f.length < 4 || seen.has(f)) continue;
      seen.add(f);
      lines.push(`  node["name"~"${f}",i]`);
      lines.push(`  way["name"~"${f}",i]`);
    }
    for (const raw of [...(b.osm?.brand || []), ...(b.osm?.operator || [])]) {
      const v = String(raw).trim();
      if (v.length < 4 || seen.has(`b:${v}`)) continue;
      seen.add(`b:${v}`);
      const escaped = v.replace(/[\\"]/g, "\\$&");
      lines.push(`  node["brand"~"^${escaped}$",i]`);
      lines.push(`  way["brand"~"^${escaped}$",i]`);
      lines.push(`  node["operator"~"^${escaped}$",i]`);
      lines.push(`  way["operator"~"^${escaped}$",i]`);
    }
  }
  return lines;
}

function buildStateQuery(st, bbox, catalog) {
  const [s, w, n, e] = bbox;
  const brandLines = buildBrandDiscoveryLines(catalog)
    .map((line) => `${line}(${s},${w},${n},${e});`)
    .join("\n");
  return `
[out:json][timeout:300];
(
  node["amenity"="fuel"](${s},${w},${n},${e});
  way["amenity"="fuel"](${s},${w},${n},${e});
  node["shop"="fuel"](${s},${w},${n},${e});
  way["shop"="fuel"](${s},${w},${n},${e});
  node["highway"="services"]["brand"](${s},${w},${n},${e});
  way["highway"="services"]["brand"](${s},${w},${n},${e});
  node["highway"="rest_area"]["brand"](${s},${w},${n},${e});
  way["highway"="rest_area"]["brand"](${s},${w},${n},${e});
${brandLines}
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

    const match = matchBrandFromTags(tags, catalog);
    if (!match) continue;

    const key = osmElementKey(el);
    if (seen.has(key)) continue;
    seen.add(key);

    const name = (tags.name || tags["addr:housename"] || match.displayName).trim();
    records.push({
      id: `FUEL-${match.brandId.toUpperCase()}-${st}-${slugify(name)}-${el.id}`,
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
        brand: tags.brand || "",
        operator: tags.operator || "",
      },
      mapFlags: [],
      needsReview: false,
      manualVerified: false,
      url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    });
  }
  return records;
}

export async function ingestFuelOsm(statesFilter = null) {
  const catalog = loadBrandCatalog();
  const outDir = ensureIngestDir("01-osm");
  const states = statesFilter || Object.keys(STATE_BBOXES);
  const stateStats = {};

  for (const st of states) {
    if (!STATE_BBOXES[st] && !OSM_SPLIT[st]) continue;
    const cachePath = path.join(outDir, `osm-${st}.json`);
    const cached = readJson(cachePath);
    if (cached?.records?.length) {
      console.log(`Fuel OSM ${st}: cache hit (${cached.records.length})`);
      stateStats[st] = { cached: true, count: cached.records.length };
      continue;
    }

    const bboxes = OSM_SPLIT[st] || [STATE_BBOXES[st]];
    let elements = [];
    let lastErr = null;
    for (let bi = 0; bi < bboxes.length; bi++) {
      const bbox = bboxes[bi];
      const label = bboxes.length > 1 ? `${st} part ${bi + 1}/${bboxes.length}` : st;
      console.log(`Fuel OSM ${label}: querying...`);
      try {
        const j = await overpassQuery(buildStateQuery(st, bbox, catalog));
        elements.push(...(j.elements || []));
        await sleep(4000);
      } catch (e) {
        lastErr = e.message;
        console.warn(`Fuel OSM ${label}:`, e.message);
      }
    }

    if (!elements.length && lastErr) {
      writeJson(cachePath, { generated: new Date().toISOString(), state: st, error: lastErr, records: [] });
      stateStats[st] = { error: lastErr, count: 0 };
      await sleep(2000);
      continue;
    }

    const seen = new Set();
    const records = elementsToRecords(st, elements, catalog, seen);
    const byBrand = {};
    for (const r of records) byBrand[r.brandId] = (byBrand[r.brandId] || 0) + 1;

    writeJson(cachePath, {
      generated: new Date().toISOString(),
      state: st,
      elementCount: elements.length,
      recordCount: records.length,
      byBrand,
      records,
    });
    stateStats[st] = { count: records.length, elements: elements.length, byBrand };
    console.log(`Fuel OSM ${st}: ${records.length} matched (${elements.length} raw elements)`);
    await sleep(5000);
  }

  const merged = mergeAllOsmCaches(outDir);
  const payload = {
    generated: new Date().toISOString(),
    source: "OpenStreetMap Overpass",
    catalogBrands: catalog.brands.map((b) => b.id),
    recordCount: merged.allRecords.length,
    stateStats: merged.stateStats,
    records: merged.allRecords,
  };
  writeJson(path.join(outDir, "fuel-merged.json"), payload);
  console.log("Fuel OSM total:", payload.recordCount);
  return payload;
}

function parseStateArgs() {
  const multi = process.argv.find((a) => a.startsWith("--states="));
  if (multi) return multi.split("=")[1].split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const one = process.argv.find((a) => a.startsWith("--state="));
  if (one) return [one.split("=")[1].toUpperCase()];
  return null;
}

if (process.argv[1]?.endsWith("build-fuel-us-ingest-osm.mjs")) {
  await ingestFuelOsm(parseStateArgs());
}
