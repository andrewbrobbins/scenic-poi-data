/**
 * Shared helpers for OSM playground / scenic viewpoint / historic ingest.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { inferStateFromCoords } from "./camping-us-geo-utils.mjs";
import { PROVINCE_BBOXES } from "./camping-ca-province-bboxes.mjs";
export const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));

const HISTORIC_EXCLUDE = new Set([
  "boundary_stone",
  "milestone",
  "wayside_cross",
  "survey_point",
  "boundstone",
  "stone",
  "cattle_grid",
  "power_pole",
]);

export function shouldIncludeHistoric(tags) {
  if (!tags || !tags.historic) return false;
  const h = String(tags.historic).trim();
  const name = (tags.name || tags["name:en"] || tags["name:fr"] || "").trim();
  if (HISTORIC_EXCLUDE.has(h) && !name) return false;
  if (h === "yes" && !name) return false;
  return true;
}

export const POI_KINDS = {
  playground: {
    idPrefix: "PG",
    embedVar: "PLAYGROUNDS",
    defaultName: "Playground",
    masterBasename: "playgrounds",
    buildOverpassQuery(bbox) {
      const [s, w, n, e] = bbox;
      return `
[out:json][timeout:300];
(
  node["leisure"="playground"](${s},${w},${n},${e});
  way["leisure"="playground"](${s},${w},${n},${e});
);
out center tags;
`;
    },
  },
  viewpoint: {
    idPrefix: "SV",
    embedVar: "SCENIC",
    defaultName: "Scenic viewpoint",
    masterBasename: "scenic",
    buildOverpassQuery(bbox) {
      const [s, w, n, e] = bbox;
      return `
[out:json][timeout:300];
(
  node["tourism"="viewpoint"](${s},${w},${n},${e});
  way["tourism"="viewpoint"](${s},${w},${n},${e});
  relation["tourism"="viewpoint"](${s},${w},${n},${e});
);
out center tags;
`;
    },
  },
  historic: {
    idPrefix: "HL",
    embedVar: "HISTORIC",
    defaultName: "Historic site",
    masterBasename: "historic",
    buildOverpassQuery(bbox) {
      const [s, w, n, e] = bbox;
      return `
[out:json][timeout:300];
(
  node["historic"](${s},${w},${n},${e});
  way["historic"](${s},${w},${n},${e});
  relation["historic"](${s},${w},${n},${e});
);
out center tags;
`;
    },
  },
};

const GENERIC_NAMES = new Set([
  "playground",
  "scenic viewpoint",
  "viewpoint",
  "historic site",
  "historic building",
  "historic",
  "ruins",
  "memorial",
  "monument",
]);

export const OVERPASS_URLS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

export function slugify(s) {
  return (s || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
}

export function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  const b = fs.readFileSync(filePath);
  let text;
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) text = b.toString("utf16le");
  else if (b.length >= 2 && b[1] === 0x00) text = b.toString("utf16le");
  else text = b.toString("utf8");
  return JSON.parse(text);
}

export function coordValidUs(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat === 0 && lon === 0) return false;
  if (lat < 24 || lat > 72 || lon < -180 || lon > -65) return false;
  return true;
}

export function coordValidCa(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat === 0 && lon === 0) return false;
  if (lat < 41 || lat > 84 || lon < -141 || lon > -52) return false;
  return true;
}

export function elementCoords(el) {
  if (el.type === "node") return { lat: el.lat, lon: el.lon };
  if (el.center) return { lat: el.center.lat, lon: el.center.lon };
  return null;
}

export function osmElementKey(el) {
  const t = el.type || el.osmType || "node";
  const id = el.id != null ? el.id : el.osmId;
  return `${t}:${id}`;
}

export function inferProvinceFromCoords(lat, lon) {
  const hits = [];
  for (const [pr, bbox] of Object.entries(PROVINCE_BBOXES)) {
    const [s, w, n, e] = bbox;
    if (lat >= s && lat <= n && lon >= w && lon <= e) hits.push(pr);
  }
  if (!hits.length) return "";
  if (hits.length === 1) return hits[0];
  return hits[0];
}

export function inferRegionCode(lat, lon, regionLabel) {
  if (regionLabel === "US") return inferStateFromCoords(lat, lon) || "";
  if (regionLabel === "CA") return inferProvinceFromCoords(lat, lon) || "";
  return "";
}

export function poiDisplayName(tags, kindCfg) {
  return (tags?.name || tags?.["name:en"] || tags?.["name:fr"] || kindCfg.defaultName || "").trim();
}

export function qaTierForRecord(rec, kind) {
  const name = (rec.name || "").trim().toLowerCase();
  if (!name || GENERIC_NAMES.has(name)) return "qa";
  if (kind === "historic" && rec.subtype === "yes" && name === "historic site") return "qa";
  return "default";
}

export function ingestDir(region, kind) {
  const cfg = POI_KINDS[kind];
  if (!cfg) throw new Error("Unknown POI kind: " + kind);
  const d = path.join(TOOLS_DIR, `${cfg.masterBasename}-${region}-ingest`, "01-osm");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function masterPath(region, kind) {
  const cfg = POI_KINDS[kind];
  return path.join(TOOLS_DIR, `${cfg.masterBasename}-${region}-master.json`);
}

export function embedPath(region, kind) {
  const cfg = POI_KINDS[kind];
  return path.join(TOOLS_DIR, `${cfg.masterBasename}-${region}-explorer-embed.js`);
}

export async function overpassQuery(query, urlIndex = 0) {
  const url = OVERPASS_URLS[urlIndex % OVERPASS_URLS.length];
  const body = "data=" + encodeURIComponent(query);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "VancouverTripPOIDB/1.0 (playgrounds/viewpoints; local-dev)",
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

export function buildPoiRecord({ kind, kindCfg, regionLabel, osmType, osmId, lat, lon, tags, regionCode }) {
  const name = poiDisplayName(tags, kindCfg);
  const state = regionCode || inferRegionCode(lat, lon, regionLabel);
  const rec = {
    id: `${kindCfg.idPrefix}-${regionLabel}-${state || "XX"}-${slugify(name)}-${osmId}`,
    name,
    lat,
    lon,
    state: state || "",
    url: `https://www.openstreetmap.org/${osmType}/${osmId}`,
    osm: { type: osmType, id: osmId },
    displayTier: qaTierForRecord({ name, subtype: tags?.historic }, kind),
  };
  if (kind === "historic" && tags?.historic) rec.subtype = String(tags.historic);
  return rec;
}

export function elementsToRecords(regionCode, elements, kindCfg, regionLabel, coordValid, seen, kind) {
  const records = [];
  for (const el of elements) {
    const tags = el.tags || {};
    const coords = elementCoords(el);
    if (!coords || !coordValid(coords.lat, coords.lon)) continue;
    const key = osmElementKey(el);
    if (seen.has(key)) continue;
    seen.add(key);

    records.push(
      buildPoiRecord({
        kind,
        kindCfg,
        regionLabel,
        osmType: el.type,
        osmId: el.id,
        lat: coords.lat,
        lon: coords.lon,
        tags,
        regionCode,
      })
    );
  }
  return records;
}

export function featuresToRecords(features, kind, kindCfg, regionLabel, coordValid, seen, stateFilter) {
  const records = [];
  for (const feat of features) {
    const coords = featureCoords(feat);
    if (!coords || !coordValid(coords.lat, coords.lon)) continue;
    const props = feat.properties || {};
    const osmType = props.type || feat.osmType || "node";
    const osmId = props.id != null ? props.id : feat.osmId;
    if (osmId == null) continue;
    const key = `${osmType}:${osmId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const tags = props.tags || feat.tags || props;
    const regionCode = inferRegionCode(coords.lat, coords.lon, regionLabel);
    if (stateFilter && regionCode !== stateFilter) continue;

    records.push(
      buildPoiRecord({
        kind,
        kindCfg,
        regionLabel,
        osmType,
        osmId,
        lat: coords.lat,
        lon: coords.lon,
        tags,
        regionCode,
      })
    );
  }
  return records;
}

export function featureCoords(feat) {
  if (!feat) return null;
  if (Number.isFinite(feat.lat) && Number.isFinite(feat.lon)) {
    return { lat: feat.lat, lon: feat.lon };
  }
  const g = feat.geometry;
  if (!g) return null;
  if (g.type === "Point" && g.coordinates?.length >= 2) {
    return { lat: g.coordinates[1], lon: g.coordinates[0] };
  }
  if (g.type === "Polygon" && g.coordinates?.[0]?.length) {
    return centroidOfRing(g.coordinates[0]);
  }
  if (g.type === "MultiPolygon" && g.coordinates?.[0]?.[0]?.length) {
    return centroidOfRing(g.coordinates[0][0]);
  }
  if (g.type === "LineString" && g.coordinates?.length) {
    const mid = g.coordinates[Math.floor(g.coordinates.length / 2)];
    return { lat: mid[1], lon: mid[0] };
  }
  return null;
}

function centroidOfRing(ring) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const c of ring) {
    if (!c || c.length < 2) continue;
    sx += c[0];
    sy += c[1];
    n += 1;
  }
  if (!n) return null;
  return { lat: sy / n, lon: sx / n };
}

export function toEmbedRow(r) {
  const row = {
    id: r.id,
    name: r.name,
    lat: r.lat,
    lon: r.lon,
    state: r.state || "",
    url: r.url || "",
  };
  if (r.subtype) row.subtype = r.subtype;
  if (r.parkName) row.parkName = r.parkName;
  return row;
}
