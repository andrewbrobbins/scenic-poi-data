/**
 * Shared helpers for Parks Canada unit catalog (PC-001) and visitor centers (VC-CA-001).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fetchArcgisAllFeatures, readJson, writeJson, slugify } from "./camping-ca-lib.mjs";
import { inferStateFromCoords } from "./camping-ca-geo-utils.mjs";

export const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const GEO_PATH = path.join(TOOLS_DIR, "parks-canada-geo.json");
export const EMBED_PATH = path.join(TOOLS_DIR, "parks-canada-explorer-embed.js");
export const APCA_PLACES_QUERY =
  "https://services2.arcgis.com/wCOMu5IS7YdSyPNx/arcgis/rest/services/vw_Places_Public_lieux_public_APCA/FeatureServer/0/query";
export const PC_FACILITIES_QUERY =
  "https://services2.arcgis.com/wCOMu5IS7YdSyPNx/arcgis/rest/services/vw_Facilities_Installations_Point_V2_FGP/FeatureServer/0/query";

export { fetchArcgisAllFeatures, readJson, writeJson, slugify };

export function coordValid(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat === 0 && lon === 0) return false;
  if (lat < 41 || lat > 84 || lon < -141 || lon > -52) return false;
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

export function normalizePcName(name) {
  return (name || "")
    .replace(/\s+of Canada$/i, "")
    .replace(/\s+du Canada$/i, "")
    .replace(/\s+National (Park|Historic Site|Park Reserve|Marine Conservation Area).*$/i, "")
    .replace(/\s+Parc national.*$/i, "")
    .replace(/\s+Lieu historique national.*$/i, "")
    .replace(/\s+Réserve de parc national.*$/i, "")
    .replace(/\s+Zone marine nationale de conservation.*$/i, "")
    .trim()
    .toLowerCase();
}

export function parkCodeFromPlaceName(descEn) {
  const base = normalizePcName(descEn);
  return slugify(base) || "pc";
}

export function pcCategory(placeType) {
  const t = (placeType || "").toLowerCase();
  if (t.includes("national park reserve") || (t.includes("national park") && !t.includes("historic"))) return "park";
  if (t.includes("historic site")) return "historic_site";
  if (t.includes("marine conservation")) return "marine";
  return "other";
}

export function pcUrlFromName(descEn, province) {
  const code = parkCodeFromPlaceName(descEn);
  const pr = (province || "").toLowerCase();
  if (pr && code) return `https://parks.canada.ca/pn-np/${pr}/${code}`;
  return "https://parks.canada.ca/";
}

export function parkSlugFromPcUrl(url) {
  const m = (url || "").match(/(?:pc\.gc\.ca|parks\.canada\.ca)\/(?:en|fr)\/pn-np\/[a-z]{2}\/([^/?#]+)/i);
  if (m) return m[1].toLowerCase();
  const m2 = (url || "").match(/parks\.canada\.ca\/pn-np\/[a-z]{2}\/([^/?#]+)/i);
  return m2 ? m2[1].toLowerCase() : "";
}

export function centroidFromEsriGeometry(geom) {
  if (!geom) return null;
  if (geom.x != null && geom.y != null) return { lat: geom.y, lon: geom.x };
  const ring = geom.rings?.[0];
  if (!ring?.length) return null;
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
  if (!Number.isFinite(south)) return null;
  return { lat: (south + north) / 2, lon: (west + east) / 2 };
}

export function loadPcUnitMaps() {
  const geo = readJson(GEO_PATH, { units: [] });
  const byCode = new Map();
  const byNameKey = new Map();
  const bySlug = new Map();
  for (const u of geo.units || []) {
    byCode.set(String(u.parkCode).toLowerCase(), u);
    const key = normalizePcName(u.name);
    if (key) byNameKey.set(key, u);
    if (u.nameFr) {
      const frKey = normalizePcName(u.nameFr);
      if (frKey) byNameKey.set(frKey, u);
    }
    if (u.baid) byCode.set(String(u.baid), u);
  }
  return { byCode, byNameKey, bySlug, units: geo.units || [] };
}

export function resolveParentUnit({ parkCode, parkSlug, name, lat, lon }, maps) {
  const code = (parkCode || "").toLowerCase();
  if (code && maps.byCode.has(code)) {
    const u = maps.byCode.get(code);
    return parentFromUnit(u);
  }
  const slug = (parkSlug || "").toLowerCase();
  if (slug && maps.byCode.has(slug)) return parentFromUnit(maps.byCode.get(slug));

  const nameKey = normalizePcName(name);
  if (nameKey && maps.byNameKey.has(nameKey)) return parentFromUnit(maps.byNameKey.get(nameKey));

  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    let best = null;
    let bestD = Infinity;
    for (const u of maps.units) {
      const d = haversineM({ lat, lon }, { lat: u.lat, lon: u.lon });
      if (d < bestD && d <= 80000) {
        best = u;
        bestD = d;
      }
    }
    if (best) return parentFromUnit(best);
  }

  return {
    system: "pc",
    parkCode: code || slug || "pc",
    name: name || code || "Parks Canada unit",
    designation: "",
    category: "other",
  };
}

function parentFromUnit(u) {
  return {
    system: "pc",
    parkCode: u.parkCode,
    baid: u.baid,
    name: u.name,
    designation: u.designation || "",
    category: u.category || "other",
  };
}

export function isVisitorCentreFacilityType(facilityType) {
  const t = (facilityType || "").toLowerCase();
  return t.includes("visitor centre") || t.includes("centre d'accueil") || t.includes("centre des visiteurs");
}
