/**
 * Cross-check state/provincial park catalog counts against Tier-A GIS and public listings.
 *
 * Usage:
 *   node build-state-parks-cross-check.mjs
 *   node build-state-parks-cross-check.mjs --write-sources   # refresh state-parks-cross-check-sources.json
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log, logSection } from "./pipeline-log.mjs";
import {
  MASTER_CA_PATH,
  MASTER_US_PATH,
  QA_PATH,
  catalogRejectReason,
  isExcludedUsStateParkName,
  readJson,
  shouldKeepCatalogRecord,
  writeJson,
} from "./state-parks-lib.mjs";
import { loadSourceMatrix, verifiedSources } from "./state-parks-official-lib.mjs";
import { loadListingCache } from "./state-parks-listing-lib.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));
const SOURCES_PATH = path.join(tools, "state-parks-cross-check-sources.json");
const REPORT_PATH = path.join(tools, "state-parks-cross-check-report.json");

const NASPD_LOCATE = "https://stateparks.org/locate-a-park/";
const ASP_AGENCIES = "https://www.americasstateparks.org/state-park-agencies/";
const ASP_FINDER = "https://www.americasstateparks.org/state-parks/";

/** Official agency park finders / A–Z lists for manual count cross-check. */
const US_LISTINGS = {
  AL: { agency: "Alabama State Parks", listing: "https://www.alapark.com/parks", wiki: "List_of_Alabama_state_parks" },
  AK: { agency: "Alaska State Parks", listing: "https://dnr.alaska.gov/parks/asp", wiki: "List_of_Alaska_state_parks" },
  AZ: { agency: "Arizona State Parks", listing: "https://azstateparks.com/find-a-park/", wiki: "List_of_Arizona_state_parks" },
  AR: { agency: "Arkansas State Parks", listing: "https://www.arkansasstateparks.com/parks", wiki: "List_of_Arkansas_state_parks" },
  CA: { agency: "California State Parks", listing: "https://www.parks.ca.gov/ParkList", wiki: "List_of_California_state_parks" },
  CO: { agency: "Colorado Parks and Wildlife", listing: "https://cpw.state.co.us/placestogo/parks", wiki: "List_of_Colorado_state_parks" },
  CT: { agency: "Connecticut State Parks", listing: "https://portal.ct.gov/deep/state-parks", wiki: "List_of_Connecticut_state_parks" },
  DE: { agency: "Delaware State Parks", listing: "https://destateparks.com/FindAStatePark", wiki: "List_of_Delaware_state_parks" },
  FL: { agency: "Florida State Parks", listing: "https://www.floridastateparks.org/parks-and-trails", wiki: "List_of_Florida_state_parks" },
  GA: { agency: "Georgia State Parks", listing: "https://gastateparks.org/Parks", wiki: "List_of_Georgia_state_parks" },
  HI: { agency: "Hawaii State Parks", listing: "https://dlnr.hawaii.gov/dsp/parks/", wiki: "List_of_Hawaii_state_parks" },
  ID: { agency: "Idaho State Parks", listing: "https://parksandrecreation.idaho.gov/find-a-park/", wiki: "List_of_Idaho_state_parks" },
  IL: { agency: "Illinois State Parks", listing: "https://dnr.illinois.gov/experience/parks.html", wiki: "List_of_protected_areas_of_Illinois" },
  IN: { agency: "Indiana State Parks", listing: "https://www.in.gov/dnr/state-parks/", wiki: "List_of_Indiana_state_parks" },
  IA: { agency: "Iowa State Parks", listing: "https://www.iowadnr.gov/places-go/state-parks", wiki: "List_of_Iowa_state_parks" },
  KS: { agency: "Kansas State Parks", listing: "https://ksoutdoors.com/State-Parks", wiki: "List_of_Kansas_state_parks" },
  KY: { agency: "Kentucky State Parks", listing: "https://parks.ky.gov/parks", wiki: "List_of_Kentucky_state_parks" },
  LA: { agency: "Louisiana State Parks", listing: "https://www.lastateparks.com/parks", wiki: "List_of_Louisiana_state_parks" },
  ME: { agency: "Maine State Parks", listing: "https://www.maine.gov/dacf/parks/", wiki: "List_of_Maine_state_parks" },
  MD: { agency: "Maryland State Parks", listing: "https://dnr.maryland.gov/publiclands/Pages/default.aspx", wiki: "List_of_Maryland_state_parks" },
  MA: { agency: "Massachusetts State Parks", listing: "https://www.mass.gov/orgs/department-of-conservation-recreation", wiki: "List_of_Massachusetts_state_parks" },
  MI: { agency: "Michigan State Parks", listing: "https://www.michigan.gov/dnr/places/state-parks", wiki: "List_of_Michigan_state_parks" },
  MN: { agency: "Minnesota State Parks", listing: "https://www.dnr.state.mn.us/state_parks/index.html", wiki: "List_of_Minnesota_state_parks" },
  MS: { agency: "Mississippi State Parks", listing: "https://www.mdwfp.com/parks-destinations/state-parks/", wiki: "List_of_Mississippi_state_parks" },
  MO: { agency: "Missouri State Parks", listing: "https://mostateparks.com/park", wiki: "List_of_Missouri_state_parks" },
  MT: { agency: "Montana State Parks", listing: "https://fwp.mt.gov/stateparks", wiki: "List_of_Montana_state_parks" },
  NE: { agency: "Nebraska Game and Parks", listing: "https://outdoornebraska.gov/stateparks/", wiki: "List_of_Nebraska_state_parks" },
  NV: { agency: "Nevada State Parks", listing: "https://parks.nv.gov/parks", wiki: "List_of_Nevada_state_parks" },
  NH: { agency: "New Hampshire State Parks", listing: "https://www.nhstateparks.org/find-parks-trails", wiki: "List_of_New_Hampshire_state_parks" },
  NJ: { agency: "New Jersey State Parks", listing: "https://www.nj.gov/dep/parksandforests/parks/", wiki: "List_of_New_Jersey_state_parks" },
  NM: { agency: "New Mexico State Parks", listing: "https://www.emnrd.nm.gov/spd/find-a-park/", wiki: "List_of_New_Mexico_state_parks" },
  NY: { agency: "New York State Parks", listing: "https://parks.ny.gov/parks/", wiki: "List_of_New_York_state_parks" },
  NC: { agency: "North Carolina State Parks", listing: "https://www.ncparks.gov/state-parks", wiki: "List_of_North_Carolina_state_parks" },
  ND: { agency: "North Dakota State Parks", listing: "https://www.parkrec.nd.gov/parks", wiki: "List_of_North_Dakota_state_parks" },
  OH: { agency: "Ohio State Parks", listing: "https://ohiodnr.gov/go-and-do/plan-a-visit/find-a-property", wiki: "List_of_protected_areas_of_Ohio" },
  OK: { agency: "Oklahoma State Parks", listing: "https://www.travelok.com/state-parks", wiki: "List_of_Oklahoma_state_parks" },
  OR: { agency: "Oregon State Parks", listing: "https://stateparks.oregon.gov/index.cfm?do=visit.find", wiki: "List_of_Oregon_state_parks" },
  PA: { agency: "Pennsylvania State Parks", listing: "https://www.dcnr.pa.gov/StateParks/FindAPark/Pages/default.aspx", wiki: "List_of_Pennsylvania_state_parks" },
  RI: { agency: "Rhode Island State Parks", listing: "https://riparks.ri.gov/parks", wiki: "List_of_Rhode_Island_state_parks" },
  SC: { agency: "South Carolina State Parks", listing: "https://southcarolinaparks.com/park-finder", wiki: "List_of_South_Carolina_state_parks" },
  SD: { agency: "South Dakota State Parks", listing: "https://gfp.sd.gov/parks/", wiki: "List_of_South_Dakota_state_parks" },
  TN: { agency: "Tennessee State Parks", listing: "https://tnstateparks.com/parks", wiki: "List_of_Tennessee_state_parks" },
  TX: { agency: "Texas Parks and Wildlife", listing: "https://tpwd.texas.gov/state-parks/find-a-park", wiki: "List_of_Texas_state_parks" },
  UT: { agency: "Utah State Parks", listing: "https://stateparks.utah.gov/find-a-park/", wiki: "List_of_Utah_state_parks" },
  VT: { agency: "Vermont State Parks", listing: "https://vtstateparks.com/find.html", wiki: "List_of_Vermont_state_parks" },
  VA: { agency: "Virginia State Parks", listing: "https://www.dcr.virginia.gov/state-parks/find-a-park", wiki: "List_of_Virginia_state_parks" },
  WA: { agency: "Washington State Parks", listing: "https://parks.wa.gov/find-parks", wiki: "List_of_Washington_state_parks" },
  WV: { agency: "West Virginia State Parks", listing: "https://wvstateparks.com/", wiki: "List_of_West_Virginia_state_parks" },
  WI: { agency: "Wisconsin State Parks", listing: "https://dnr.wisconsin.gov/topic/parks", wiki: "List_of_Wisconsin_state_parks" },
  WY: { agency: "Wyoming State Parks", listing: "https://wyoparks.wyo.gov/parks", wiki: "List_of_Wyoming_state_parks" },
};

