/**
 * Official locators for additional US tier-A fuel brands.
 */
import fs from "fs";
import path from "path";
import {
  cachePath,
  fetchText,
  geocodeNominatim,
  isCefcoLargeFormatHtml,
  parseCefcoLocationAddress,
  parseDaddrCoords,
  parseLeafletMapMarkers,
  readCache,
  USER_AGENT,
  writeCache,
} from "./fuel-official-reconcile-lib.mjs";
import { coordValid, sleep } from "./fuel-us-lib.mjs";
import { FUEL_TYPE_TRAVEL_PLAZA, normalizeFuelType } from "./fuel-brand-lib.mjs";
import { inferFuelType } from "./fuel-type-infer.mjs";

const KWIK_TRIP_MAX_STORE_NUM = 1400;
const QUICKCHEK_SEEDS = [
  [40.7, -74.0],
  [41.0, -73.5],
  [40.5, -74.5],
  [40.2, -74.8],
  [40.9, -72.8],
  [41.3, -73.2],
  [41.5, -74.0],
  [40.3, -73.7],
  [40.8, -73.0],
  [41.1, -74.2],
];

function storeRow(partial) {
  return {
    officialId: partial.officialId || "",
    label: partial.label || "",
    brandId: partial.brandId,
    brand: partial.brand || partial.brandId,
    city: partial.city || "",
    state: partial.state || "",
    street: partial.street || "",
    lat: partial.lat,
    lon: partial.lon,
    type: normalizeFuelType(partial.type),
    sourceUrl: partial.sourceUrl || "",
    url: partial.url || partial.sourceUrl || "",
  };
}

function kwikTripBrandId(name) {
  return /KWIK\s*STAR/i.test(name || "") ? "kwikstar" : "kwiktrip";
}

export async function fetchKwikTripOfficial(cacheDir, opts = {}) {
  const brandFilter = opts.brandId || null;
  const cacheFile = cacheDir ? path.join(cacheDir, `kwiktrip-official${brandFilter ? `-${brandFilter}` : ""}.json`) : null;
  if (cacheFile && fs.existsSync(cacheFile)) {
    const cached = readCache(cacheFile);
    if (cached?.stores?.length) return cached;
  }

  const maxNum = opts.maxStoreNum || KWIK_TRIP_MAX_STORE_NUM;
  const stores = [];
  const errors = [];

  for (let n = 1; n <= maxNum; n++) {
    const cp = cacheDir ? cachePath(cacheDir, `kt-store-${n}`) : null;
    let row = cp ? readCache(cp) : null;
    if (!row) {
      try {
        const res = await fetch(`https://api.kwiktrip.com/api/location/store/information/${n}`, {
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(20000),
        });
        if (res.status === 204 || res.status === 404) continue;
        if (!res.ok) {
          errors.push({ n, reason: `HTTP ${res.status}` });
          continue;
        }
        const j = await res.json();
        if (!Array.isArray(j.fuel) || !j.fuel.length) continue;
        if (!/KWIK\s*(TRIP|STAR)/i.test(j.name || "")) continue;
        const addr = j.address || {};
        if (!coordValid(addr.latitude, addr.longitude)) continue;
        row = {
          officialId: String(j.storeNumber || n),
          label: j.name || `Kwik Trip #${n}`,
          brandId: kwikTripBrandId(j.name),
          city: addr.city || "",
          state: addr.state || "",
          street: addr.address1 || "",
          lat: addr.latitude,
          lon: addr.longitude,
          sourceUrl: "https://api.kwiktrip.com/api/location/store/information",
        };
        if (cp) writeCache(cp, row);
        if (n % 25 === 0) await sleep(40);
      } catch (e) {
        errors.push({ n, reason: String(e.message || e) });
        continue;
      }
    }
    if (brandFilter && row.brandId !== brandFilter) continue;
    stores.push(
      storeRow({
        ...row,
        brand: row.brandId === "kwikstar" ? "Kwik Star" : "Kwik Trip",
        type: "convenience_fuel",
      })
    );
  }

  const payload = {
    brandId: brandFilter || "kwiktrip",
    source: "https://api.kwiktrip.com/api/location/store/information/{storeNumber}",
    sourceType: "locator-api",
    sourceTag: "kwiktrip-official",
    storeCount: stores.length,
    meta: { scannedStoreNumbers: maxNum, errors: errors.length },
    errors: errors.slice(0, 20),
    stores,
  };
  if (cacheFile) {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    writeCache(cacheFile, payload);
  }
  return payload;
}

