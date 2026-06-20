/**
 * Shared helpers for state / provincial park unit catalog (SP-001).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { inferStateFromCoords } from "./camping-us-geo-utils.mjs";
import { inferStateFromCoords as inferProvinceFromCoords } from "./camping-ca-geo-utils.mjs";

export const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const INGEST_DIR = path.join(TOOLS_DIR, "state-parks-ingest");
export const MASTER_US_PATH = path.join(TOOLS_DIR, "state-parks-us-master.json");
export const MASTER_CA_PATH = path.join(TOOLS_DIR, "state-parks-ca-master.json");
export const QA_PATH = path.join(TOOLS_DIR, "state-parks-qa.json");
export const EMBED_US_PATH = path.join(TOOLS_DIR, "state-parks-us-explorer-embed.js");
export const EMBED_CA_PATH = path.join(TOOLS_DIR, "state-parks-ca-explorer-embed.js");

export const US_STATES =
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");

export const CA_PROVINCES = "AB BC MB NB NL NS NT NU ON PE QC SK YT".split(" ");

export const DEDUPE_RADIUS_M = 500;

const FEDERAL_EXCLUDE =
  /national park service|\bnps\b|u\.?s\.?\s*forest service|\busfs\b|bureau of land management|\bblm\b|fish and wildlife|\busfws\b|army corps|parks canada|parcs canada|pc\.gc\.ca|national park of canada|parc national du canada/i;

const US_EXCLUDE_NAME =
  /\b(national park|national monument|national forest|national wildlife|national recreation area|national seashore|national lakeshore|county park|city park|municipal park|regional park|metro park|township park|state forest|state game land|state wildlife area|state fish hatchery|state nursery|state natural area)\b/i;

const US_INCLUDE_NAME =
  /\bstate park\b|\bstate historic (site|park|area|monument|preserve|landmark)\b|\bstate historical (site|park|area)\b|\bstate heritage (site|park)\b|\bstate memorial\b/i;

const US_STATE_OPERATOR =
  /state parks|state park system|dept\.? of natural resources|\bdnr\b|parks and wildlife|division of parks|department of conservation|office of parks|bureau of state parks|state recreation and parks|state dept of parks/i;

const CA_EXCLUDE_NAME =
  /\b(national park|national forest|parc national|forêt nationale|county park|city park|municipal park|regional park|provincial forest|provincial recreation area)\b/i;

const CA_INCLUDE_NAME =
  /\bprovincial park\b|\bparc provincial\b|\bprovincial historic (site|park)\b|\bsite historique provincial\b|\bprovincial heritage (site|park)\b|\bprovincial marine park\b|\bparc marin provincial\b/i;

const CA_PROVINCIAL_OPERATOR =
  /bc parks|british columbia parks|ontario parks|alberta parks|sepaq|parcs qu[eé]bec|saskatchewan parks|manitoba parks|novascotia\.ca\/parks|gnb\.ca\/parks|newfoundlandlabrador\.com\/parks|gov\.pe\.ca\/parks|gov\.nl\.ca\/parks|gov\.nt\.ca|gov\.nu\.ca|gov\.yk\.ca|ministry of environment|ministry of tourism/i;

export function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  const raw = fs.readFileSync(filePath);
  if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
    return JSON.parse(raw.toString("utf16le"));
  }
  return JSON.parse(raw.toString("utf8"));
}

export function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

export function slugify(s) {
  return (s || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

export function coordValid(lat, lon, country) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat === 0 && lon === 0) return false;
  if (country === "CA") {
    if (lat < 41 || lat > 84 || lon < -141 || lon > -52) return false;
    return true;
  }
  if (lat < 18 || lat > 72 || lon < -180 || lon > -65) return false;
  return true;
}

export function haversineM(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function normalizeName(name) {
  return (name || "")
    .toLowerCase()
    .replace(/\bstate park\b/g, "")
    .replace(/\bprovincial park\b/g, "")
    .replace(/\bparc provincial\b/g, "")
    .replace(/\bstate historic site\b/g, "")
    .replace(/\bprovincial historic site\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function tagBlob(tags) {
  return [
    tags.operator,
    tags.brand,
    tags.owner,
    tags["operator:fr"],
    tags.name,
    tags["name:en"],
    tags["name:fr"],
    tags.protection_title,
    tags.protect_class,
    tags.description,
    tags.website,
  ]
    .filter(Boolean)
    .join(" ");
}

export function pickName(tags) {
  return (tags.name || tags["name:en"] || tags["name:fr"] || "").trim();
}

export function isFederalOrOutOfScope(tags, country) {
  const name = pickName(tags);
  const blob = tagBlob(tags);
  const n = name.toLowerCase();

  if (FEDERAL_EXCLUDE.test(blob)) return true;
  if (tags.boundary === "national_park" || tags.protect_class === "2") return true;
  if (country === "CA" && /parc national|national park of canada/i.test(n + " " + blob) && !/provincial/i.test(n)) {
    return true;
  }
  if (country === "US" && US_EXCLUDE_NAME.test(name) && !/historic/i.test(name)) return true;
  if (country === "CA" && CA_EXCLUDE_NAME.test(name) && !/historic|heritage|historique/i.test(name)) return true;

  if (country === "US" && /\bstate recreation area\b/i.test(name) && !/historic/i.test(name)) return true;

  return false;
}

export function classifyUnit(tags, country) {
  if (isFederalOrOutOfScope(tags, country)) return null;

  const name = pickName(tags);
  if (!name) return null;

  const blob = tagBlob(tags);
  const n = name.toLowerCase();

  if (country === "US") {
    if (US_INCLUDE_NAME.test(name)) {
      const category = /historic|heritage|memorial|historical/i.test(name) ? "historic_site" : "park";
      const designation = category === "historic_site" ? inferUsDesignation(name) : "State Park";
      return { category, designation, confidence: "name" };
    }
    if (US_STATE_OPERATOR.test(blob) && (tags.boundary === "protected_area" || tags.leisure === "nature_reserve")) {
      const category = /historic|heritage|memorial|historical/i.test(name) ? "historic_site" : "park";
      return {
        category,
        designation: category === "historic_site" ? inferUsDesignation(name) : "State Park",
        confidence: "operator",
        needsReview: true,
      };
    }
    if (tags.protection_title && /state park|state historic/i.test(tags.protection_title)) {
      const category = /historic/i.test(tags.protection_title) ? "historic_site" : "park";
      return { category, designation: tags.protection_title, confidence: "protection_title" };
    }
    return null;
  }

  if (country === "CA") {
    if (CA_INCLUDE_NAME.test(name) || CA_INCLUDE_NAME.test(blob)) {
      const category = /historic|heritage|historique/i.test(name + " " + blob) ? "historic_site" : "park";
      const designation = category === "historic_site" ? inferCaDesignation(name) : "Provincial Park";
      return { category, designation, confidence: "name" };
    }
    if (CA_PROVINCIAL_OPERATOR.test(blob) && (tags.boundary === "protected_area" || tags.leisure === "nature_reserve")) {
      const category = /historic|heritage|historique/i.test(name) ? "historic_site" : "park";
      return {
        category,
        designation: category === "historic_site" ? inferCaDesignation(name) : "Provincial Park",
        confidence: "operator",
        needsReview: true,
      };
    }
    return null;
  }

  return null;
}

function inferUsDesignation(name) {
  if (/state historical park/i.test(name)) return "State Historical Park";
  if (/state historic park/i.test(name)) return "State Historic Park";
  if (/state heritage park/i.test(name)) return "State Heritage Park";
  if (/state memorial/i.test(name)) return "State Memorial";
  return "State Historic Site";
}

function inferCaDesignation(name) {
  if (/site historique provincial/i.test(name)) return "Site historique provincial";
  if (/provincial heritage park/i.test(name)) return "Provincial Heritage Park";
  if (/provincial historic park/i.test(name)) return "Provincial Historic Park";
  return "Provincial Historic Site";
}

export function inferAdminRegion(lat, lon, country) {
  if (country === "CA") return inferProvinceFromCoords(lat, lon);
  return inferStateFromCoords(lat, lon);
}

export function unitId(country, admin, name, osmType, osmId) {
  const cc = country.toLowerCase();
  const st = (admin || "xx").toLowerCase();
  const base = slugify(name) || "unit";
  const suffix = osmId ? `-${osmType || "n"}${osmId}` : "";
  return `sp-${cc}-${st}-${base}${suffix}`.slice(0, 80);
}

export function pickUrl(tags) {
  const w = (tags.website || tags["contact:website"] || tags.url || "").trim();
  if (w && /^https?:\/\//i.test(w)) return w;
  return "";
}

export function pickOfficialCode(tags) {
  const ref = (tags.ref || tags["ref:US:state_park"] || tags["protected_area:ref"] || "").trim();
  return ref || null;
}

export function elementCoords(el) {
  if (el.type === "node") return { lat: el.lat, lon: el.lon };
  if (el.center) return { lat: el.center.lat, lon: el.center.lon };
  return null;
}

export function osmRecordFromElement(el, country, adminHint) {
  const tags = el.tags || {};
  const cls = classifyUnit(tags, country);
  if (!cls) return null;

  const name = pickName(tags);
  const coords = elementCoords(el);
  if (!coords) return null;

  const admin = adminHint || inferAdminRegion(coords.lat, coords.lon, country);
  if (!admin) return null;

  const needsReview = !!cls.needsReview;
  const reviewReasons = [];
  if (cls.confidence === "operator") reviewReasons.push("operator-inferred");
  if (!pickUrl(tags)) reviewReasons.push("missing-url");

  return {
    id: unitId(country, admin, name, el.type, el.id),
    country,
    state: admin,
    name,
    designation: cls.designation,
    category: cls.category,
    lat: Math.round(coords.lat * 1e5) / 1e5,
    lon: Math.round(coords.lon * 1e5) / 1e5,
    source: "osm",
    needsReview: needsReview || reviewReasons.length > 0,
    reviewReasons,
    url: pickUrl(tags) || undefined,
    osmId: `${el.type}/${el.id}`,
    officialCode: pickOfficialCode(tags) || undefined,
    osmConfidence: cls.confidence,
  };
}

export function dedupeKey(rec) {
  return `${rec.country}::${rec.state}::${normalizeName(rec.name)}`;
}

export function recordRank(rec) {
  let score = 0;
  if (rec.url) score += 20;
  if (rec.officialCode) score += 15;
  if (rec.osmId?.startsWith("relation/")) score += 10;
  else if (rec.osmId?.startsWith("way/")) score += 5;
  if (!rec.needsReview) score += 8;
  if (rec.osmConfidence === "name" || rec.osmConfidence === "protection_title") score += 6;
  return score;
}

export function mergeRecords(records) {
  const byKey = new Map();
  const conflicts = [];

  for (const rec of records) {
    const key = dedupeKey(rec);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, rec);
      continue;
    }

    const dist = haversineM({ lat: prev.lat, lon: prev.lon }, { lat: rec.lat, lon: rec.lon });
    if (dist <= DEDUPE_RADIUS_M) {
      const winner = recordRank(rec) >= recordRank(prev) ? rec : prev;
      const loser = winner === rec ? prev : rec;
      winner.mergeSources = [...new Set([...(winner.mergeSources || [winner.source]), loser.source, rec.source].filter(Boolean))];
      if (loser.osmId && loser.osmId !== winner.osmId) {
        winner.altOsmIds = [...new Set([...(winner.altOsmIds || []), loser.osmId])];
      }
      if (!winner.url && loser.url) winner.url = loser.url;
      if (!winner.officialCode && loser.officialCode) winner.officialCode = loser.officialCode;
      byKey.set(key, winner);
      continue;
    }

    conflicts.push({
      key,
      a: { id: prev.id, name: prev.name, lat: prev.lat, lon: prev.lon, osmId: prev.osmId },
      b: { id: rec.id, name: rec.name, lat: rec.lat, lon: rec.lon, osmId: rec.osmId },
      distanceM: Math.round(dist),
    });
    const idKey = `${key}::${rec.osmId || rec.id}`;
    byKey.set(idKey, rec);
  }

  return { records: [...byKey.values()], conflicts };
}

export function countByAdmin(records) {
  const out = {};
  for (const r of records) {
    out[r.state] = (out[r.state] || 0) + 1;
  }
  return out;
}

export function countByCategory(records) {
  const out = {};
  for (const r of records) {
    out[r.category] = (out[r.category] || 0) + 1;
  }
  return out;
}
