/**
 * Keep full highway travel stops (restrooms/showers), not fuel-only or dealer sites.
 */
import { FUEL_TYPE_CONVENIENCE, FUEL_TYPE_TRAVEL_PLAZA, normalizeFuelType } from "./fuel-brand-lib.mjs";

const PFJ_DEALER_RE = /\b(one9|pilot|flying j)\s+dealer\b|\bone9 gas station\b|\bfuel only\b/i;
const OSM_FUEL_ONLY_RE =
  /\bfuel only\b|\bcardlock\b|\bone9 gas station\b|\b(one9|pilot|flying j)\s+dealer\b/i;

/** Love's locator map pin types that are full travel stops (not country store / Speedco). */
export const LOVES_TRAVEL_STOP_PINS = new Set(["travelstoppin.png", "travelstop2.png"]);

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
  return { storefrontBrand, label, showersCount, isFullTravelCenter };
}

export function isPilotOfficialFullTravelCenter(parsed) {
  if (parsed.isFullTravelCenter != null) return parsed.isFullTravelCenter;
  const label = parsed.label || parsed.name || "";
  if (PFJ_DEALER_RE.test(label)) return false;
  if (/fuel only/i.test(label)) return false;
  return /travel center|travel plaza|flying j travel/i.test(label);
}

export function isLovesTravelStopPin(mapPinUrl) {
  const pin = (mapPinUrl || "").split("/").pop()?.toLowerCase() || "";
  return LOVES_TRAVEL_STOP_PINS.has(pin);
}

/** Buc-ee's, ONroute, Irving Big Stop, and convenience c-stores pass through unchanged. */
export function isFullTravelCenterRecord(rec) {
  const type = normalizeFuelType(rec.type);
  if (type === FUEL_TYPE_CONVENIENCE) return true;

  const brandId = rec.brandId || "";
  const text = `${rec.name || ""} ${rec.searchBlob || ""} ${rec.label || ""}`.toLowerCase();

  if (["pilot", "flyingj", "pilot_flyingj"].includes(brandId)) {
    if (OSM_FUEL_ONLY_RE.test(text)) return false;
    if (/\bdealer\b/.test(text) && !/travel center|travel plaza/.test(text)) return false;
    return true;
  }

  if (brandId === "loves") {
    if (/\bcardlock\b/.test(text)) return false;
    if (/\bspeedco\b/.test(text)) return false;
    if (/country store/.test(text) && !/travel stop|travel center/.test(text)) return false;
    return true;
  }

  return true;
}

export function filterFullTravelCenterRecords(records) {
  const kept = [];
  const dropped = [];
  for (const rec of records) {
    if (isFullTravelCenterRecord(rec)) kept.push(rec);
    else dropped.push(rec);
  }
  return { records: kept, dropped };
}
