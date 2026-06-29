/**
 * Merge official listings + GIS → committed master JSON (US + CA).
 * Tier-A states: official website listing is source of truth when it produces records.
 * OSM supplements any admin (including Tier-A) with zero listing/GIS official records.
 */
import path from "path";
import { log, logSection } from "./pipeline-log.mjs";
import { loadAllOfficialRecords, loadSourceMatrix, catalogBackedAdmins, verifiedSources } from "./state-parks-official-lib.mjs";
import {
  aggregateOfficialByListing,
  loadAllListingCaches,
  loadListingCache,
  isStandaloneListing,
} from "./state-parks-listing-lib.mjs";
import { listingKeyFromPublicName } from "./state-parks-listing-adapters.mjs";
import {
  INGEST_DIR,
  MASTER_CA_PATH,
  MASTER_US_PATH,
  QA_PATH,
  mergeRecords,
  countByAdmin,
  countByCategory,
  readJson,
  writeJson,
  stateParkDisplayName,
  normalizeOfficialParkAbbrevFields,
  shouldKeepCatalogRecord,
  normalizeName,
  coordValid,
} from "./state-parks-lib.mjs";

function loadExtract(country) {
  const sourceKey = country === "CA" ? "ca" : "us";
  const p = path.join(INGEST_DIR, "00-pbf", `state-parks-${sourceKey}.json`);
  log(`Loading ${country} extract: ${p}`);
  const j = readJson(p, { records: [] });
  const count = j.records?.length || j.recordCount || 0;
  if (!count) {
    log(`WARN: empty or missing extract — run node build-state-parks-extract-pbf.mjs --source=${sourceKey}`, {
      level: "warn",
    });
  } else {
    log(`${country}: ${count} raw records from PBF extract`);
  }
  return j;
}

function listingMatchKey(listing) {
  if (listing.name && /state park|historic/i.test(listing.name)) {
    return listingKeyFromPublicName(listing.name);
  }
  return listingKeyFromPublicName((listing.key || "").replace(/-/g, " "));
}

function matchListingToOsm(listing, osmRecords) {
  const key = listingMatchKey(listing);
  if (!key) return null;
  for (const osm of osmRecords) {
    const osmKey = listingKeyFromPublicName(osm.name);
    if (osmKey === key || osmKey.startsWith(`${key} `) || key.startsWith(`${osmKey} `)) return osm;
    if (normalizeName(osm.name).includes(key) && key.length >= 6) return osm;
  }
  return null;
}

function buildOfficialFromListingOsmMatch(admin, listingCache, osmForAdmin, country) {
  const listings = (listingCache?.listings || []).filter((l) => isStandaloneListing(l, admin));
  const minListings = 3;
  const minMatched = 3;
  if (listings.length < minListings) return [];

  const matched = [];
  const usedOsm = new Set();
  for (const listing of listings) {
    let lat = listing.lat;
    let lon = listing.lon;
    let coordSource = listing.coordSource;
    if (lat == null || lon == null || !coordValid(lat, lon, country)) {
      const osm = matchListingToOsm(
        listing,
        osmForAdmin.filter((r) => !usedOsm.has(r.id))
      );
      if (!osm) continue;
      usedOsm.add(osm.id);
      lat = osm.lat;
      lon = osm.lon;
      coordSource = "osm_name_match";
    }
    matched.push({ ...listing, lat, lon, coordSource });
  }

  if (matched.length < minMatched) return [];
  const out = aggregateOfficialByListing([], matched, admin);
  if (out.length) {
    log(`  ${admin}: ${listings.length} listings → ${out.length} via listing+OSM coords`);
  }
  return out;
}

function buildOfficialForAdmin(admin, officialRecords, listingCache, catalogAdmins, osmForAdmin, country) {
  const stateOfficial = officialRecords.filter((r) => r.state === admin && r.source === "official");

  if (catalogAdmins.has(admin) && listingCache?.listings?.length) {
    const aggregated = aggregateOfficialByListing(stateOfficial, listingCache.listings, admin);
    if (aggregated.length > 0) {
      const gisBacked = listingCache.scrapeMethod?.includes("wikipedia");
      const weakListing =
        gisBacked &&
        stateOfficial.length >= 5 &&
        aggregated.length < Math.min(stateOfficial.length * 0.85, stateOfficial.length - 2);
      if (weakListing) {
        log(
          `  ${admin}: Listing matched only ${aggregated.length}/${stateOfficial.length} GIS — falling back to official GIS`,
          { level: "warn" }
        );
        return stateOfficial;
      }
      const parks = aggregated.filter((r) => r.category === "park" && !r.alsoHistoricSite).length;
      const combined = aggregated.filter((r) => r.alsoHistoricSite).length;
      const historic = aggregated.filter((r) => r.category === "historic_site").length;
      log(
        `  ${admin}: ${stateOfficial.length} GIS → ${aggregated.length} listing parks (${parks} parks, ${combined} park+historic, ${historic} historic-only)`
      );
      return aggregated;
    }
    if (stateOfficial.length > 0) {
      log(
        `  ${admin}: listing matched 0 / ${listingCache.listings.length} — falling back to ${stateOfficial.length} official GIS`,
        { level: "warn" }
      );
      return stateOfficial;
    }
    log(`  ${admin}: listing matched 0, no GIS — eligible for OSM supplement`, { level: "warn" });
    return buildOfficialFromListingOsmMatch(admin, listingCache, osmForAdmin, country);
  }

  if (catalogAdmins.has(admin)) {
    log(`  ${admin}: ${stateOfficial.length} official GIS (no listing cache — run build-state-parks-ingest-listings.mjs)`, {
      level: "warn",
    });
    return stateOfficial;
  }

  return stateOfficial;
}

