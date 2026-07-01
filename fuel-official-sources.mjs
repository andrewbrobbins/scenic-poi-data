/**
 * Official location sources for fuel brand reconcile.
 * Each fetcher returns { brandId, source, sourceType, sourceTag, stores[] }.
 */
import fs from "fs";
import path from "path";
import { fetchOfficialBuceesLocations } from "./bucees-official-lib.mjs";
import {
  cachePath,
  fetchText,
  parseGoogleMapsCoords,
  parseIrvingCoords,
  parsePilotBrand,
  parsePilotYextCoords,
  parseYextGeoCoords,
  readCache,
  stateFromPilotUrl,
  writeCache,
  USER_AGENT,
} from "./fuel-official-reconcile-lib.mjs";
import { coordValid, sleep } from "./fuel-us-lib.mjs";
import { FUEL_TYPE_TRAVEL_PLAZA, normalizeFuelType } from "./fuel-brand-lib.mjs";
import {
  isLovesTravelStopPin,
  isPilotOfficialFullTravelCenter,
  parsePilotYextFacility,
} from "./fuel-travel-center-lib.mjs";
import {
  fetchBusyBeeOfficial,
  fetchCefcoOfficial,
  fetchKwikTripOfficial,
  fetchParkersOfficial,
  fetchQuickChekOfficial,
  fetchRoyalFarmsOfficial,
  fetchWallysOfficial,
} from "./fuel-official-us-brands.mjs";

const IRVING_BIG_STOP_IDS = [
  { id: "26271", city: "Aulac", state: "NB" },
  { id: "26276", city: "Enfield", state: "NS" },
  { id: "26291", city: "Truro", state: "NS" },
  { id: "26301", city: "Pembroke", state: "ON" },
  { id: "26306", city: "Grand Falls", state: "NB" },
  { id: "26311", city: "Salisbury", state: "NB" },
  { id: "26316", city: "Lincoln", state: "NB" },
  { id: "26321", city: "Rothesay", state: "NB" },
  { id: "26326", city: "Aulds Cove", state: "NS" },
  { id: "26331", city: "Digby", state: "NS" },
  { id: "26336", city: "New Minas", state: "NS" },
  { id: "26341", city: "Clarenville", state: "NL" },
  { id: "26346", city: "Deer Lake", state: "NL" },
  { id: "26351", city: "Gander", state: "NL" },
  { id: "26356", city: "Goobies", state: "NL" },
  { id: "26361", city: "Mount Pearl", state: "NL" },
];

const ONROUTE_SLUGS = [
  "king-city",
  "innisfil",
  "barrie",
  "newcastle",
  "port-hope",
  "trenton-north",
  "trenton-south",
  "napanee",
  "odessa",
  "mallorytown-north",
  "mallorytown-south",
  "morrisburg",
  "ingleside",
  "bainsville",
  "cambridge-south",
  "cambridge-north",
  "woodstock",
  "ingersoll",
  "dutton",
  "west-lorne",
  "tilbury-south",
  "tilbury-north",
];

const SKIPPED_SOURCES = {
  racetrac: {
    brandId: "racetrac",
    reason: "RaceTrac location pages are client-rendered; sitemap HTML has no stable lat/lon for automated scrape.",
    docs: "https://www.racetrac.com/locations/",
  },
  quiktrip: {
    brandId: "quiktrip",
    reason: "No public store JSON API; QuikTrip locator loads data client-side without a stable export endpoint.",
    docs: "https://www.quiktrip.com/locations/",
  },
  wawa: {
    brandId: "wawa",
    reason: "Store locator blocks automated fetch (403); no public bulk export.",
    docs: "https://www.wawa.com/locations",
  },
  sheetz: {
    brandId: "sheetz",
    reason: "SheetzAPI GetAllStores returns empty without app credentials.",
    docs: "https://www.sheetz.com/find-a-sheetz",
  },
  petro_pass: {
    brandId: "petro_pass",
    reason: "300+ Petro-Pass cardlocks — no single geo JSON export; OSM strict match used instead.",
    docs: "https://www.petro-canada.ca/en/business/fuel-solutions-and-facilities/petro-pass-cardlock",
  },
  husky_travel: {
    brandId: "husky_travel",
    reason: "myhusky.ca location pages lack stable coordinates in HTML; many sites rebranded to Esso/Co-op.",
    docs: "https://local.myhusky.ca/",
  },
  terribles: {
    brandId: "terribles",
    reason:
      "Terrible's StoreRocket locator on terribles.com loads store JSON client-side with no stable bulk export; large-highway subset cannot be reconciled automatically yet.",
    docs: "https://www.terribles.com/",
  },
};

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

