/**
 * Shared official-source ↔ OSM reconcile helpers for fuel masters.
 */
import fs from "fs";
import { FUEL_TYPE_TRAVEL_PLAZA, normalizeFuelType } from "./fuel-brand-lib.mjs";
import path from "path";
import { haversineMi, readJson, slugify, writeJson } from "./fuel-us-lib.mjs";

export const USER_AGENT = "ScenicRouterFuelOfficial/1.0 (+https://github.com/andrewbrobbins/scenic-poi-data)";
export const DEFAULT_MATCH_MI = 0.5;
export const DEDUPE_MI = 0.12;

export function osmKey(rec) {
  if (!rec.osm) return rec.id;
  return `${rec.osm.type}:${rec.osm.id}`;
}

export function greedyMatch(osmRecords, officialStores, matchMi = DEFAULT_MATCH_MI) {
  const pairs = [];
  for (let oi = 0; oi < osmRecords.length; oi++) {
    for (let fi = 0; fi < officialStores.length; fi++) {
      const d = haversineMi(
        [osmRecords[oi].lat, osmRecords[oi].lon],
        [officialStores[fi].lat, officialStores[fi].lon]
      );
      if (d <= matchMi) pairs.push({ oi, fi, d });
    }
  }
  pairs.sort((a, b) => a.d - b.d);

  const usedOsm = new Set();
  const usedOfficial = new Set();
  const matched = [];

  for (const p of pairs) {
    if (usedOsm.has(p.oi) || usedOfficial.has(p.fi)) continue;
    usedOsm.add(p.oi);
    usedOfficial.add(p.fi);
    matched.push({
      osm: osmRecords[p.oi],
      official: officialStores[p.fi],
      distanceMi: Math.round(p.d * 1000) / 1000,
    });
  }

  return {
    matched,
    osmOnly: osmRecords.filter((_, i) => !usedOsm.has(i)),
    officialOnly: officialStores.filter((_, i) => !usedOfficial.has(i)),
  };
}

export function nearestOfficial(osm, officialStores) {
  let nearestMi = null;
  let nearest = null;
  for (const off of officialStores) {
    const d = haversineMi([osm.lat, osm.lon], [off.lat, off.lon]);
    if (nearestMi == null || d < nearestMi) {
      nearestMi = d;
      nearest = off;
    }
  }
  return { nearestMi, nearest };
}

export function rejectRecord(osm, officialStores) {
  const { nearestMi, nearest } = nearestOfficial(osm, officialStores);
  return {
    brandId: osm.brandId,
    osmKey: osmKey(osm),
    reason: "no-official-match",
    nearestOfficialMi: nearestMi == null ? null : Math.round(nearestMi * 1000) / 1000,
    nearestOfficial: nearest
      ? { officialId: nearest.officialId, label: nearest.label, city: nearest.city, state: nearest.state }
      : null,
    record: {
      id: osm.id,
      name: osm.name,
      lat: osm.lat,
      lon: osm.lon,
      state: osm.state,
      osm: osm.osm,
      osmTags: osm.osmTags,
      url: osm.url,
    },
  };
}

export function supplementFromOfficial(store, region) {
  const name = store.label || `Official — ${store.city || store.officialId}`;
  const state = store.state || "XX";
  const id = `FUEL-${store.brandId.toUpperCase()}-${state}-${slugify(store.city || "site")}-${slugify(
    store.street || store.officialId || "official"
  )}-supp`;
  return {
    id,
    name,
    brand: store.brand || store.brandId,
    brandId: store.brandId,
    brandTier: "A",
    type: normalizeFuelType(store.type),
    state,
    lat: store.lat,
    lon: store.lon,
    highway: store.highway || "",
    fuels: store.fuels || { gasoline: true, diesel: false },
    sources: ["supplement", store.sourceTag || "official"],
    mapFlags: ["SUPPLEMENT"],
    reviewReasons: [],
    needsReview: false,
    manualVerified: true,
    officialId: store.officialId,
    officialStreet: store.street || "",
    url: store.url || store.sourceUrl || "",
    region,
  };
}

