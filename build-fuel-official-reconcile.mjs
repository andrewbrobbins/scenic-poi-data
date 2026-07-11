/**
 * Reconcile fuel OSM catalog matches against official brand locators.
 *
 * Usage:
 *   node build-fuel-official-reconcile.mjs --region=us
 *   node build-fuel-official-reconcile.mjs --region=ca
 *   node build-fuel-official-reconcile.mjs --region=both
 *   node build-fuel-official-reconcile.mjs --region=us --brand=bucees
 *   node build-fuel-official-reconcile.mjs --region=us --apply-master
 *   node build-fuel-official-reconcile.mjs --region=us --pilot-max=100
 *
 * Run after filter-brands, before master merge.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  DEFAULT_MATCH_MI,
  loadOsmBrandCandidates,
  osmKey,
  reconcileBrand,
  writeCache,
} from "./fuel-official-reconcile-lib.mjs";
import {
  CA_RECONCILE_BRANDS,
  US_RECONCILE_BRANDS,
  PFJ_BRAND_IDS,
  fetchOfficialForBrand,
  resetPilotCache,
} from "./fuel-official-sources.mjs";
import { INGEST_DIR as US_INGEST, MASTER_PATH as US_MASTER, readJson, writeJson } from "./fuel-us-lib.mjs";
import { INGEST_DIR as CA_INGEST, MASTER_PATH as CA_MASTER } from "./fuel-ca-lib.mjs";
import { normalizeFuelType } from "./fuel-brand-lib.mjs";

const TOOLS = path.dirname(fileURLToPath(import.meta.url));

export function pathsForRegion(region) {
  const ingest = region === "ca" ? CA_INGEST : US_INGEST;
  const master = region === "ca" ? CA_MASTER : US_MASTER;
  return {
    region,
    ingest,
    master,
    merged: path.join(ingest, "01-osm", "fuel-merged.json"),
    officialDir: path.join(ingest, "official"),
    cacheDir: path.join(ingest, "official-cache"),
    rejects: path.join(TOOLS, `fuel-${region}-official-rejects.json`),
    supplements: path.join(TOOLS, `fuel-${region}-supplements.json`),
    report: path.join(TOOLS, `fuel-${region}-official-reconcile-report.json`),
  };
}

function parseArgs() {
  const regionArg = process.argv.find((a) => a.startsWith("--region="));
  const brandArg = process.argv.find((a) => a.startsWith("--brand="));
  const pilotMaxArg = process.argv.find((a) => a.startsWith("--pilot-max="));
  return {
    regions: regionArg?.split("=")[1] === "both" ? ["us", "ca"] : [regionArg?.split("=")[1] || "us"],
    brandFilter: brandArg?.split("=")[1] || null,
    applyMaster: process.argv.includes("--apply-master"),
    pilotMax: pilotMaxArg ? Number(pilotMaxArg.split("=")[1]) : null,
  };
}

function osmBrandIdsForReconcile(brandList) {
  const ids = new Set();
  for (const b of brandList) {
    if (b === "pfj") {
      for (const x of PFJ_BRAND_IDS) ids.add(x);
    } else {
      ids.add(b);
    }
  }
  return [...ids];
}

function normalizeBrandFilter(brandFilter) {
  if (brandFilter === "pilot" || brandFilter === "flyingj" || brandFilter === "pilot_flyingj") {
    return "pfj";
  }
  return brandFilter;
}

export async function reconcileOfficialRegion(region, opts = {}) {
  resetPilotCache();
  const paths = pathsForRegion(region);
  fs.mkdirSync(paths.officialDir, { recursive: true });
  fs.mkdirSync(paths.cacheDir, { recursive: true });

  const brandList =
    opts.brandFilter != null
      ? [normalizeBrandFilter(opts.brandFilter)]
      : region === "ca"
        ? CA_RECONCILE_BRANDS
        : US_RECONCILE_BRANDS;

  const { source: osmSource, records: allOsm } = loadOsmBrandCandidates({
    mergedPath: paths.merged,
    masterPath: paths.master,
    brandIds: osmBrandIdsForReconcile(brandList),
  });
  console.log(`\n=== ${region.toUpperCase()} official reconcile (${allOsm.length} OSM candidates from ${osmSource}) ===`);

  const allRejects = [];
  const allSupplements = [];
  const brandReports = [];
  const skipped = [];

  if (opts.brandFilter && fs.existsSync(paths.rejects)) {
    const prevRejects = readJson(paths.rejects)?.records || [];
    const rerun = new Set(brandList);
    allRejects.push(...prevRejects.filter((r) => !rerun.has(r.brandId)));
  }
  if (opts.brandFilter && fs.existsSync(paths.supplements)) {
    const prevSupp = readJson(paths.supplements)?.records || [];
    const rerun = new Set(brandList);
    allSupplements.push(...prevSupp.filter((r) => !rerun.has(r.brandId)));
  }
  if (opts.brandFilter && fs.existsSync(paths.report)) {
    const prev = readJson(paths.report);
    brandReports.push(...(prev?.brands || []).filter((b) => !brandList.includes(b.brandId)));
    skipped.push(...(prev?.skipped || []).filter((s) => !brandList.includes(s.brandId)));
  }

  for (const brandId of brandList) {
    console.log(`\n-- ${brandId} --`);
    const official = await fetchOfficialForBrand(brandId, {
      region,
      cacheDir: path.join(paths.cacheDir, brandId),
      maxPages: opts.pilotMax || undefined,
    });

    writeCache(path.join(paths.officialDir, `${brandId}-official.json`), {
      generated: new Date().toISOString(),
      ...official,
    });

    if (official.skipped) {
      console.log(`  skipped: ${official.reason}`);
      skipped.push({ brandId, reason: official.reason, docs: official.docs });
      continue;
    }

    if (!(official.stores?.length)) {
      const reason = "Official source returned zero stores — skipping reconcile to avoid false OSM rejects";
      console.log(`  skipped: ${reason}`);
      skipped.push({ brandId, reason, docs: official.source || "" });
      continue;
    }

    const osmBrand =
      brandId === "pfj"
        ? allOsm.filter((r) => PFJ_BRAND_IDS.has(r.brandId))
        : allOsm.filter((r) => r.brandId === brandId);
    const result = reconcileBrand(osmBrand, official, { region, matchMi: DEFAULT_MATCH_MI });
    console.log(
      `  official=${result.officialCount} osm=${result.osmCount} matched=${result.matchedCount} rejected=${result.rejectedCount} supplements=${result.supplementCount}`
    );

    allRejects.push(...result.rejects);
    allSupplements.push(...result.supplements);
    brandReports.push({
      brandId,
      source: result.source,
      sourceType: result.sourceType,
      officialCount: result.officialCount,
      osmCount: result.osmCount,
      matchedCount: result.matchedCount,
      rejectedCount: result.rejectedCount,
      supplementCount: result.supplementCount,
      reconcileNote:
        brandId === "bucees"
          ? "Matches open stores from buc-ees.com JSON-LD only. No mega/small size filter. OSM rejects = no official store within match radius."
          : brandId === "maverik"
            ? "Matches stores listed on locations.maverik.com (Yext sitemap). OSM rejects = not on official locator; supplements = official-only gaps."
            : brandId === "kwiktrip" || brandId === "kwikstar"
              ? "Matches fuel stores from api.kwiktrip.com store/information scan. OSM rejects = not on official API; supplements = official-only gaps."
              : brandId === "wallys"
                ? "Matches leaflet map markers on wallys.com/locations (3 travel centers)."
                : brandId === "busy_bee"
                  ? "Matches shopthebusybee.com WP store_search AJAX (FL travel centers)."
                  : brandId === "parkers"
                    ? "Matches parkerskitchen.com location pages (Google Maps daddr coords)."
                    : brandId === "cefco"
                      ? "All CEFCO locations from sitemap + Nominatim; type = travel_plaza (Kitchen/Travel Center) or convenience_fuel."
                      : brandId === "loves"
                        ? "All Love's fuel sites from fetch_stores (travel stops + country stores); Speedco dropped. type from map pin."
                        : brandId === "pfj" || brandId === "pilot" || brandId === "flyingj" || brandId === "pilot_flyingj"
                          ? "All Pilot/Flying J fuel retail pages; dealers dropped. type = travel_plaza or convenience_fuel from Yext facility."
                          : brandId === "royal_farms"
                            ? "Matches storelocator.royalfarms.com/api/stores (fuel-capable sites)."
                            : brandId === "quickchek"
                              ? "Matches quickchek.com get_sorted_locations AJAX (fuel sites in NY/NJ grid)."
                              : undefined,
      matched: result.matched.map((m) => ({
        osmId: m.osm.id,
        official: m.official.label,
        distanceMi: m.distanceMi,
        type: normalizeFuelType(m.official.type),
      })),
      rejectedSample: result.rejects.slice(0, 8).map((r) => ({
        name: r.record.name,
        state: r.record.state,
        nearestOfficialMi: r.nearestOfficialMi,
      })),
      supplementSample: result.supplements.slice(0, 8).map((s) => ({
        name: s.name,
        state: s.state,
        officialId: s.officialId,
      })),
      meta: official.meta,
    });
  }

  writeJson(paths.rejects, {
    generated: new Date().toISOString(),
    matchRadiusMi: DEFAULT_MATCH_MI,
    count: allRejects.length,
    osmKeys: allRejects.map((r) => r.osmKey),
    records: allRejects,
  });

  writeJson(paths.supplements, {
    generated: new Date().toISOString(),
    source: "Official brand reconcile — stores on brand locators not matched to OSM",
    matchRadiusMi: DEFAULT_MATCH_MI,
    recordCount: allSupplements.length,
    records: allSupplements,
  });

  const report = {
    generated: new Date().toISOString(),
    region,
    matchRadiusMi: DEFAULT_MATCH_MI,
    osmSource,
    brands: brandReports,
    skipped,
    totals: {
      rejected: allRejects.length,
      supplements: allSupplements.length,
      matched: brandReports.reduce((a, b) => a + b.matchedCount, 0),
    },
  };
  writeJson(paths.report, report);

  console.log(`\nWrote ${paths.rejects} (${allRejects.length} rejects)`);
  console.log(`Wrote ${paths.supplements} (${allSupplements.length} supplements)`);
  console.log(`Wrote ${paths.report}`);

  return { paths, report, allRejects, allSupplements };
}

export function applyOfficialReconcileToMaster(region, reportPath) {
  const paths = pathsForRegion(region);
  const rejectKeys = new Set((readJson(paths.rejects)?.osmKeys || []));
  const supplements = readJson(paths.supplements)?.records || [];
  const matchedByOsmId = new Map();
  for (const b of readJson(reportPath)?.brands || []) {
    for (const m of b.matched || []) matchedByOsmId.set(m.osmId, m);
  }

  const master = readJson(paths.master);
  if (!master?.records) throw new Error(`Missing ${paths.master}`);

  const kept = [];
  let removed = 0;
  for (const rec of master.records) {
    if (rejectKeys.has(osmKey(rec))) {
      removed++;
      continue;
    }
    if (rec.osm && matchedByOsmId.has(rec.id)) {
      rec.sources = [...new Set([...(rec.sources || []), "official-verified"])];
    }
    kept.push(rec);
  }

  for (const sup of supplements) {
    let dup = false;
    for (const existing of kept) {
      if (existing.brandId === sup.brandId && Math.abs(existing.lat - sup.lat) < 0.001 && Math.abs(existing.lon - sup.lon) < 0.001) {
        dup = true;
        break;
      }
    }
    if (!dup) kept.push(sup);
  }

  master.records = kept;
  master.recordCount = kept.length;
  master.generated = new Date().toISOString();
  master.officialReconcile = {
    applied: master.generated,
    region,
    removed,
    supplementsAdded: supplements.length,
  };
  writeJson(paths.master, master);
  console.log(`Updated ${paths.master}: ${kept.length} records (removed ${removed} rejected OSM, added ${supplements.length} supplements)`);
  return master;
}

if (process.argv[1]?.endsWith("build-fuel-official-reconcile.mjs")) {
  const args = parseArgs();
  (async () => {
    for (const region of args.regions) {
      await reconcileOfficialRegion(region, {
        brandFilter: args.brandFilter,
        pilotMax: args.pilotMax,
      });
      if (args.applyMaster) {
        applyOfficialReconcileToMaster(region, pathsForRegion(region).report);
      }
    }
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
