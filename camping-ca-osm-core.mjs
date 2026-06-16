import fs from "fs";
import path from "path";
import {
  ALLOWED_LAND_MANAGERS,
  baseRecord,
  addReview,
  coordValid,
  ensureIngestDir,
  isCommercialName,
  slugify,
  sleep,
  writeJson,
  readJson,
} from "./camping-ca-lib.mjs";
import { PROVINCE_BBOXES } from "./camping-ca-province-bboxes.mjs";
import { inferStateFromCoords } from "./camping-ca-geo-utils.mjs";

const OVERPASS_URLS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

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
  QC: [
    [45, -80, 52, -70],
    [45, -70, 52, -57],
    [52, -80, 63, -70],
    [52, -70, 63, -57],
  ],
};

const GOV_PARK_OPERATOR =
  /parks canada|parcs canada|bc parks|british columbia parks|alberta parks|ontario parks|parks ontario|saskatchewan parks|manitoba parks|sepaq|parc provincial|provincial park|ministry of environment|ministry of tourism/i;

function tagBlob(tags) {
  return [
    tags.operator,
    tags.brand,
    tags.owner,
    tags["operator:fr"],
    tags.name,
    tags["name:fr"],
    tags.website,
    tags.description,
  ]
    .filter(Boolean)
    .join(" ");
}

function inferLandManager(tags) {
  const blob = tagBlob(tags);
  const n = (tags.name || tags["name:fr"] || "").toLowerCase();
  const website = (tags.website || "").toLowerCase();
  if (/parks canada|parcs canada|pc\.gc\.ca|parcscanada/i.test(blob + " " + website)) return "Parks Canada";
  if (
    /env\.gov\.bc\.ca\/bcparks|bcparks\.ca|ontarioparks\.|albertaparks\.ca|parcscanada|pc\.gc\.ca/i.test(website)
  ) {
    return /parks canada|parcs canada|pc\.gc\.ca/i.test(website) ? "Parks Canada" : "Provincial";
  }
  if (/parks canada|parcs canada/i.test(blob)) return "Parks Canada";
  if (GOV_PARK_OPERATOR.test(blob)) return "Provincial";
  if (/provincial park|parc provincial/i.test(n)) return "Provincial";
  if (/parc national|national park of canada/i.test(n) && !/provincial/i.test(n)) return "Parks Canada";
  if (tags["operator:type"] === "government" || tags.government === "yes") {
    if (/parks canada|parcs canada/i.test(blob)) return "Parks Canada";
    return "Provincial";
  }
  if (tags.boundary === "protected_area" && /provincial|national park/i.test(blob)) {
    return /national park of canada|parc national/i.test(blob) ? "Parks Canada" : "Provincial";
  }
  return "Unknown";
}

function isPrivateCampground(tags, name) {
  if (isCommercialName(name, tags.operator, tags.brand)) return true;
  const blob = tagBlob(tags).toLowerCase();
  if (GOV_PARK_OPERATOR.test(blob) || tags["operator:type"] === "government") return false;
  if (/\bresort\b/i.test(name) && !/\bprovincial park\b/i.test(blob)) return true;
  if (/\bprivate\b/i.test(blob) && /\bcamp/i.test(blob)) return true;
  return false;
}

function elementCoords(el) {
  if (el.type === "node") return { lat: el.lat, lon: el.lon };
  if (el.center) return { lat: el.center.lat, lon: el.center.lon };
  return null;
}