export function dedupeSupplements(records) {
  const out = [];
  for (const rec of records) {
    let dup = false;
    for (const existing of out) {
      if (haversineMi([rec.lat, rec.lon], [existing.lat, existing.lon]) <= DEDUPE_MI) {
        dup = true;
        break;
      }
    }
    if (!dup) out.push(rec);
  }
  return out;
}

export function reconcileBrand(osmRecords, officialPayload, opts = {}) {
  const matchMi = opts.matchMi ?? DEFAULT_MATCH_MI;
  const stores = officialPayload.stores || [];
  const { matched, osmOnly, officialOnly } = greedyMatch(osmRecords, stores, matchMi);
  const rejects = osmOnly.map((osm) => rejectRecord(osm, stores));
  const supplements = dedupeSupplements(
    officialOnly.map((s) =>
      supplementFromOfficial(
        {
          ...s,
          brandId: s.brandId || officialPayload.brandId,
          sourceTag: officialPayload.sourceTag || officialPayload.source,
        },
        opts.region
      )
    )
  );
  return {
    brandId: officialPayload.brandId,
    source: officialPayload.source,
    sourceType: officialPayload.sourceType,
    officialCount: stores.length,
    osmCount: osmRecords.length,
    matchedCount: matched.length,
    rejectedCount: rejects.length,
    supplementCount: supplements.length,
    matchRadiusMi: matchMi,
    matched,
    rejects,
    supplements,
  };
}

export async function fetchText(url, opts = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, ...(opts.headers || {}) },
    signal: AbortSignal.timeout(opts.timeoutMs || 60000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

export function readCache(cachePath) {
  return readJson(cachePath, null);
}

export function writeCache(cachePath, data) {
  writeJson(cachePath, data);
  return data;
}

export function cachePath(baseDir, key) {
  const safe = key.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
  return path.join(baseDir, `${safe}.json`);
}

export function loadOsmBrandCandidates({ mergedPath, masterPath, brandIds }) {
  const ids = new Set(brandIds);
  if (fs.existsSync(mergedPath)) {
    const merged = readJson(mergedPath);
    return {
      source: mergedPath,
      records: (merged.records || []).filter((r) => ids.has(r.brandId)),
    };
  }
  const master = readJson(masterPath);
  const fromMaster = (master?.records || []).filter((r) => ids.has(r.brandId) && r.osm);
  if (fromMaster.length) {
    return { source: masterPath, records: fromMaster };
  }
  return { source: mergedPath, records: [] };
}

export function parseGoogleMapsCoords(html) {
  const m =
    html.match(/google\.com\/maps[^"']*[@!]3d(-?\d+\.\d+)[^"']*!4d(-?\d+\.\d+)/i) ||
    html.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) ||
    html.match(/destination=(-?\d+\.\d+)%2C(-?\d+\.\d+)/i) ||
    html.match(/@(-?\d+\.\d+),(-?\d+\.\d+),/);
  if (!m) return null;
  return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
}

export function parseIrvingCoords(html) {
  const lat = html.match(/<div class="field__item">(-?\d+\.\d+)<\/div>[\s\S]{0,200}?Longitude/s);
  const lon = html.match(/Longitude[\s\S]{0,200}?<div class="field__item">(-?\d+\.\d+)<\/div>/s);
  if (lat && lon) return { lat: parseFloat(lat[1]), lon: parseFloat(lon[1]) };
  return parseGoogleMapsCoords(html);
}

export function parsePilotYextCoords(html) {
  const m = html.match(/yextDisplayCoordinate":\{"lat":(-?\d+\.?\d*),"long":(-?\d+\.?\d*)\}/);
  if (!m) return null;
  return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
}

export { parsePilotYextFacility } from "./fuel-travel-center-lib.mjs";

export function parsePilotBrand(html) {
  if (/Flying J Travel/i.test(html) && !/Pilot Travel Center/i.test(html)) return "flyingj";
  if (/Flying J/i.test(html) && /Pilot Flying J/i.test(html)) return "pilot_flyingj";
  if (/Flying J/i.test(html)) return "flyingj";
  return "pilot";
}

export function stateFromPilotUrl(url) {
  const p = new URL(url).pathname.split("/").filter(Boolean);
  if (p[0] === "us" || p[0] === "ca") return p[1]?.toUpperCase() || "";
  return "";
}
