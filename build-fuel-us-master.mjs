/**
 * Merge OSM fuel ingest into fuel-us-master.json; dedupe Pilot/Flying J clusters.
 */
import fs from "fs";
import path from "path";
import {
  INGEST_DIR,
  MASTER_PATH,
  QA_PATH,
  SUPPRESSED_PATH,
  TOOLS_DIR,
  haversineMi,
  loadBrandCatalog,
  readJson,
  reconcileFuelNeedsReview,
  writeJson,
} from "./fuel-us-lib.mjs";
import { applyInferredState } from "./camping-us-geo-utils.mjs";
import { classifyFuelRecords } from "./fuel-type-infer.mjs";
import { normalizeFuelType } from "./fuel-brand-lib.mjs";

const DEDUPE_MI = 0.12;
const PFJ_MI = 0.25;
const OFFICIAL_TYPE_MATCH_MI = 0.5;

const SUPPLEMENTS_PATH = path.join(TOOLS_DIR, "fuel-us-supplements.json");
const OFFICIAL_REJECTS_PATH = path.join(TOOLS_DIR, "fuel-us-official-rejects.json");
const LEGACY_BUCEES_REJECTS_PATH = path.join(TOOLS_DIR, "fuel-us-bucees-rejects.json");
const OFFICIAL_CACHE = path.join(INGEST_DIR, "official-cache");
const OFFICIAL_DIR = path.join(INGEST_DIR, "official");

function loadOfficialStoresForTyping() {
  const byBrand = new Map();
  const loves = readJson(path.join(OFFICIAL_CACHE, "loves", "loves-fetch-stores.json"));
  if (loves?.stores?.length) byBrand.set("loves", loves.stores);
  const cefco = readJson(path.join(OFFICIAL_CACHE, "cefco", "cefco-official.json"));
  if (cefco?.stores?.length) byBrand.set("cefco", cefco.stores);
  const pfj =
    readJson(path.join(OFFICIAL_DIR, "pfj-official.json")) ||
    readJson(path.join(OFFICIAL_CACHE, "pfj", "pfj-official.json"));
  if (pfj?.stores?.length) {
    byBrand.set("pilot", pfj.stores);
    byBrand.set("flyingj", pfj.stores);
    byBrand.set("pilot_flyingj", pfj.stores);
  }
  return byBrand;
}

/** Copy per-store type (and format signals) from official locator onto nearby OSM rows. */
function stampOfficialTypes(records) {
  const byBrand = loadOfficialStoresForTyping();
  if (!byBrand.size) return records;
  let stamped = 0;
  for (const rec of records) {
    const stores = byBrand.get(rec.brandId);
    if (!stores?.length) continue;
    let best = null;
    let bestD = OFFICIAL_TYPE_MATCH_MI;
    for (const s of stores) {
      if (s.lat == null || s.lon == null) continue;
      const d = haversineMi([rec.lat, rec.lon], [s.lat, s.lon]);
      if (d <= bestD) {
        bestD = d;
        best = s;
      }
    }
    if (!best) continue;
    if (best.type) {
      rec.type = normalizeFuelType(best.type);
      stamped++;
    }
    if (best.mapPinUrl) rec.mapPinUrl = best.mapPinUrl;
    if (best.isLargeFormat != null) rec.isLargeFormat = best.isLargeFormat;
    if (best.isFullTravelCenter != null) rec.isFullTravelCenter = best.isFullTravelCenter;
    if (best.storefrontBrand) rec.storefrontBrand = best.storefrontBrand;
    if (best.showersCount != null) rec.showersCount = best.showersCount;
  }
  if (stamped) console.log(`Stamped official type on ${stamped} OSM records`);
  return records;
}

function osmKey(rec) {
  if (!rec.osm) return rec.id;
  return `${rec.osm.type}:${rec.osm.id}`;
}

function loadOfficialRejectKeys() {
  const j = readJson(OFFICIAL_REJECTS_PATH) || readJson(LEGACY_BUCEES_REJECTS_PATH);
  if (!j?.osmKeys?.length) return new Set();
  return new Set(j.osmKeys);
}