export async function fetchRoyalFarmsOfficial(cacheDir) {
  const cacheFile = cacheDir ? path.join(cacheDir, "royal-farms-official.json") : null;
  if (cacheFile && fs.existsSync(cacheFile)) {
    const cached = readCache(cacheFile);
    if (cached?.stores?.length) return cached;
  }

  const res = await fetch("https://storelocator.royalfarms.com/api/stores", {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`Royal Farms API HTTP ${res.status}`);
  const data = await res.json();
  const raw = data.stores || data;
  const stores = [];
  for (const s of raw) {
    const lat = s.coordinates?.lat ?? s.latitude;
    const lon = s.coordinates?.lng ?? s.longitude;
    if (!coordValid(lat, lon)) continue;
    if (s.capabilities?.fuel === false) continue;
    const addr = s.address || {};
    stores.push(
      storeRow({
        officialId: s.storeNumber || s.id || addr.full,
        label: `Royal Farms #${s.storeNumber || ""} — ${addr.city || ""}, ${addr.state || ""}`.trim(),
        brandId: "royal_farms",
        brand: "Royal Farms",
        city: addr.city || "",
        state: addr.state || "",
        street: addr.line1 || addr.full || "",
        lat,
        lon,
        type: "convenience_fuel",
        sourceUrl: "https://storelocator.royalfarms.com/api/stores",
      })
    );
  }

  const payload = {
    brandId: "royal_farms",
    source: "https://storelocator.royalfarms.com/api/stores",
    sourceType: "locator-api",
    sourceTag: "royalfarms-official",
    storeCount: stores.length,
    meta: { apiStoreCount: raw.length },
    stores,
  };
  if (cacheFile) {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    writeCache(cacheFile, payload);
  }
  return payload;
}

export async function fetchQuickChekOfficial(cacheDir) {
  const cacheFile = cacheDir ? path.join(cacheDir, "quickchek-official.json") : null;
  if (cacheFile && fs.existsSync(cacheFile)) {
    const cached = readCache(cacheFile);
    if (cached?.stores?.length) return cached;
  }

  const byId = new Map();
  for (const [lat, lng] of QUICKCHEK_SEEDS) {
    const body = new URLSearchParams({
      action: "get_sorted_locations",
      dist: "500",
      lat: String(lat),
      lng: String(lng),
    });
    const res = await fetch("https://quickchek.com/wp-admin/admin-ajax.php", {
      method: "POST",
      headers: { "User-Agent": USER_AGENT, "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`QuickChek AJAX HTTP ${res.status}`);
    const text = await res.text();
    let rows;
    try {
      rows = JSON.parse(text);
    } catch {
      rows = [];
    }
    for (const s of rows || []) {
      const hasFuel =
        s.fuelHours ||
        (Array.isArray(s.services) && s.services.some((u) => /Gasoline/i.test(u || "")));
      if (!hasFuel) continue;
      if (!coordValid(s.lat, s.lng)) continue;
      byId.set(String(s.ID), s);
    }
    await sleep(200);
  }

  const stores = [...byId.values()].map((s) => {
    const parts = String(s.address || "").split(",").map((x) => x.trim());
    const city = parts.length >= 2 ? parts[parts.length - 2] : "";
    const stateZip = parts[parts.length - 1] || "";
    const state = stateZip.split(/\s+/)[0] || "";
    return storeRow({
      officialId: String(s.ID),
      label: s.title || `QuickChek #${s.ID}`,
      brandId: "quickchek",
      brand: "QuickChek",
      city,
      state,
      street: parts[0] || "",
      lat: s.lat,
      lon: s.lng,
      type: "convenience_fuel",
      sourceUrl: "https://quickchek.com/locations-services-fuel/",
    });
  });

  const payload = {
    brandId: "quickchek",
    source: "https://quickchek.com/wp-admin/admin-ajax.php (get_sorted_locations)",
    sourceType: "locator-ajax",
    sourceTag: "quickchek-official",
    storeCount: stores.length,
    meta: { gridSeeds: QUICKCHEK_SEEDS.length, uniqueIds: byId.size },
    stores,
  };
  if (cacheFile) {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    writeCache(cacheFile, payload);
  }
  return payload;
}

export async function fetchParkersOfficial(cacheDir, opts = {}) {
  const cacheFile = cacheDir ? path.join(cacheDir, "parkers-official.json") : null;
  if (cacheFile && fs.existsSync(cacheFile)) {
    const cached = readCache(cacheFile);
    if (cached?.stores?.length) return cached;
  }

  const indexHtml = await fetchText("https://parkerskitchen.com/locations/");
  const urls = [
    ...new Set(
      [...indexHtml.matchAll(/href="(https:\/\/parkerskitchen\.com\/locations\/parkers-\d+\/)"/g)].map((m) => m[1])
    ),
  ];
  if (cacheDir) fs.mkdirSync(cacheDir, { recursive: true });

  const stores = [];
  const errors = [];
  const max = opts.maxPages || urls.length;

  for (const url of urls.slice(0, max)) {
    const cp = cachePath(cacheDir, url);
    let parsed = readCache(cp);
    if (!parsed) {
      try {
        const html = await fetchText(url);
        const coords = parseDaddrCoords(html);
        if (!coords || !coordValid(coords.lat, coords.lon)) {
          errors.push({ url, reason: "no-coords" });
          continue;
        }
        const num = url.match(/parkers-(\d+)/)?.[1] || "";
        const title = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.replace(/\s*\|.*/, "").trim() || "";
        parsed = {
          officialId: num || url,
          label: title || `Parker's #${num}`,
          brandId: "parkers",
          city: "",
          state: "",
          lat: coords.lat,
          lon: coords.lon,
          sourceUrl: url,
        };
        writeCache(cp, parsed);
        await sleep(opts.delayMs ?? 30);
      } catch (e) {
        errors.push({ url, reason: String(e.message || e) });
        continue;
      }
    }
    stores.push(
      storeRow({
        ...parsed,
        brand: "Parker's Kitchen",
        type: "convenience_fuel",
        url: parsed.sourceUrl,
      })
    );
  }

  const payload = {
    brandId: "parkers",
    source: "https://parkerskitchen.com/locations/",
    sourceType: "location-pages",
    sourceTag: "parkers-official",
    storeCount: stores.length,
    meta: { locationUrls: urls.length, pagesFetched: Math.min(max, urls.length), errors: errors.length },
    errors: errors.slice(0, 20),
    stores,
  };
  if (cacheFile) writeCache(cacheFile, payload);
  return payload;
}

export async function fetchCefcoOfficial(cacheDir, opts = {}) {
  const cacheFile = cacheDir ? path.join(cacheDir, "cefco-official.json") : null;
  if (cacheFile && fs.existsSync(cacheFile)) {
    const cached = readCache(cacheFile);
    if (cached?.stores?.length) return cached;
  }

  const sitemap = await fetchText("https://cefcostores.com/location-sitemap.xml");
  const urls = [...sitemap.matchAll(/<loc>(https:\/\/cefcostores\.com\/location\/[^<]+)<\/loc>/g)]
    .map((m) => m[1])
    .filter((u) => !u.endsWith("/location/"));

  if (cacheDir) fs.mkdirSync(cacheDir, { recursive: true });
  const geocodeDir = cacheDir ? path.join(cacheDir, "geocode") : null;
  if (geocodeDir) fs.mkdirSync(geocodeDir, { recursive: true });

  const stores = [];
  const errors = [];
  const max = opts.maxPages || urls.length;
  let travelPlazaCount = 0;
  let convenienceCount = 0;

  for (const url of urls.slice(0, max)) {
    const cp = cachePath(cacheDir, url);
    let parsed = readCache(cp);
    if (!parsed) {
      try {
        const html = await fetchText(url);
        const h1 = html.match(/<h1[^>]*>([^<]+)/i)?.[1]?.trim() || "";
        const addr = parseCefcoLocationAddress(html);
        if (!addr) {
          errors.push({ url, reason: "no-address" });
          continue;
        }
        const query = `${addr.street}, ${addr.city}, ${addr.state} ${addr.zip}`.trim();
        const geo = await geocodeNominatim(query, geocodeDir);
        if (!geo || !coordValid(geo.lat, geo.lon)) {
          errors.push({ url, reason: "geocode-failed" });
          continue;
        }
        const isLargeFormat = isCefcoLargeFormatHtml(html);
        const type = inferFuelType(
          { brandId: "cefco", label: h1 },
          { catalogType: FUEL_TYPE_TRAVEL_PLAZA, html, isLargeFormat }
        );
        parsed = {
          officialId: url.split("/").filter(Boolean).pop(),
          label: h1,
          brandId: "cefco",
          city: addr.city,
          state: addr.state,
          street: addr.street,
          lat: geo.lat,
          lon: geo.lon,
          sourceUrl: url,
          isLargeFormat,
          type,
        };
        writeCache(cp, parsed);
        await sleep(opts.delayMs ?? 20);
      } catch (e) {
        errors.push({ url, reason: String(e.message || e) });
        continue;
      }
    }
    const type =
      parsed.type ||
      inferFuelType(parsed, {
        catalogType: FUEL_TYPE_TRAVEL_PLAZA,
        isLargeFormat: parsed.isLargeFormat,
      });
    if (type === "convenience_fuel") convenienceCount++;
    else travelPlazaCount++;
    stores.push(
      storeRow({
        ...parsed,
        brand: "CEFCO",
        type,
        url: parsed.sourceUrl,
      })
    );
  }

  const payload = {
    brandId: "cefco",
    source: "https://cefcostores.com/location-sitemap.xml (all locations + Nominatim)",
    sourceType: "sitemap-pages-geocoded",
    sourceTag: "cefco-official",
    storeCount: stores.length,
    meta: {
      sitemapUrls: urls.length,
      filter: "all fuel locations; type from Kitchen/Travel Center amenities",
      travelPlazaCount,
      convenienceCount,
      errors: errors.length,
    },
    errors: errors.slice(0, 20),
    stores,
  };
  if (cacheFile) writeCache(cacheFile, payload);
  return payload;
}

function parseWallysLabel(label) {
  const clean = (label || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const m = clean.match(/(?:Wally'?s\s+)?([^,]+),\s*([A-Z]{2})\b/i);
  if (m) return { city: m[1].trim(), state: m[2].toUpperCase() };
  return { city: "", state: "" };
}

export async function fetchWallysOfficial() {
  const html = await fetchText("https://www.wallys.com/locations/");
  const markers = parseLeafletMapMarkers(html);
  const stores = markers.map((m, i) => {
    const { city, state } = parseWallysLabel(m.label);
    return storeRow({
      officialId: `wallys-${i + 1}`,
      label: m.label || `Wally's ${i + 1}`,
      brandId: "wallys",
      brand: "Wally's",
      city,
      state,
      lat: m.lat,
      lon: m.lon,
      type: FUEL_TYPE_TRAVEL_PLAZA,
      sourceUrl: "https://www.wallys.com/locations/",
      url: "https://www.wallys.com/locations/",
    });
  });
  return {
    brandId: "wallys",
    source: "https://www.wallys.com/locations/",
    sourceType: "leaflet-markers",
    sourceTag: "wallys-official",
    storeCount: stores.length,
    stores,
  };
}

export async function fetchBusyBeeOfficial() {
  const res = await fetch(
    "https://shopthebusybee.com/wp-admin/admin-ajax.php?action=store_search&lat=30.5&lng=-84.3&search_radius=500",
    { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(60000) }
  );
  if (!res.ok) throw new Error(`Busy Bee AJAX HTTP ${res.status}`);
  const rows = JSON.parse(await res.text());
  const stores = (rows || [])
    .filter((s) => coordValid(parseFloat(s.lat), parseFloat(s.lng)))
    .map((s) =>
      storeRow({
        officialId: String(s.id),
        label: s.store || `Busy Bee #${s.id}`,
        brandId: "busy_bee",
        brand: "Busy Bee",
        city: s.city || "",
        state: s.state || "",
        street: s.address || "",
        lat: parseFloat(s.lat),
        lon: parseFloat(s.lng),
        type: FUEL_TYPE_TRAVEL_PLAZA,
        sourceUrl: "https://shopthebusybee.com/location/",
        url: s.url || "https://shopthebusybee.com/location/",
      })
    );

  return {
    brandId: "busy_bee",
    source: "https://shopthebusybee.com/wp-admin/admin-ajax.php (store_search)",
    sourceType: "locator-ajax",
    sourceTag: "busybee-official",
    storeCount: stores.length,
    stores,
  };
}
