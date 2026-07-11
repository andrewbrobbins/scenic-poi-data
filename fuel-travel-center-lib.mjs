/**
 * Travel-center vs convenience signals for Pilot / Love's official + OSM records.
 * Format filtering that drops fuel retail sites lives in fuel-type-infer.mjs now;
 * this module only classifies and identifies non-fuel service sites (Speedco, dealers).
 */
import { FUEL_TYPE_CONVENIENCE, normalizeFuelType } from "./fuel-brand-lib.mjs";

const PFJ_DEALER_RE = /\b(one9|pilot|flying j)\s+dealer\b/i;

/** Love's locator map pin types that are full travel stops. */
export const LOVES_TRAVEL_STOP_PINS = new Set(["travelstoppin.png", "travelstop2.png"]);

/** Love's pins that are not fuel retail (tire/lube). */
export const LOVES_NON_FUEL_PINS = new Set(["speedcopin.png"]);

export function parsePilotYextFacility(html) {
  const fields = {};
  for (const m of html.matchAll(
    /"(c_(?:storefrontBrand|siteBrand1|pagesShowersCount|pagesName))"\s*:\s*"([^"]*)"/g
  )) {
    fields[m[1]] = m[2];
  }
  const storefrontBrand = fields.c_storefrontBrand || fields.c_siteBrand1 || "";
  const label = fields.c_pagesName || "";
  const showersCount = Number(fields.c_pagesShowersCount || 0);
  const text = `${storefrontBrand} ${label}`;
  const isDealer = /\bdealer\b/i.test(text) && !/travel center/i.test(text);
  const isFuelOnly = /\bfuel only\b/i.test(text);
  const isTravelCenterBrand = /travel center|travel plaza|travel stop/i.test(storefrontBrand);
  const isFullTravelCenter =
    !isDealer && !isFuelOnly && (showersCount > 0 || isTravelCenterBrand);
  return { storefrontBrand, label, showersCount, isFullTravelCenter, isDealer, isFuelOnly };
}

export function isPilotOfficialFullTravelCenter(parsed) {
  if (parsed.isFullTravelCenter != null) return parsed.isFullTravelCenter;
  const label = parsed.label || parsed.name || "";
  if (PFJ_DEALER_RE.test(label)) return false;
  if (/fuel only/i.test(label)) return false;
  return /travel center|travel plaza|flying j travel/i.test(label);
}

/** True dealer / non-retail Pilot pages — drop from fuel lists. Fuel-only sites return false. */
export function isPilotDealerOnly(parsed) {
  const label = parsed.label || parsed.name || "";
  const storefront = parsed.storefrontBrand || "";
  const text = `${storefront} ${label}`;
  if (/\bfuel only\b/i.test(text)) return false;
  if (parsed.isFullTravelCenter === true) return false;
  if (isPilotOfficialFullTravelCenter(parsed)) return false;
  if (PFJ_DEALER_RE.test(text) && !/travel center|travel plaza/i.test(text)) return true;
  if (/\bdealer\b/i.test(text) && !/travel center|travel plaza/i.test(text)) return true;
  return false;
}

export function lovesPinFilename(mapPinUrl) {
  return (mapPinUrl || "").split("/").pop()?.toLowerCase() || "";
}

export function isLovesTravelStopPin(mapPinUrl) {
  return LOVES_TRAVEL_STOP_PINS.has(lovesPinFilename(mapPinUrl));
}

export function isLovesNonFuelPin(mapPinUrl) {
  return LOVES_NON_FUEL_PINS.has(lovesPinFilename(mapPinUrl));
}

/**
 * @deprecated Prefer classifyFuelRecords from fuel-type-infer.mjs.
 * Kept for any legacy callers: drops dealers/Speedco/country-store-as-plaza heuristics.
 */
export function isFullTravelCenterRecord(rec) {
  const type = normalizeFuelType(rec.type);
  if (type === FUEL_TYPE_CONVENIENCE) return true;

  const brandId = rec.brandId || "";
  const text = `${rec.name || ""} ${rec.searchBlob || ""} ${rec.label || ""}`.toLowerCase();

  if (["pilot", "flyingj", "pilot_flyingj"].includes(brandId)) {
    if (isPilotDealerOnly(rec)) return false;
    return true;
  }

  if (brandId === "loves") {
    if (/\bcardlock\b/.test(text)) return false;
    if (/\bspeedco\b/.test(text)) return false;
    return true;
  }

  return true;
}

/** @deprecated Prefer classifyFuelRecords from fuel-type-infer.mjs */
export function filterFullTravelCenterRecords(records) {
  const kept = [];
  const dropped = [];
  for (const rec of records) {
    if (isFullTravelCenterRecord(rec)) kept.push(rec);
    else dropped.push(rec);
  }
  return { records: kept, dropped };
}