export async function fetchBuceesOfficial() {
  const data = await fetchOfficialBuceesLocations();
  return {
    brandId: "bucees",
    source: data.source,
    sourceType: "json-ld",
    sourceTag: "bucees-official",
    meta: data.audit,
    stores: data.stores.map((s) =>
      storeRow({
        officialId: s.storeNumber ? `#${s.storeNumber}` : s.label,
        label: s.label,
        brandId: "bucees",
        brand: "Buc-ee's",
        city: s.city,
        state: s.state,
        street: s.street,
        lat: s.lat,
        lon: s.lon,
        sourceUrl: s.sourceUrl,
      })
    ),
  };
}

async function parsePilotPages(urls, cacheDir, opts = {}) {
  const max = opts.maxPages || urls.length;
  const slice = urls.slice(0, max);
  const stores = [];
  const errors = [];
  let skippedFuelOnlyOrDealer = 0;

  for (const url of slice) {
    const cp = cachePath(cacheDir, url);
    let parsed = readCache(cp);
    if (!parsed) {
      try {
        const html = await fetchText(url);
        const coords = parsePilotYextCoords(html);
        if (!coords || !coordValid(coords.lat, coords.lon)) {
          errors.push({ url, reason: "no-coords" });
          continue;
        }
        const brandId = parsePilotBrand(html);
        const title = html.match(/<title>([^<]+)<\/title>/i)?.[1] || url;
        const facility = parsePilotYextFacility(html);
        parsed = {
          officialId: url,
          label: title.replace(/\s*\|\s*Pilot Flying J.*/i, "").trim(),
          brandId,
          city: url.split("/").slice(-2, -1)[0]?.replace(/-/g, " ") || "",
          state: stateFromPilotUrl(url),
          lat: coords.lat,
          lon: coords.lon,
          sourceUrl: url,
          storefrontBrand: facility.storefrontBrand,
          showersCount: facility.showersCount,
          isFullTravelCenter: facility.isFullTravelCenter,
        };
        writeCache(cp, parsed);
        await sleep(opts.delayMs ?? 40);
      } catch (e) {
        errors.push({ url, reason: String(e.message || e) });
        continue;
      }
    }
    if (!isPilotOfficialFullTravelCenter(parsed)) {
      skippedFuelOnlyOrDealer++;
      continue;
    }
    stores.push(
      storeRow({
        ...parsed,
        brand:
          parsed.brandId === "flyingj"
            ? "Flying J"
            : parsed.brandId === "pilot_flyingj"
              ? "Pilot / Flying J"
              : "Pilot",
      })
    );
  }
  return { stores, errors, fetched: slice.length, skippedFuelOnlyOrDealer };
}

export async function fetchPilotFlyingJOfficial(region, cacheDir, opts = {}) {
  const sitemap = await fetchText("https://locations.pilotflyingj.com/sitemap.xml");
  const prefix =
    region === "ca" ? "https://locations.pilotflyingj.com/ca/" : "https://locations.pilotflyingj.com/us/";
  const urls = [...sitemap.matchAll(/<loc>(https:\/\/locations\.pilotflyingj\.com\/(?:us|ca)\/[^<]+)<\/loc>/g)]
    .map((m) => m[1])
    .filter((u) => u.startsWith(prefix))
    .filter((u) => u.split("/").length >= 7);
  fs.mkdirSync(cacheDir, { recursive: true });
  const { stores, errors, fetched, skippedFuelOnlyOrDealer } = await parsePilotPages(urls, cacheDir, opts);
  const byBrand = {};
  for (const s of stores) byBrand[s.brandId] = (byBrand[s.brandId] || 0) + 1;
  return {
    brandIds: Object.keys(byBrand),
    source: "https://locations.pilotflyingj.com/sitemap.xml",
    sourceType: "yext-sitemap",
    sourceTag: "pilotflyingj-official",
    region,
    storeCount: stores.length,
    byBrand,
    errors: errors.slice(0, 20),
    pagesFetched: fetched,
    skippedFuelOnlyOrDealer,
    stores,
  };
}

