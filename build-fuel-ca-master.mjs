/**
 * Merge OSM fuel ingest into fuel-ca-master.json; dedupe Pilot/Flying J clusters.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  INGEST_DIR,
  MASTER_PATH,
  QA_PATH,
  haversineMi,
  loadBrandCatalog,
  slugify,
  readJson,
  writeJson,
} from "./fuel-ca-lib.mjs";
import { applyInferredState } from "./camping-ca-geo-utils.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));
const SUPPLEMENTS_PATH = path.join(tools, "fuel-ca-supplements.json");

const DEDUPE_MI = 0.12;
const PFJ_MI = 0.25;
/** Pair north/south ONroute plazas across the highway (~0.4 mi). */
const ONROUTE_PAIR_MI = 0.45;

function onroutePlaceKey(name) {
  return (name || "")
    .toLowerCase()
    .replace(/\bon\s*route\b/g, "")
    .replace(/\bonroute\b/g, "")
    .replace(/\b(north|south|east|west|northeast|northwest|southeast|southwest)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function mergeOnrouteHighwayPairs(records) {
  const onroutes = [];
  const other = [];
  for (const r of records) {
    if (r.brandId === "onroute") onroutes.push(r);
    else other.push(r);
  }
  const used = new Set();
  const merged = [];
  for (let i = 0; i < onroutes.length; i++) {
    if (used.has(i)) continue;
    const a = onroutes[i];
    const cluster = [a];
    const keyA = onroutePlaceKey(a.name);
    for (let j = i + 1; j < onroutes.length; j++) {
      if (used.has(j)) continue;
      const b = onroutes[j];
      const d = haversineMi([a.lat, a.lon], [b.lat, b.lon]);
      if (d > ONROUTE_PAIR_MI) continue;
      const keyB = onroutePlaceKey(b.name);
      if (keyA && keyB && keyA === keyB) {
        cluster.push(b);
        used.add(j);
      }
    }
    used.add(i);
    if (cluster.length === 1) {
      merged.push(a);
      continue;
    }
    let lat = 0;
    let lon = 0;
    for (const c of cluster) {
      lat += c.lat;
      lon += c.lon;
    }
    lat /= cluster.length;
    lon /= cluster.length;
    const baseName = cluster.map((c) => c.name).sort((x, y) => x.length - y.length)[0];
    const display = baseName
      .replace(/\b(North|South|East|West)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    merged.push({
      ...a,
      id: `FUEL-CA-ONROUTE-PAIR-${slugify(display)}`,
      name: display || a.name,
      lat,
      lon,
      mapFlags: [...new Set([...(a.mapFlags || []), "ONROUTE_HWY_PAIR"])],
      pairedCount: cluster.length,
    });
  }
  return [...other, ...merged];
}

function loadOsmRecords() {
  const mergedPath = path.join(INGEST_DIR, "01-osm", "fuel-merged.json");
  const j = readJson(mergedPath);
  const all = j?.records?.length ? [...j.records] : [];

  const outDir = path.join(INGEST_DIR, "01-osm");
  if (!all.length && fs.existsSync(outDir)) {
    for (const f of fs.readdirSync(outDir).filter((n) => /^osm-[A-Z]{2}\.json$/.test(n))) {
      const st = readJson(path.join(outDir, f));
      if (st?.records?.length) all.push(...st.records);
    }
  }

  const onroutePath = path.join(INGEST_DIR, "02-onroute", "onroute-ON.json");
  const onroute = readJson(onroutePath);
  if (onroute?.records?.length) all.push(...onroute.records);

  if (!all.length) throw new Error("Run: node build-fuel-ca-ingest-pbf.mjs");
  return all;
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
        suppressed.push({ kept: existing.id, dropped: rec.id, reason: "supplement-near-existing" });
        merged = true;
        break;
      }
    }
    if (!merged) out.push({ ...rec, mapFlags: [...(rec.mapFlags || []), "SUPPLEMENT"] });
  }
  return { master: out, suppressed };
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
        suppressed.push({ kept: existing.id, dropped: rec.id, reason: "same-brand-near" });
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
        suppressed.push({ kept: existing.id, dropped: rec.id, reason: "pilot-fj-merge" });
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
  const paired = mergeOnrouteHighwayPairs(raw);
  const { master: deduped, suppressed } = dedupeRecords(paired);
  const { master, suppressed: suppSuppressed } = mergeSupplements(deduped, loadSupplementRecords());
  suppressed.push(...suppSuppressed);
  for (const rec of master) {
    rec.mapFlags = rec.mapFlags || [];
    rec.reviewReasons = rec.reviewReasons || [];
    applyInferredState(rec);
    if (!rec.state) {
      rec.mapFlags.push("NO_STATE");
      rec.needsReview = true;
    }
  }

  const payload = {
    generated: new Date().toISOString(),
    country: "CA",
    source: "OpenStreetMap PBF + fuel-ca-brand-catalog",
    recordCount: master.length,
    records: master,
  };
  writeJson(MASTER_PATH, payload);
  writeJson(QA_PATH, buildQaReport(master, catalog, suppressed));
  console.log("Wrote", MASTER_PATH, master.length, "stations");
  return payload;
}

if (process.argv[1]?.endsWith("build-fuel-ca-master.mjs")) {
  buildFuelMaster();
}
