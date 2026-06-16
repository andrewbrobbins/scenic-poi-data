/**
 * ONroute highway=services plazas (Ontario) — often not amenity=fuel in OSM.
 */
import path from "path";
import { PROVINCE_BBOXES } from "./camping-ca-province-bboxes.mjs";
import {
  coordValid,
  ensureIngestDir,
  matchOnrouteServices,
  readJson,
  sleep,
  slugify,
  writeJson,
} from "./fuel-ca-lib.mjs";

const OVERPASS_URL = "https://overpass.kumi.systems/api/interpreter";

function elementCoords(el) {
  if (el.type === "node") return { lat: el.lat, lon: el.lon };
  if (el.center) return { lat: el.center.lat, lon: el.center.lon };
  return null;
}

async function overpassQuery(query) {
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "VancouverTripFuelCA/1.0 (ONroute services)",
    },
    body: "data=" + encodeURIComponent(query),
    signal: AbortSignal.timeout(180000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error("Overpass HTTP " + res.status + ": " + text.slice(0, 120));
  return JSON.parse(text);
}

export async function ingestOnroute() {
  const outDir = ensureIngestDir("02-onroute");
  const outPath = path.join(outDir, "onroute-ON.json");
  const bbox = PROVINCE_BBOXES.ON;
  const [s, w, n, e] = bbox;
  const query = `[out:json][timeout:180];
(
  node["highway"="services"]["name"~"ONroute|OnRoute",i](${s},${w},${n},${e});
  way["highway"="services"]["name"~"ONroute|OnRoute",i](${s},${w},${n},${e});
);
out center tags;`;

  console.log("ONroute ON: querying highway=services...");
  const j = await overpassQuery(query);
  const records = [];
  const seen = new Set();
  for (const el of j.elements || []) {
    const tags = el.tags || {};
    const match = matchOnrouteServices(tags);
    if (!match) continue;
    const coords = elementCoords(el);
    if (!coords || !coordValid(coords.lat, coords.lon)) continue;
    const key = el.type + ":" + el.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const name = (tags.name || tags["name:fr"] || match.displayName).trim();
    records.push({
      id: `FUEL-CA-ONROUTE-ON-${slugify(name)}-${el.id}`,
      name,
      brand: match.displayName,
      brandId: match.brandId,
      brandTier: match.tier,
      type: match.type,
      state: "ON",
      lat: coords.lat,
      lon: coords.lon,
      highway: "services",
      fuels: { gasoline: true, diesel: false },
      amenities: { restroom: "assumed", food: "yes" },
      sources: ["osm", "onroute-services"],
      osm: { type: el.type, id: el.id },
      mapFlags: [],
      needsReview: false,
      url: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    });
  }

  writeJson(outPath, {
    generated: new Date().toISOString(),
    state: "ON",
    recordCount: records.length,
    records,
  });
  console.log("ONroute ON:", records.length);
  await sleep(2000);
  return records;
}

if (process.argv[1]?.endsWith("build-fuel-ca-ingest-onroute.mjs")) {
  await ingestOnroute();
}
