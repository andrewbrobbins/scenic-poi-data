/**
 * Apply manual overrides + ArcGIS Hub search hits to state-parks-source-matrix.json.
 *
 * Usage:
 *   node build-state-parks-apply-matrix-overrides.mjs
 */
import path from "path";
import { fileURLToPath } from "url";
import { log } from "./pipeline-log.mjs";
import { INGEST_DIR, readJson, writeJson, US_STATES, CA_PROVINCES } from "./state-parks-lib.mjs";

const HUB_EXCLUDE = /PADUS|FederalLands|E911|Green Book|Geoheritage|IndianReservation|NationalParkService|Chesapeake Conservation|Detroit_MP|Oblique Aerial|RaceHispanic/i;

const tools = path.dirname(fileURLToPath(import.meta.url));
const MATRIX_PATH = path.join(tools, "state-parks-source-matrix.json");
const OVERRIDES_PATH = path.join(tools, "state-parks-source-overrides.json");
const HUB_PATH = path.join(INGEST_DIR, "00-research", "hub-search-us.json");

function mergeRow(existing, patch) {
  if (!patch) return existing;
  return {
    ...existing,
    ...patch,
    fieldMap: patch.fieldMap ? { ...(existing?.fieldMap || {}), ...patch.fieldMap } : existing?.fieldMap,
    country: existing?.country || patch.country || "US",
    admin: existing?.admin || patch.admin,
    investigatedAt: new Date().toISOString().slice(0, 10),
  };
}

function rowFromHubHit(admin, hit, agency) {
  if ((hit.probe?.count || 0) > 5000) return null;
  if (/USA_|National /i.test(hit.title || "")) return null;
  return {
    admin,
    country: US_STATES.includes(admin) ? "US" : "CA",
    agency: agency || hit.owner || "Unknown",
    tier: "A",
    status: "verified",
    primaryUrl: hit.url,
    queryUrl: hit.queryUrl,
    where: "1=1",
    outFields: "*",
    geometry: "unknown",
    license: "public",
    refreshCadence: "unknown",
    includesHistoricSites: true,
    featureCount: hit.probe?.count ?? null,
    fieldMap: null,
    notes: `ArcGIS Hub: ${hit.title}`,
    investigatedAt: new Date().toISOString().slice(0, 10),
  };
}

function applyRegion(matrix, regionKey, adminList, overrides, hub) {
  for (const admin of adminList) {
    const idx = matrix[regionKey].findIndex((r) => r.admin === admin);
    const existing = idx >= 0 ? matrix[regionKey][idx] : { admin, country: regionKey === "us" ? "US" : "CA" };

    let row = existing;
    const ovr = overrides?.[regionKey === "us" ? "us" : "ca"]?.[admin];
    if (ovr) row = mergeRow(row, { ...ovr, admin, country: row.country });

    const hubHit = hub?.states?.[admin]?.hits?.[0];
    if (hubHit && row.status !== "verified" && !HUB_EXCLUDE.test(hubHit.title || "")) {
      const hubRow = rowFromHubHit(admin, hubHit, ovr?.agency);
      if (hubRow) row = mergeRow(row, hubRow);
    }

    if (idx >= 0) matrix[regionKey][idx] = row;
    else matrix[regionKey].push(row);
  }
  matrix[regionKey].sort((a, b) => a.admin.localeCompare(b.admin));
}

const matrix = readJson(MATRIX_PATH, { us: [], ca: [] });
const overrides = readJson(OVERRIDES_PATH, { us: {}, ca: {} });
const hub = readJson(HUB_PATH, null);

applyRegion(matrix, "us", US_STATES, overrides, hub);
applyRegion(matrix, "ca", CA_PROVINCES, overrides, null);

matrix.generated = new Date().toISOString();
writeJson(MATRIX_PATH, matrix);

const verified = matrix.us.filter((r) => r.status === "verified").length;
log(`Matrix updated: ${verified}/${matrix.us.length} US verified, ${matrix.ca.filter((r) => r.status === "verified").length}/${matrix.ca.length} CA verified`);