export async function fetchOnrouteOfficial() {
  const stores = [];
  for (const slug of ONROUTE_SLUGS) {
    const url = `https://www.onroute.ca/locations/${slug}`;
    const html = await fetchText(url);
    const coords = parseGoogleMapsCoords(html);
    if (!coords || !coordValid(coords.lat, coords.lon)) continue;
    const label = slug
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    stores.push(
      storeRow({
        officialId: slug,
        label: `ONroute ${label}`,
        brandId: "onroute",
        brand: "ONroute",
        city: label,
        state: "ON",
        lat: coords.lat,
        lon: coords.lon,
        type: FUEL_TYPE_TRAVEL_PLAZA,
        sourceUrl: url,
      })
    );
    await sleep(80);
  }
  return {
    brandId: "onroute",
    source: "https://www.onroute.ca/locations/",
    sourceType: "webflow-pages",
    sourceTag: "onroute-official",
    stores,
  };
}

export async function fetchIrvingBigStopOfficial() {
  const stores = [];
  for (const site of IRVING_BIG_STOP_IDS) {
    const url = `https://www.irvingoil.com/en-CA/location/irving-oil-${site.id}`;
    let html;
    try {
      html = await fetchText(url);
    } catch (e) {
      if (String(e.message || e).includes("404")) continue;
      throw e;
    }
    if (!/Big Stop/i.test(html)) continue;
    const coords = parseIrvingCoords(html);
    if (!coords || !coordValid(coords.lat, coords.lon)) continue;
    const title = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim() || `Big Stop ${site.city}`;
    stores.push(
      storeRow({
        officialId: site.id,
        label: title,
        brandId: "irving_bigstop",
        brand: "Irving Big Stop",
        city: site.city,
        state: site.state,
        lat: coords.lat,
        lon: coords.lon,
        sourceUrl: url,
      })
    );
    await sleep(80);
  }
  return {
    brandId: "irving_bigstop",
    source: "https://www.irvingoil.com/en-CA/on-the-road/big-stop-restaurants",
    sourceType: "location-pages",
    sourceTag: "irving-official",
    stores,
  };
}

