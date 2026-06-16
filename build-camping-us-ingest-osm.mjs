/**
 * Step 3: OpenStreetMap camp sites by state bbox (NPS/USFS/BLM/State/COE supplement).
 */
import fs from "fs";
import path from "path";
import {
  baseRecord,
  addReview,
  coordValid,
  ensureIngestDir,
  isCommercialName,
  slugify,
  sleep,
  writeJson,
  readJson,
} from "./camping-us-lib.mjs";
import { STATE_BBOXES } from "./camping-us-state-bboxes.mjs";
import { inferStateFromCoords } from "./camping-us-geo-utils.mjs";
import {
  OSM_SPLIT,
  OSM_RETRY_SUBSPLIT,
  FAILED_BBOX_PARTS,
} from "./camping-us-osm-split-states.mjs";

const OVERPASS_URLS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

const MISSING_STATES_DEFAULT = ["IL", "IA", "KY", "MT", "NV", "NH"];

function mergeAllOsmCaches(outDir) {
  const allRecords = [];
  const stateStats = {};
  for (const f of fs.readdirSync(outDir).filter((name) => /^osm-[A-Z]{2}\.json$/.test(name)).sort()) {
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

function inferLandManager(tags) {
  const op = [tags.operator, tags.brand, tags.owner, tags["operator:type"]].filter(Boolean).join(" ");
  const n = (tags.name || "").toLowerCase();
  if (/national park|nps|national park service/i.test(op) || tags.protection_title === "national_park") return "NPS";
  if (/forest service|u\.?s\.? forest|usfs/i.test(op)) return "USFS";
  if (/bureau of land|blm/i.test(op)) return "BLM";
  if (/army corps|usace|corps of engineers/i.test(op)) return "COE";
  if (/fish and wildlife|usfws|wildlife refuge/i.test(op)) return "USFWS";
  if (/state park|state forest|dept of natural|dnr|state parks/i.test(op)) return "State";
  if (/county park|county/i.test(op)) return "County";
  if (/city of|municipal/i.test(op)) return "City";
  if (tags.boundary === "national_park" || /national park/i.test(n)) return "NPS";
  if (/national forest/i.test(n) || /national forest/i.test(tags.description || "")) return "USFS";
  return "Unknown";
}

function osmCost(tags) {
  if (tags.fee === "no") return "free";
  if (tags.fee === "yes") return "fee";
  const camp = tags["camp_site"] || "";
  if (camp === "dispersed" || camp === "wildcamp") return "free";
  return "unknown";
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
      "User-Agent": "VancouverTripCampingDB/1.0 (public-land camping research; contact: local-dev)",
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

function buildStateQuery(st, bbox) {
  const [s, w, n, e] = bbox;
  return `
[out:json][timeout:300];
(
  node["tourism"="camp_site"](${s},${w},${n},${e});
  way["tourism"="camp_site"](${s},${w},${n},${e});
  relation["tourism"="camp_site"](${s},${w},${n},${e});
  node["camp_site"](${s},${w},${n},${e});
  way["camp_site"](${s},${w},${n},${e});
);
out center tags;
`;
}

function osmElementKey(el) {
  return `${el.type}:${el.id}`;
}

function recordOsmKey(rec) {
  const t = rec.sourceIds?.osmType;
  const id = rec.sourceIds?.osmId;
  return t && id != null ? `${t}:${id}` : null;
}

function elementsToRecords(st, elements, seen) {
  const records = [];
  for (const el of elements) {
    const tags = el.tags || {};
    const coords = elementCoords(el);
    if (!coords || !coordValid(coords.lat, coords.lon)) continue;

    let name = (tags.name || tags["addr:housename"] || "").trim();
    if (!name) name = `OSM ${el.type} ${el.id}`;
    if (isCommercialName(name, tags.operator, tags.brand)) continue;

    const key = osmElementKey(el);
    if (seen.has(key)) continue;
    seen.add(key);

    const landManager = inferLandManager(tags);
    const dispersed = ["dispersed", "wildcamp", "backcountry"].includes(tags["camp_site"] || tags.tourism);

    const geoSt = inferStateFromCoords(coords.lat, coords.lon) || st;
    const rec = baseRecord({
      id: `CG-OSM-${geoSt}-${slugify(name)}-${el.id}`,
      name,
      type: dispersed ? "dispersed" : "developed",
      landManager,
      parentUnit: tags["ref:nrhp"] ? null : { system: "osm", note: tags.operator || "" },
      state: geoSt,
      lat: coords.lat,
      lon: coords.lon,
      coordSource: "openstreetmap",
      coordConfidence: el.type === "node" ? "medium" : "low",
      cost: osmCost(tags),
      reservable: tags.reservation === "yes" ? true : tags.reservation === "no" ? false : null,
      commercial: false,
      dispersed,
      ingestSource: "03-osm",
      sourceIds: { osmType: el.type, osmId: el.id },
      urls: { detail: `https://www.openstreetmap.org/${el.type}/${el.id}` },
      amenities: {
        rv: tags.caravans === "yes",
        tent: tags.tents !== "no",
      },
    });

    if (landManager === "Unknown") addReview(rec, "unknown-land-manager", "UNKNOWN_MGR");
    if (!tags.name) addReview(rec, "missing-osm-name", "NO_NAME");
    if (rec.coordConfidence === "low") addReview(rec, "way-centroid-coords", "LOW_COORD");
    if (dispersed) addReview(rec, "dispersed-rules-verify", "DISPERSED");

    records.push(rec);
  }
  return records;
}

function bboxesForRetryPart(st, part) {
  const key = `${st}:${part}`;
  if (OSM_RETRY_SUBSPLIT[key]) return OSM_RETRY_SUBSPLIT[key];
  const split = OSM_SPLIT[st];
  if (split?.[part - 1]) return [split[part - 1]];
  return [];
}

/** Retry failed split halves; merge new sites into existing osm-{ST}.json. */
export async function retryOsmBboxes(specs = FAILED_BBOX_PARTS) {
  const outDir = ensureIngestDir("03-osm");

  for (const { st, part } of specs) {
    const boxes = bboxesForRetryPart(st, part);
    if (!boxes.length) {
      console.warn(`OSM ${st} part ${part}: no bbox defined`);
      continue;
    }

    const cachePath = path.join(outDir, `osm-${st}.json`);
    const existing = readJson(cachePath) || { state: st, records: [] };
    const seen = new Set();
    for (const r of existing.records || []) {
      const k = recordOsmKey(r);
      if (k) seen.add(k);
    }

    let elements = [];
    const totalParts = boxes.length;
    for (let i = 0; i < boxes.length; i++) {
      const bbox = boxes[i];
      const label =
        totalParts > 1
          ? `${st} part ${part} sub ${i + 1}/${totalParts} (retry)`
          : `${st} part ${part} (retry)`;
      console.log(`OSM ${label}: querying Overpass...`);
      try {
        const j = await overpassQuery(buildStateQuery(st, bbox));
        elements.push(...(j.elements || []));
        await sleep(8000);
      } catch (e) {
        console.warn(`OSM ${label}: failed —`, e.message);
      }
    }

    const added = elementsToRecords(st, elements, seen);
    const merged = [...(existing.records || []), ...added];
    writeJson(cachePath, {
      generated: new Date().toISOString(),
      state: st,
      elementCount: (existing.elementCount || 0) + elements.length,
      recordCount: merged.length,
      retriedPart: part,
      addedCount: added.length,
      records: merged,
    });
    console.log(`OSM ${st}: +${added.length} new (total ${merged.length})`);
    await sleep(5000);
  }

  const merged = mergeAllOsmCaches(outDir);
  const payload = {
    generated: new Date().toISOString(),
    source: "OpenStreetMap Overpass",
    recordCount: merged.allRecords.length,
    stateStats: merged.stateStats,
    records: merged.allRecords,
  };
  writeJson(path.join(outDir, "campgrounds.json"), payload);
  console.log("OSM ingest total:", payload.recordCount);
  return payload;
}

export async function ingestOsm(statesFilter = null) {
  const outDir = ensureIngestDir("03-osm");
  const states = statesFilter || Object.keys(STATE_BBOXES);
  const allRecords = [];
  const stateStats = {};

  for (const st of states) {
    if (!STATE_BBOXES[st] && !OSM_SPLIT[st]) continue;
    const cachePath = path.join(outDir, `osm-${st}.json`);
    const cached = readJson(cachePath);
    if (cached?.records?.length) {
      console.log(`OSM ${st}: cache hit (${cached.records.length})`);
      allRecords.push(...cached.records);
      stateStats[st] = { cached: true, count: cached.records.length };
      continue;
    }
    if (cached?.error) console.log(`OSM ${st}: retry after prior error`);

    const bboxes = OSM_SPLIT[st] || [STATE_BBOXES[st]];
    let elements = [];
    for (let bi = 0; bi < bboxes.length; bi++) {
      const bbox = bboxes[bi];
      const label = bboxes.length > 1 ? `${st} part ${bi + 1}/${bboxes.length}` : st;
      console.log(`OSM ${label}: querying Overpass...`);
      try {
        const j = await overpassQuery(buildStateQuery(st, bbox));
        elements.push(...(j.elements || []));
        await sleep(5000);
      } catch (e) {
        console.warn(`OSM ${label}: failed —`, e.message);
        stateStats[st] = { ...(stateStats[st] || {}), error: e.message };
      }
    }
    if (!elements.length && stateStats[st]?.error) {
      writeJson(cachePath, {
        generated: new Date().toISOString(),
        state: st,
        error: stateStats[st].error,
        records: [],
      });
      await sleep(3000);
      continue;
    }

    const seen = new Set();
    const records = elementsToRecords(st, elements, seen);

    writeJson(cachePath, {
      generated: new Date().toISOString(),
      state: st,
      elementCount: elements.length,
      recordCount: records.length,
      records,
    });
    allRecords.push(...records);
    stateStats[st] = { count: records.length, elements: elements.length };
    console.log(`OSM ${st}: ${records.length} records`);
    await sleep(8000);
  }

  const merged = mergeAllOsmCaches(outDir);
  const payload = {
    generated: new Date().toISOString(),
    source: "OpenStreetMap Overpass",
    recordCount: merged.allRecords.length,
    stateStats: merged.stateStats,
    records: merged.allRecords,
  };
  writeJson(path.join(outDir, "campgrounds.json"), payload);
  console.log("OSM ingest total:", payload.recordCount);
  return payload;
}

function parseStateArgs() {
  if (process.argv.includes("--retry-missing")) return [...MISSING_STATES_DEFAULT];
  const multi = process.argv.find((a) => a.startsWith("--states="));
  if (multi) return multi.split("=")[1].split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const one = process.argv.find((a) => a.startsWith("--state="));
  if (one) return [one.split("=")[1].toUpperCase()];
  return null;
}

function parseBboxRetryArgs() {
  const arg = process.argv.find((a) => a.startsWith("--retry-bbox="));
  if (!arg) return null;
  return arg
    .split("=")[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const [st, partStr] = pair.split(":");
      return { st: st.toUpperCase(), part: parseInt(partStr, 10) };
    })
    .filter((x) => x.st && x.part >= 1);
}

if (process.argv[1]?.endsWith("build-camping-us-ingest-osm.mjs")) {
  const bboxRetry = parseBboxRetryArgs();
  if (process.argv.includes("--retry-failed-bboxes") || bboxRetry) {
    await retryOsmBboxes(bboxRetry || FAILED_BBOX_PARTS);
  } else {
    await ingestOsm(parseStateArgs());
  }
}