function applyOfficialRejects(records) {
  const rejectKeys = loadOfficialRejectKeys();
  if (!rejectKeys.size) return { records, rejected: [] };
  const kept = [];
  const rejected = [];
  for (const rec of records) {
    if (rejectKeys.has(osmKey(rec))) {
      rejected.push(rec);
      continue;
    }
    kept.push(rec);
  }
  return { records: kept, rejected };
}

function slimDropped(rec) {
  return {
    id: rec.id,
    lat: rec.lat,
    lon: rec.lon,
    name: rec.name,
    brandId: rec.brandId,
    brand: rec.brand,
    state: rec.state || "",
    osmTags: rec.osmTags || {},
    osm: rec.osm,
    url: rec.url || "",
  };
}

function suppressedEntry(keptRec, droppedRec, reason) {
  return {
    kept: keptRec.id,
    dropped: droppedRec.id,
    reason,
    droppedRecord: slimDropped(droppedRec),
  };
}

function loadSupplementRecords() {
  const j = readJson(SUPPLEMENTS_PATH);
  return j?.records ?? [];
}

/** Drop stale manual supplements superseded by official reconcile entries nearby. */
function dropLegacyBuceesPublicList(records) {
  const bucees = records.filter((r) => r.brandId === "bucees");
  const legacy = bucees.filter((r) => (r.sources || []).includes("bucees-public-list"));
  if (!legacy.length) return records;
  const dropIds = new Set();
  for (const old of legacy) {
    for (const other of bucees) {
      if (other.id === old.id) continue;
      if (haversineMi([old.lat, old.lon], [other.lat, other.lon]) <= DEDUPE_MI) {
        dropIds.add(old.id);
        break;
      }
    }
  }
  if (!dropIds.size) return records;
  return records.filter((r) => !dropIds.has(r.id));
}

function mergeSupplements(master, supplements) {
  const out = [...master];
  const suppressed = [];
  for (const rec of supplements) {
    let merged = false;
    for (const existing of out) {
      const d = haversineMi([rec.lat, rec.lon], [existing.lat, existing.lon]);
      if (d <= DEDUPE_MI && rec.brandId === existing.brandId) {
        suppressed.push(suppressedEntry(existing, rec, "supplement-near-existing"));
        merged = true;
        break;
      }
    }
    if (!merged) {
      const flags = rec.mapFlags || [];
      const mapFlags = flags.includes("SUPPLEMENT") ? [...flags] : [...flags, "SUPPLEMENT"];
      out.push({ ...rec, mapFlags });
    }
  }
  return { master: out, suppressed };
}

function loadOsmRecords() {
  const mergedPath = path.join(INGEST_DIR, "01-osm", "fuel-merged.json");
  const j = readJson(mergedPath);
  if (j?.records?.length) return j.records;

  const outDir = path.join(INGEST_DIR, "01-osm");
  const all = [];
  if (fs.existsSync(outDir)) {
    for (const f of fs.readdirSync(outDir).filter((n) => /^osm-[A-Z]{2}\.json$/.test(n))) {
      const st = readJson(path.join(outDir, f));
      if (st?.records) all.push(...st.records);
    }
  }
  if (!all.length) throw new Error("Run: node build-fuel-us-extract-all-pbf.mjs && node build-fuel-us-filter-brands.mjs");
  return all;
}

function dedupeRecords(records) {
  const out = [];
  const suppressed = [];

  for (const rec of records) {
    let merged = false;
    for (const existing of out) {
      const d = haversineMi([rec.lat, rec.lon], [existing.lat, existing.lon]);
      if (d > DEDUPE_MI) continue;
      if (rec.brandId === existing.brandId) {
        suppressed.push(suppressedEntry(existing, rec, "same-brand-near"));
        merged = true;
        break;
      }
      const pfj =
        (rec.brandId === "pilot" || rec.brandId === "flyingj") &&
        (existing.brandId === "pilot" || existing.brandId === "flyingj");
      if (pfj && d <= PFJ_MI) {
        existing.brandId = "pilot_flyingj";
        existing.brand = "Pilot / Flying J";
        existing.mapFlags = [...new Set([...(existing.mapFlags || []), "PILOT_FJ_CLUSTER"])];
        suppressed.push(suppressedEntry(existing, rec, "pilot-fj-merge"));
        merged = true;
        break;
      }
    }
    if (!merged) out.push({ ...rec, mapFlags: [...(rec.mapFlags || [])] });
  }
  return { master: out, suppressed };
}