const CA_LISTINGS = {
  AB: { agency: "Alberta Parks", listing: "https://www.albertaparks.ca/albertaparksca/visit-our-parks/", wiki: "List_of_provincial_parks_in_Alberta" },
  BC: { agency: "BC Parks", listing: "https://bcparks.ca/explore/", wiki: "List_of_provincial_parks_in_British_Columbia" },
  MB: { agency: "Manitoba Parks", listing: "https://www.gov.mb.ca/sd/parks/", wiki: "List_of_provincial_parks_in_Manitoba" },
  NB: { agency: "New Brunswick Parks", listing: "https://parcsnbparks.ca/", wiki: "List_of_provincial_parks_in_New_Brunswick" },
  NL: { agency: "NL Parks", listing: "https://www.gov.nl.ca/ffa/parks/", wiki: "List_of_provincial_parks_in_Newfoundland_and_Labrador" },
  NS: { agency: "Nova Scotia Parks", listing: "https://parks.novascotia.ca/", wiki: "List_of_provincial_parks_in_Nova_Scotia" },
  NT: { agency: "NWT Parks", listing: "https://www.nwtourism.ca/explore/nwt-parks", wiki: "List_of_Northwest_Territories_parks" },
  NU: { agency: "Nunavut Parks", listing: "https://www.nunavuttourism.com/things-to-do/parks-special-places/", wiki: "List_of_protected_areas_of_Nunavut" },
  ON: { agency: "Ontario Parks", listing: "https://www.ontarioparks.ca/park-locator", wiki: "List_of_provincial_parks_in_Ontario" },
  PE: { agency: "PEI Parks", listing: "https://www.princeedwardisland.ca/en/information/environment-energy-and-climate-action/pei-provincial-parks", wiki: "List_of_provincial_parks_in_Prince_Edward_Island" },
  QC: { agency: "Sépaq", listing: "https://www.sepaq.com/pq/parks/", wiki: "List_of_Quebec_national_parks" },
  SK: { agency: "Saskatchewan Parks", listing: "https://www.tourismsaskatchewan.com/places-to-go/provincial-parks", wiki: "List_of_provincial_parks_in_Saskatchewan" },
  YT: { agency: "Yukon Parks", listing: "https://yukon.ca/en/outdoor-recreation-and-wildlife/camping-and-picnicking/find-campground-or-picnic-site", wiki: "List_of_Yukon_parks" },
};

