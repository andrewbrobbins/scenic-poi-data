/**
 * Per-store fuel type: travel_plaza vs convenience_fuel.
 * Brand catalog `type` is a default only — official pins / OSM text can override.
 */
import { FUEL_TYPE_CONVENIENCE, FUEL_TYPE_TRAVEL_PLAZA, normalizeFuelType } from "./fuel-brand-lib.mjs";
import { isCefcoLargeFormatHtml } from "./fuel-official-reconcile-lib.mjs";
import {
  isLovesNonFuelPin,
  isLovesTravelStopPin,
  isPilotDealerOnly,
  isPilotOfficialFullTravelCenter,
} from "./fuel-travel-center-lib.mjs";

const PFJ = new Set(["pilot", "flyingj", "pilot_flyingj"]);

function recordText(rec) {
  return `${rec.name || ""} ${rec.searchBlob || ""} ${rec.label || ""}`.toLowerCase();
}

/**
 * @param {object} rec - fuel record or official store row
 * @param {object} [signals]
 * @param {string} [signals.catalogType]
 * @param {string} [signals.mapPinUrl]
 * @param {string} [signals.html] - CEFCO location page HTML
 * @param {boolean} [signals.isLargeFormat]
 * @param {object} [signals.parsedPilot]
 */
export function inferFuelType(rec, signals = {}) {
  const brandId = rec.brandId || signals.brandId || "";
  const catalogType = normalizeFuelType(signals.catalogType ?? rec.type);
  const mapPinUrl = signals.mapPinUrl ?? rec.mapPinUrl;
  const text = recordText(rec);
  const prior = normalizeFuelType(rec.type);

  if (brandId === "loves") {
    if (mapPinUrl) {
      return isLovesTravelStopPin(mapPinUrl) ? FUEL_TYPE_TRAVEL_PLAZA : FUEL_TYPE_CONVENIENCE;
    }
    if (/country store/.test(text) && !/travel stop|travel center/.test(text)) {
      return FUEL_TYPE_CONVENIENCE;
    }
    if (/travel stop|travel center/.test(text)) return FUEL_TYPE_TRAVEL_PLAZA;
    // Preserve official stamp when pin URL was not copied onto OSM row
    if (prior === FUEL_TYPE_CONVENIENCE || prior === FUEL_TYPE_TRAVEL_PLAZA) return prior;
    return catalogType;
  }

  if (PFJ.has(brandId)) {
    const parsed = signals.parsedPilot || rec;
    if (parsed.isFullTravelCenter != null || parsed.storefrontBrand || parsed.showersCount != null) {
      return isPilotOfficialFullTravelCenter(parsed) ? FUEL_TYPE_TRAVEL_PLAZA : FUEL_TYPE_CONVENIENCE;
    }
    if (/\bfuel only\b|\bcardlock\b/.test(text)) return FUEL_TYPE_CONVENIENCE;
    if (/\bdealer\b/.test(text) && !/travel center|travel plaza/.test(text)) {
      return FUEL_TYPE_CONVENIENCE;
    }
    if (/travel center|travel plaza|flying j travel/.test(text)) return FUEL_TYPE_TRAVEL_PLAZA;
    if (prior === FUEL_TYPE_CONVENIENCE || prior === FUEL_TYPE_TRAVEL_PLAZA) return prior;
    return catalogType;
  }

  if (brandId === "cefco") {
    if (signals.html) {
      return isCefcoLargeFormatHtml(signals.html) ? FUEL_TYPE_TRAVEL_PLAZA : FUEL_TYPE_CONVENIENCE;
    }
    const large = signals.isLargeFormat ?? rec.isLargeFormat;
    if (large != null) return large ? FUEL_TYPE_TRAVEL_PLAZA : FUEL_TYPE_CONVENIENCE;
    if (/cefco kitchen|cefco travel|travel center|travel plaza/.test(text)) {
      return FUEL_TYPE_TRAVEL_PLAZA;
    }
    // Preserve official large-format stamp (name alone is often just "CEFCO")
    if (prior === FUEL_TYPE_TRAVEL_PLAZA) return FUEL_TYPE_TRAVEL_PLAZA;
    if (prior === FUEL_TYPE_CONVENIENCE) return FUEL_TYPE_CONVENIENCE;
    return FUEL_TYPE_CONVENIENCE;
  }

  return catalogType;
}

/** Speedco / cardlock / Pilot dealer (non-retail) — not fuel stops for the map. */
export function isNonFuelServiceSite(rec, signals = {}) {
  const brandId = rec.brandId || signals.brandId || "";
  const mapPinUrl = signals.mapPinUrl ?? rec.mapPinUrl;
  const text = recordText(rec);

  if (brandId === "loves") {
    if (mapPinUrl && isLovesNonFuelPin(mapPinUrl)) return true;
    if (/\bspeedco\b/.test(text)) return true;
    if (/\bcardlock\b/.test(text) && !/travel stop|travel center|country store/.test(text)) {
      return true;
    }
    return false;
  }

  if (PFJ.has(brandId)) {
    return isPilotDealerOnly(signals.parsedPilot || rec);
  }

  return false;
}

/**
 * Drop non-fuel service sites; set `type` on remaining records.
 * @param {object[]} records
 * @param {Record<string, { type?: string }>} [catalogById]
 */
export function classifyFuelRecords(records, catalogById = {}) {
  const kept = [];
  const dropped = [];
  for (const rec of records) {
    if (isNonFuelServiceSite(rec)) {
      dropped.push(rec);
      continue;
    }
    const catalogType = catalogById[rec.brandId]?.type ?? rec.type;
    rec.type = inferFuelType(rec, { catalogType });
    kept.push(rec);
  }
  return { records: kept, dropped };
}