async function overpassQuery(query, urlIndex = 0) {
  const url = OVERPASS_URLS[urlIndex % OVERPASS_URLS.length];
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "VancouverTripCampingCA/1.0",
    },
    body: "data=" + encodeURIComponent(query),
    signal: AbortSignal.timeout(600000),
  });
  const text = await res.text();
  if (!res.ok) {
    if (urlIndex < OVERPASS_URLS.length - 1) return overpassQuery(query, urlIndex + 1);
    throw new Error("Overpass HTTP " + res.status + ": " + text.slice(0, 200));
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

function buildProvinceQuery(bbox) {
  const [s, w, n, e] = bbox;
  return `[out:json][timeout:300];
(
  node["tourism"="camp_site"](${s},${w},${n},${e});
  way["tourism"="camp_site"](${s},${w},${n},${e});
  relation["tourism"="camp_site"](${s},${w},${n},${e});
  node["camp_site"](${s},${w},${n},${e});
  way["camp_site"](${s},${w},${n},${e});
);
out center tags;`;
}

function elementsToRecords(pr, elements, seen) {
  const records = [];
  for (const el of elements) {
    const tags = el.tags || {};
    const coords = elementCoords(el);
    if (!coords || !coordValid(coords.lat, coords.lon)) continue;
    const name = (tags.name || tags["name:fr"] || "").trim() || "OSM " + el.type + " " + el.id;
    if (isPrivateCampground(tags, name)) continue;
    const landManager = inferLandManager(tags);
    if (!ALLOWED_LAND_MANAGERS.has(landManager)) continue;
    const key = el.type + ":" + el.id;
    if (seen.has(key)) continue;
    seen.add(key);
    if (["dispersed", "wildcamp", "backcountry"].includes(tags["camp_site"] || "")) continue;
    const geoSt = inferStateFromCoords(coords.lat, coords.lon) || pr;
    const rec = baseRecord({
      id: "CG-CA-OSM-" + geoSt + "-" + slugify(name) + "-" + el.id,
      name,
      type: "developed",
      landManager,
      state: geoSt,
      lat: coords.lat,
      lon: coords.lon,
      coordSource: "openstreetmap",
      cost: tags.fee === "no" ? "free" : tags.fee === "yes" ? "fee" : "unknown",
      ingestSource: "02-osm",
      sourceIds: { osmType: el.type, osmId: el.id },
      urls: { detail: "https://www.openstreetmap.org/" + el.type + "/" + el.id },
    });
    if (!tags.name) addReview(rec, "missing-osm-name", "NO_NAME");
    records.push(rec);
  }
  return records;
}

export async function ingestCampingOsm(provincesFilter = null, options = {}) {
  const refresh = options.refresh ?? process.argv.includes("--refresh");
  const outDir = ensureIngestDir("02-osm");
  const provinces = provincesFilter || Object.keys(PROVINCE_BBOXES);

  for (const pr of provinces) {
    const bboxes = OSM_SPLIT[pr] || (PROVINCE_BBOXES[pr] ? [PROVINCE_BBOXES[pr]] : []);
    if (!bboxes.length) continue;
    const cachePath = path.join(outDir, "osm-" + pr + ".json");
    const cached = !refresh ? readJson(cachePath) : null;
    if (cached?.records?.length) {
      console.log("Camping CA OSM " + pr + ": cache (" + cached.records.length + ")");
      continue;
    }

    console.log("Camping CA OSM " + pr + ": querying " + bboxes.length + " tile(s)...");
    const seen = new Set();
    const records = [];
    let lastError = null;

    for (let i = 0; i < bboxes.length; i++) {
      try {
        const j = await overpassQuery(buildProvinceQuery(bboxes[i]));
        records.push(...elementsToRecords(pr, j.elements || [], seen));
        console.log("  tile " + (i + 1) + "/" + bboxes.length + ": +" + (j.elements?.length || 0) + " elements");
        if (i < bboxes.length - 1) await sleep(4000);
      } catch (e) {
        lastError = e;
        console.warn("  tile " + (i + 1) + "/" + bboxes.length + " failed:", e.message);
      }
    }

    if (records.length) {
      writeJson(cachePath, {
        generated: new Date().toISOString(),
        state: pr,
        recordCount: records.length,
        tiles: bboxes.length,
        records,
      });
      console.log("Camping CA OSM " + pr + ": " + records.length);
    } else if (cached?.records?.length) {
      console.warn("Camping CA OSM " + pr + ": fetch failed; keeping prior cache (" + cached.records.length + ")");
    } else {
      writeJson(cachePath, {
        generated: new Date().toISOString(),
        state: pr,
        error: lastError?.message || "no records",
        records: [],
      });
      console.warn("Camping CA OSM " + pr + ": no records", lastError?.message || "");
    }
  }
}