function buildSourcesPayload(matrix) {
  const us = {};
  for (const [admin, row] of Object.entries(US_LISTINGS)) {
    const matrixRow = (matrix.us || []).find((r) => r.admin === admin);
    us[admin] = {
      agency: row.agency,
      sources: [
        { tier: "official_listing", role: "cross_check", url: row.listing },
        { tier: "wikipedia", role: "cross_check", url: `https://en.wikipedia.org/wiki/${row.wiki}` },
        { tier: "naspd_directory", role: "directory", url: NASPD_LOCATE },
        { tier: "asp_agencies", role: "directory", url: ASP_AGENCIES },
        { tier: "asp_finder", role: "third_party", url: ASP_FINDER, notes: "Commercial directory — spot-check only" },
      ],
      tierAGis: matrixRow?.status === "verified" ? matrixRow.queryUrl : null,
      tierAGisCount: matrixRow?.featureCount ?? null,
    };
  }
  const ca = {};
  for (const [admin, row] of Object.entries(CA_LISTINGS)) {
    const matrixRow = (matrix.ca || []).find((r) => r.admin === admin);
    ca[admin] = {
      agency: row.agency,
      sources: [
        { tier: "official_listing", role: "cross_check", url: row.listing },
        { tier: "wikipedia", role: "cross_check", url: `https://en.wikipedia.org/wiki/${row.wiki}` },
      ],
      tierAGis: matrixRow?.status === "verified" ? matrixRow.queryUrl : null,
      tierAGisCount: matrixRow?.featureCount ?? null,
    };
  }
  return {
    generated: new Date().toISOString(),
    description: "Alternative online lists for manual / automated cross-check of SP-001 catalog counts",
    globalDirectories: [
      { name: "NASPD Locate a Park", url: NASPD_LOCATE },
      { name: "America's State Parks — agency directory", url: ASP_AGENCIES },
      { name: "America's State Parks — park finder", url: ASP_FINDER },
      { name: "PAD-US (USGS)", url: "https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-data-overview", tier: "E", role: "national_cross_check" },
    ],
    us,
    ca,
  };
}

