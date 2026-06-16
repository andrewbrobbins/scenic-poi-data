/**
 * Public-facing campground names (Parks Canada ArcGIS often uses legacy/internal labels).
 */
import { pcCampgroundCodeFromUrl } from "./camping-ca-pc-codes.mjs";

/** Campground code prefix (PARK-ABBREV) -> display name */
export const PC_DISPLAY_BY_CAMP_CODE = {
  "JNP-POC": "Miette Campground",
};

/** ArcGIS Name_e -> display name (when code is missing or unchanged in source) */
export const PC_DISPLAY_BY_ARCGIS_NAME = {
  Pocahontas: "Miette Campground",
  Snaring: "Snaring River Campground",
};

/**
 * @param {string} arcgisName Name_e from Parks Canada
 * @param {string} [urlCode] URL_e site code
 * @returns {string}
 */
export function pcDisplayName(arcgisName, urlCode = "") {
  const raw = (arcgisName || "").trim();
  const code = pcCampgroundCodeFromUrl(urlCode);
  if (code && PC_DISPLAY_BY_CAMP_CODE[code]) return PC_DISPLAY_BY_CAMP_CODE[code];
  if (raw && PC_DISPLAY_BY_ARCGIS_NAME[raw]) return PC_DISPLAY_BY_ARCGIS_NAME[raw];
  return raw || "Parks Canada campground";
}

/**
 * @param {object} rec master or ingest row
 * @returns {string}
 */
export function resolvePcDisplayName(rec) {
  const urlCode = rec.sourceIds?.urlCode || rec.parentUnit?.siteCode || "";
  return pcDisplayName(rec.name, urlCode);
}