function buildMaster(country, outPath, officialRecords, catalogAdmins, listingCaches) {
  logSection(`Build ${country} master`);
  const extract = loadExtract(country);
  const rawOsmAll = extract.records || [];
  const rawOfficialAll = officialRecords.filter((r) => r.country === country);
  const filterOpts = { verifiedOfficialAdmins: catalogAdmins };

  const admins = new Set([
    ...rawOfficialAll.map((r) => r.state),
    ...rawOsmAll.map((r) => r.state),
  ]);

  const officialMerged = [];
  for (const admin of [...admins].sort()) {
    officialMerged.push(
      ...buildOfficialForAdmin(
        admin,
        rawOfficialAll,
        listingCaches.get(admin) || loadListingCache(admin),
        catalogAdmins,
        rawOsmAll.filter((r) => r.state === admin),
        country
      )
    );
  }

  const officialCountByAdmin = countByAdmin(officialMerged);

  const osmSupplement = rawOsmAll.filter((r) => {
    if (!shouldKeepCatalogRecord(r, filterOpts)) return false;
    const officialCount = officialCountByAdmin[r.state] || 0;
    if (officialCount > 0) return false;
    return true;
  });

  const rawIn = [...officialMerged, ...osmSupplement];
  const excluded = rawOfficialAll.length + rawOsmAll.length - rawIn.length;
  if (excluded) log(`  Excluded ${excluded} GIS/OSM records (listing allowlist + filters)`);
  log(
    `Merging ${officialMerged.length} official (listing-backed) + ${osmSupplement.length} OSM supplement = ${rawIn.length} records...`
  );

  const { records, conflicts } = mergeRecords(rawIn);
  log(`  → ${records.length} units after dedupe (${conflicts.length} name conflicts)`);

  records.sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
  for (let i = 0; i < records.length; i += 1) {
    const rec = normalizeOfficialParkAbbrevFields(records[i]);
    if (!rec.displayName) rec.displayName = stateParkDisplayName(rec.name, rec.designation, rec.country);
    records[i] = rec;
  }

  const sources = [];
  if (officialMerged.length) sources.push("official");
  if (osmSupplement.length) sources.push("osm-pbf");

  const payload = {
    generated: new Date().toISOString(),
    source: sources.length === 2 ? "official+osm-pbf" : sources[0] || "osm-pbf",
    country,
    count: records.length,
    categories: countByCategory(records),
    byAdmin: countByAdmin(records),
    needsReviewCount: records.filter((r) => r.needsReview).length,
    officialCount: officialMerged.length,
    osmCount: osmSupplement.length,
    listingBackedAdmins: [...listingCaches.keys()].sort(),
    pbfPath: extract.pbfPath || null,
    records,
  };

  log(`Writing ${outPath}...`);
  writeJson(outPath, payload);
  log(`Wrote ${outPath}: ${payload.count} records, ${payload.needsReviewCount} need review`);
  return { payload, conflicts, rawCount: rawIn.length, extractMeta: extract };
}

log("build-state-parks-master.mjs starting");
const officialRecords = loadAllOfficialRecords();
log(`Loaded ${officialRecords.length} official records from cache`);
const matrix = loadSourceMatrix();
const catalogAdmins = new Set([
  ...catalogBackedAdmins(matrix, "US"),
  ...catalogBackedAdmins(matrix, "CA"),
]);
const listingCaches = loadAllListingCaches([...catalogAdmins]);
log(`Catalog-backed admins: ${catalogAdmins.size}; listing caches: ${listingCaches.size}`);

const us = buildMaster("US", MASTER_US_PATH, officialRecords, catalogAdmins, listingCaches);
const ca = buildMaster("CA", MASTER_CA_PATH, officialRecords, catalogAdmins, listingCaches);

log("Writing QA report...");
const qa = {
  generated: new Date().toISOString(),
  us: {
    recordCount: us.payload.count,
    officialCount: us.payload.officialCount,
    osmCount: us.payload.osmCount,
    needsReviewCount: us.payload.needsReviewCount,
    byAdmin: us.payload.byAdmin,
    rawMerged: us.rawCount,
    conflicts: us.conflicts.length,
  },
  ca: {
    recordCount: ca.payload.count,
    officialCount: ca.payload.officialCount,
    osmCount: ca.payload.osmCount,
    needsReviewCount: ca.payload.needsReviewCount,
    byAdmin: ca.payload.byAdmin,
    rawMerged: ca.rawCount,
    conflicts: ca.conflicts.length,
  },
  conflictCount: us.conflicts.length + ca.conflicts.length,
  conflictsSample: [...us.conflicts, ...ca.conflicts].slice(0, 50),
};
writeJson(QA_PATH, qa);
log(`Wrote ${QA_PATH} (${qa.conflictCount} unresolved name conflicts)`);