function summarizeMaster(master, country, verifiedAdmins) {
  const filterOpts = { verifiedOfficialAdmins: verifiedAdmins };
  const byAdmin = {};
  const leakage = [];
  const suspiciousOsm = [];

  for (const r of master.records || []) {
    byAdmin[r.state] = byAdmin[r.state] || { total: 0, official: 0, osm: 0 };
    byAdmin[r.state].total += 1;
    if (r.source === "official") byAdmin[r.state].official += 1;
    else if (r.source === "osm") byAdmin[r.state].osm += 1;

    if (!shouldKeepCatalogRecord(r, filterOpts)) {
      leakage.push({ id: r.id, state: r.state, name: r.name, source: r.source, reason: catalogRejectReason(r, filterOpts) });
    } else if (r.source === "osm" && verifiedAdmins.has(r.state) && r.osmConfidence !== "protection_title") {
      suspiciousOsm.push({ id: r.id, state: r.state, name: r.name, osmConfidence: r.osmConfidence });
    }
    if (isExcludedUsStateParkName(r.name) && country === "US" && !/historic/i.test(r.name)) {
      leakage.push({ id: r.id, state: r.state, name: r.name, source: r.source, reason: "excluded-name-in-master" });
    }
  }
  return { byAdmin, leakage, suspiciousOsm };
}