function buildQaReport(master, catalog, suppressed) {
  const byBrand = {};
  const byState = {};
  const byType = {};
  const byBrandType = {};
  for (const r of master) {
    byBrand[r.brandId] = (byBrand[r.brandId] || 0) + 1;
    const st = r.state || "?";
    byState[st] = (byState[st] || 0) + 1;
    const t = r.type || "?";
    byType[t] = (byType[t] || 0) + 1;
    const key = `${r.brandId}:${t}`;
    byBrandType[key] = (byBrandType[key] || 0) + 1;
  }
  return {
    generated: new Date().toISOString(),
    recordCount: master.length,
    catalogBrandIds: catalog.brands.map((b) => b.id),
    byBrand,
    byType,
    byBrandType,
    byState,
    suppressedCount: suppressed.length,
    suppressedSample: suppressed.slice(0, 30),
  };
}

export function buildFuelMaster() {
  const catalog = loadBrandCatalog();
  const catalogById = Object.fromEntries(catalog.brands.map((b) => [b.id, b]));
  const raw = dropLegacyBuceesPublicList(loadOsmRecords());
  const { records: officialFiltered, rejected: officialRejected } = applyOfficialRejects(raw);
  stampOfficialTypes(officialFiltered);
  const { records: classified, dropped: nonFuelDropped } = classifyFuelRecords(
    officialFiltered,
    catalogById
  );
  const supplementsRaw = loadSupplementRecords();
  const { records: supplements, dropped: supplementNonFuel } = classifyFuelRecords(
    supplementsRaw,
    catalogById
  );
  const { master: deduped, suppressed: dedupeSuppressed } = dedupeRecords(classified);
  const { master, suppressed: supplementSuppressed } = mergeSupplements(deduped, supplements);
  const suppressed = [
    ...dedupeSuppressed,
    ...supplementSuppressed,
    ...officialRejected.map((rec) =>
      suppressedEntry({ id: "official-reconcile" }, rec, "not-on-official-brand-list")
    ),
    ...nonFuelDropped.map((rec) =>
      suppressedEntry({ id: "non-fuel-service" }, rec, "speedco-cardlock-or-dealer-not-fuel-retail")
    ),
    ...supplementNonFuel.map((rec) =>
      suppressedEntry({ id: "non-fuel-service" }, rec, "speedco-cardlock-or-dealer-not-fuel-retail")
    ),
  ];
  for (const rec of master) {
    rec.type = normalizeFuelType(rec.type);
    rec.mapFlags = rec.mapFlags || [];
    rec.reviewReasons = rec.reviewReasons || [];
    applyInferredState(rec);
    if (!rec.state) {
      rec.mapFlags.push("NO_STATE");
      rec.needsReview = true;
    }
    reconcileFuelNeedsReview(rec);
  }

  const payload = {
    generated: new Date().toISOString(),
    source: "OpenStreetMap + fuel-us-brand-catalog",
    recordCount: master.length,
    records: master,
  };
  writeJson(MASTER_PATH, payload);
  writeJson(QA_PATH, buildQaReport(master, catalog, suppressed));
  writeJson(SUPPRESSED_PATH, {
    generated: payload.generated,
    count: suppressed.length,
    records: suppressed,
  });
  console.log("Wrote", MASTER_PATH, master.length, "stations");
  return payload;
}

if (process.argv[1]?.endsWith("build-fuel-us-master.mjs")) {
  buildFuelMaster();
}
