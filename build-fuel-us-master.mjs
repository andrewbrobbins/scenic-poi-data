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

const DEDUPE_MI = 0.12;
const PFJ_MI = 0.25;

const SUPPLEMENTS_PATH = path.join(TOOLS_DIR, "fuel-us-supplements.json");

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
  for (const r of master) {
    byBrand[r.brandId] = (byBrand[r.brandId] || 0) + 1;
    const st = r.state || "?";
    byState[st] = (byState[st] || 0) + 1;
  }
  return {
    generated: new Date().toISOString(),
    recordCount: master.length,
    catalogBrandIds: catalog.brands.map((b) => b.id),
    byBrand,
    byState,
    suppressedCount: suppressed.length,
    suppressedSample: suppressed.slice(0, 30),
  };
}

export function buildFuelMaster() {
  const catalog = loadBrandCatalog();
  const raw = loadOsmRecords();
  const supplements = loadSupplementRecords();
  const { master: deduped, suppressed: dedupeSuppressed } = dedupeRecords(raw);
  const { master, suppressed: supplementSuppressed } = mergeSupplements(deduped, supplements);
  const suppressed = [...dedupeSuppressed, ...supplementSuppressed];
  for (const rec of master) {
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