function buildReport(matrix, usMaster, caMaster, verifiedAdmins) {
  const usSummary = summarizeMaster(usMaster, "US", verifiedAdmins);
  const caSummary = summarizeMaster(caMaster, "CA", verifiedAdmins);
  const rows = [];

  for (const row of matrix.us || []) {
    const admin = row.admin;
    const counts = usSummary.byAdmin[admin] || { total: 0, official: 0, osm: 0 };
    const expected = row.featureCount ?? null;
    const listing = US_LISTINGS[admin];
    const listingCache = loadListingCache(admin);
    rows.push({
      admin,
      country: "US",
      masterCount: counts.total,
      officialInMaster: counts.official,
      osmInMaster: counts.osm,
      listingCount: listingCache?.count ?? null,
      listingMethod: listingCache?.scrapeMethod ?? null,
      tierAGisCount: expected,
      tierAStatus: row.status,
      agency: listing?.agency || row.agency,
      officialListing: listing?.listing || null,
      wikipedia: listing ? `https://en.wikipedia.org/wiki/${listing.wiki}` : null,
      flags: [],
    });
    const last = rows[rows.length - 1];
    if (row.status === "verified" && expected && counts.total < expected * 0.5) last.flags.push("under_official_gis");
    if (row.status === "verified" && expected && counts.total > expected * 1.5) last.flags.push("over_official_gis");
    if (counts.osm > 0 && verifiedAdmins.has(admin)) last.flags.push("has_osm_in_tier_a_state");
    if (listingCache?.count && counts.total && Math.abs(counts.total - listingCache.count) > listingCache.count * 0.25) {
      last.flags.push("listing_master_mismatch");
    }
    if (row.status === "verified" && !listingCache?.count) last.flags.push("missing_listing_cache");
  }

  for (const row of matrix.ca || []) {
    const admin = row.admin;
    const counts = caSummary.byAdmin[admin] || { total: 0, official: 0, osm: 0 };
    const listing = CA_LISTINGS[admin];
    const listingCache = loadListingCache(admin);
    rows.push({
      admin,
      country: "CA",
      masterCount: counts.total,
      officialInMaster: counts.official,
      osmInMaster: counts.osm,
      listingCount: listingCache?.count ?? null,
      listingMethod: listingCache?.scrapeMethod ?? null,
      tierAGisCount: row.featureCount ?? null,
      tierAStatus: row.status,
      agency: listing?.agency || row.agency,
      officialListing: listing?.listing || null,
      wikipedia: listing ? `https://en.wikipedia.org/wiki/${listing.wiki}` : null,
      flags: [],
    });
    const last = rows[rows.length - 1];
    if (listingCache?.count && counts.total && Math.abs(counts.total - listingCache.count) > listingCache.count * 0.25) {
      last.flags.push("listing_master_mismatch");
    }
    if (row.status === "verified" && !listingCache?.count) last.flags.push("missing_listing_cache");
  }

  return {
    generated: new Date().toISOString(),
    summary: {
      usMaster: usMaster.count,
      caMaster: caMaster.count,
      usLeakage: usSummary.leakage.length,
      caLeakage: caSummary.leakage.length,
      usSuspiciousOsm: usSummary.suspiciousOsm.length,
    },
    leakage: [...usSummary.leakage, ...caSummary.leakage].slice(0, 100),
    suspiciousOsmInTierAStates: [...usSummary.suspiciousOsm, ...caSummary.suspiciousOsm].slice(0, 100),
    byAdmin: rows.sort((a, b) => a.admin.localeCompare(b.admin)),
  };
}

const writeSources = process.argv.includes("--write-sources");
log("build-state-parks-cross-check.mjs starting");
const matrix = loadSourceMatrix();
const verifiedAdmins = new Set([
  ...verifiedSources(matrix, "US").map((r) => r.admin),
  ...verifiedSources(matrix, "CA").map((r) => r.admin),
]);

const sources = buildSourcesPayload(matrix);
if (writeSources || !fs.existsSync(SOURCES_PATH)) {
  writeJson(SOURCES_PATH, sources);
  log(`Wrote ${SOURCES_PATH}`);
}

const usMaster = readJson(MASTER_US_PATH, { records: [], count: 0 });
const caMaster = readJson(MASTER_CA_PATH, { records: [], count: 0 });
const report = buildReport(matrix, usMaster, caMaster, verifiedAdmins);
writeJson(REPORT_PATH, report);

logSection("Cross-check summary");
log(`US master: ${report.summary.usMaster} | leakage: ${report.summary.usLeakage} | suspicious OSM in Tier-A states: ${report.summary.usSuspiciousOsm}`);
log(`CA master: ${report.summary.caMaster} | leakage: ${report.summary.caLeakage}`);
const flagged = report.byAdmin.filter((r) => r.flags.length);
log(`Flagged admins: ${flagged.length}`);
for (const row of flagged.slice(0, 15)) {
  log(`  ${row.admin}: ${row.flags.join(", ")} (master ${row.masterCount}, GIS ~${row.tierAGisCount ?? "?"})`, { level: "warn" });
}
log(`Wrote ${REPORT_PATH}`);