export async function fetchLovesOfficial(cacheDir) {
  const cacheFile = cacheDir ? path.join(cacheDir, "loves-fetch-stores.json") : null;
  if (cacheFile && fs.existsSync(cacheFile)) {
    const cached = readCache(cacheFile);
    if (cached?.stores?.length) return cached;
  }

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("https://www.loves.com/api/fetch_stores", {
        method: "POST",
        headers: {
          "User-Agent": USER_AGENT,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: "{}",
        signal: AbortSignal.timeout(180000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const raw = data.stores || [];
      const byPin = {};
      const stores = [];
      let skippedNonTravelStop = 0;
      for (const s of raw) {
        if (!coordValid(s.latitude, s.longitude)) continue;
        const pin = (s.mapPinUrl || "").split("/").pop()?.toLowerCase() || "unknown";
        byPin[pin] = (byPin[pin] || 0) + 1;
        if (!isLovesTravelStopPin(s.mapPinUrl)) {
          skippedNonTravelStop++;
          continue;
        }
        stores.push(
          storeRow({
            officialId: String(s.number),
            label: `Love's #${s.number} — ${s.city}, ${s.state}`,
            brandId: "loves",
            brand: "Love's",
            city: s.city || "",
            state: s.state || "",
            street: s.address1 || "",
            lat: s.latitude,
            lon: s.longitude,
            sourceUrl: "https://www.loves.com/location-and-fuel-price-search",
            url: s.storeUrl ? `https://${String(s.storeUrl).replace(/^https?:\/\//, "")}` : "",
          })
        );
      }
      const payload = {
        brandId: "loves",
        source: "https://www.loves.com/api/fetch_stores",
        sourceType: "locator-api",
        sourceTag: "loves-official",
        storeCount: stores.length,
        meta: { apiStoreCount: raw.length, byMapPin: byPin, skippedNonTravelStop },
        stores,
      };
      if (cacheFile) {
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        writeCache(cacheFile, payload);
      }
      return payload;
    } catch (e) {
      lastErr = e;
      await sleep(2000 * (attempt + 1));
    }
  }
  throw new Error(`Love's fetch_stores failed: ${lastErr?.message || lastErr}`);
}

export async function fetchMaverikOfficial(cacheDir, opts = {}) {
  const cacheFile = cacheDir ? path.join(cacheDir, "maverik-official.json") : null;
  if (cacheFile && fs.existsSync(cacheFile)) {
    const cached = readCache(cacheFile);
    if (cached?.stores?.length) return cached;
  }

  const sitemap = await fetchText("https://locations.maverik.com/sitemap.xml");
  const urls = [...sitemap.matchAll(/<loc>(https:\/\/locations\.maverik\.com\/[^<]+)<\/loc>/g)]
    .map((m) => m[1])
    .filter((u) => new URL(u).pathname.split("/").filter(Boolean).length === 3);

  if (cacheDir) fs.mkdirSync(cacheDir, { recursive: true });
  const max = opts.maxPages || urls.length;
  const stores = [];
  const errors = [];

  for (const url of urls.slice(0, max)) {
    const cp = cachePath(cacheDir, url);
    let parsed = readCache(cp);
    if (!parsed) {
      try {
        const html = await fetchText(url);
        const coords = parseYextGeoCoords(html);
        if (!coords || !coordValid(coords.lat, coords.lon)) {
          errors.push({ url, reason: "no-coords" });
          continue;
        }
        const parts = new URL(url).pathname.split("/").filter(Boolean);
        const state = parts[0]?.toUpperCase() || "";
        const city = parts[1]?.replace(/-/g, " ") || "";
        const street = parts[2]?.replace(/-/g, " ") || "";
        const title =
          html.match(/<title>([^<]+)<\/title>/i)?.[1]?.replace(/\s*\|\s*Maverik.*/i, "").trim() || "";
        const storeNum = title.match(/Maverik\s*#(\d+)/i)?.[1] || "";
        parsed = {
          officialId: url,
          label: title || `Maverik — ${street}, ${city}, ${state}`,
          brandId: "maverik",
          city,
          state,
          street,
          storeNumber: storeNum,
          lat: coords.lat,
          lon: coords.lon,
          sourceUrl: url,
        };
        writeCache(cp, parsed);
        await sleep(opts.delayMs ?? 25);
      } catch (e) {
        errors.push({ url, reason: String(e.message || e) });
        continue;
      }
    }
    stores.push(
      storeRow({
        ...parsed,
        brand: "Maverik",
        type: "convenience_fuel",
        url: parsed.sourceUrl,
      })
    );
  }

  const payload = {
    brandId: "maverik",
    source: "https://locations.maverik.com/sitemap.xml",
    sourceType: "yext-sitemap-pages",
    sourceTag: "maverik-official",
    storeCount: stores.length,
    meta: { sitemapStoreUrls: urls.length, pagesFetched: Math.min(max, urls.length), errors: errors.length },
    errors: errors.slice(0, 20),
    stores,
  };
  if (cacheFile) writeCache(cacheFile, payload);
  return payload;
}

export async function fetchRaceTracOfficial(cacheDir, opts = {}) {
  const sitemap = await fetchText("https://www.racetrac.com/sitemap.xml");
  const urls = [...sitemap.matchAll(/<loc>(https:\/\/www\.racetrac\.com\/locations\/[^<]+)<\/loc>/g)].map(
    (m) => m[1]
  );
  fs.mkdirSync(cacheDir, { recursive: true });
  const max = opts.maxPages || urls.length;
  const stores = [];
  const errors = [];
  for (const url of urls.slice(0, max)) {
    const cp = cachePath(cacheDir, url);
    let parsed = readCache(cp);
    if (!parsed) {
      try {
        const html = await fetchText(url);
        const coords = parseGoogleMapsCoords(html) || parseIrvingCoords(html);
        if (!coords || !coordValid(coords.lat, coords.lon)) {
          errors.push({ url, reason: "no-coords" });
          continue;
        }
        const parts = new URL(url).pathname.split("/").filter(Boolean);
        const state = parts[1]?.toUpperCase() || "";
        parsed = {
          officialId: url,
          label: parts.slice(-1)[0]?.replace(/-/g, " ") || url,
          brandId: "racetrac",
          city: parts[2]?.replace(/-/g, " ") || "",
          state,
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
    stores.push(storeRow({ ...parsed, brand: "RaceTrac" }));
  }
  return {
    brandId: "racetrac",
    source: "https://www.racetrac.com/sitemap.xml",
    sourceType: "sitemap-pages",
    sourceTag: "racetrac-official",
    storeCount: stores.length,
    errors: errors.slice(0, 20),
    stores,
  };
}

export function skippedSource(brandId) {
  return SKIPPED_SOURCES[brandId] || null;
}

export const US_RECONCILE_BRANDS = [
  "bucees",
  "pfj",
  "loves",
  "maverik",
  "kwiktrip",
  "kwikstar",
  "wallys",
  "busy_bee",
  "parkers",
  "cefco",
  "royal_farms",
  "quickchek",
  "quiktrip",
  "racetrac",
  "wawa",
  "sheetz",
];
export const CA_RECONCILE_BRANDS = ["pfj", "onroute", "irving_bigstop", "petro_pass", "husky_travel"];

export const PFJ_BRAND_IDS = new Set(["pilot", "flyingj", "pilot_flyingj"]);

let pilotCache = null;

export async function fetchPilotFlyingJCombined(region, cacheDir, opts = {}) {
  const cacheKey = `${region}:${opts.maxPages || "all"}`;
  if (!pilotCache || pilotCache.key !== cacheKey) {
    const pfj = await fetchPilotFlyingJOfficial(region, cacheDir, opts);
    pilotCache = { key: cacheKey, pfj };
  }
  const pfj = pilotCache.pfj;
  return {
    brandId: "pfj",
    source: pfj.source,
    sourceType: pfj.sourceType,
    sourceTag: pfj.sourceTag,
    stores: pfj.stores,
    meta: { byBrand: pfj.byBrand, pagesFetched: pfj.pagesFetched, errors: pfj.errors },
  };
}

export async function fetchOfficialForBrand(brandId, opts = {}) {
  if (brandId === "bucees") return fetchBuceesOfficial();
  if (brandId === "loves") return fetchLovesOfficial(opts.cacheDir);
  if (brandId === "maverik") return fetchMaverikOfficial(opts.cacheDir, opts);
  if (brandId === "pfj") return fetchPilotFlyingJCombined(opts.region || "us", opts.cacheDir, opts);
  if (brandId === "kwiktrip" || brandId === "kwikstar") {
    return fetchKwikTripOfficial(opts.cacheDir, { ...opts, brandId });
  }
  if (brandId === "royal_farms") return fetchRoyalFarmsOfficial(opts.cacheDir);
  if (brandId === "quickchek") return fetchQuickChekOfficial(opts.cacheDir);
  if (brandId === "parkers") return fetchParkersOfficial(opts.cacheDir, opts);
  if (brandId === "cefco") return fetchCefcoOfficial(opts.cacheDir, opts);
  if (brandId === "wallys") return fetchWallysOfficial();
  if (brandId === "busy_bee") return fetchBusyBeeOfficial();
  if (brandId === "onroute") return fetchOnrouteOfficial();
  if (brandId === "irving_bigstop") return fetchIrvingBigStopOfficial();

  const skip = skippedSource(brandId);
  if (skip) return { ...skip, stores: [], skipped: true };
  return { brandId, stores: [], skipped: true, reason: "No official source configured" };
}

export function resetPilotCache() {
  pilotCache = null;
}
