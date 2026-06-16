/**
 * Merge Parks Canada + OSM + provincial seed into camping-ca-master.json.
 */
import fs from "fs";
import path from "path";
import {
  INGEST_DIR,
  MASTER_PATH,
  QA_PATH,
  haversineMi,
  readJson,
  writeJson,
} from "./camping-ca-lib.mjs";
import { applyInferredState } from "./camping-ca-geo-utils.mjs";

const SOURCE_PRIORITY = ["01-parks-canada", "03-provincial-seed", "02-osm"];
const DEDUPE_MI = 0.12;

function normName(n) {
  return (n || "")
    .toLowerCase()
    .replace(/\b(campground|camp|camping area|cg)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 40);
}

function namesSimilar(a, b) {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  return false;
}

function loadStepRecords(step) {
  const dir = path.join(INGEST_DIR, step);
  const p = path.join(dir, "campgrounds.json");
  const j = readJson(p);
  if (j?.records?.length) return { step, records: j.records, meta: j };
  if (step === "02-osm" && fs.existsSync(dir)) {
    const all = [];
    for (const f of fs.readdirSync(dir).filter((n) => /^osm-[A-Z]{2}\.json$/.test(n))) {
      const st = readJson(path.join(dir, f));
      if (st?.records?.length) all.push(...st.records);
    }
    if (all.length) return { step, records: all, meta: { mergedFrom: "osm-*.json" } };
  }
  return { step, records: [], meta: j };
}

function mergeRecords() {
  const layers = SOURCE_PRIORITY.map(loadStepRecords);
  const master = [];
  const suppressed = [];

  for (const { step, records } of layers) {
    for (const rec of records) {
      let dup = null;
      for (const existing of master) {
        if (existing.ingestSource === step) continue;
        const d = haversineMi([rec.lat, rec.lon], [existing.lat, existing.lon]);
        if (d <= DEDUPE_MI && namesSimilar(rec.name, existing.name)) {
          dup = existing;
          break;
        }
        if (d <= 0.05 && rec.landManager === existing.landManager) {
          dup = existing;
          break;
        }
      }
      if (dup) {
        suppressed.push({ kept: dup.id, dropped: rec.id, step, name: rec.name });
        continue;
      }
      master.push({
        ...rec,
        reviewReasons: [...(rec.reviewReasons || [])],
        mapFlags: [...(rec.mapFlags || [])],
      });
    }
  }
  return { master, suppressed };
}

function includeInEmbed(r) {
  if (r.dispersed) return false;
  if (r.commercial) return false;
  const name = r.name || "";
  if (/^OSM\s+(node|way|relation)\b/i.test(name)) return false;
  return r.landManager === "Parks Canada" || r.landManager === "Provincial";
}

function buildQaReport(master, suppressed) {
  const byManager = {};
  const byState = {};
  let embedCount = 0;
  for (const r of master) {
    byManager[r.landManager] = (byManager[r.landManager] || 0) + 1;
    byState[r.state || "?"] = (byState[r.state || "?"] || 0) + 1;
    if (includeInEmbed(r)) embedCount++;
  }
  return {
    generated: new Date().toISOString(),
    recordCount: master.length,
    embedEligible: embedCount,
    byManager,
    byState,
    suppressedCount: suppressed.length,
    suppressedSample: suppressed.slice(0, 30),
  };
}

export function buildCampingMaster() {
  const { master, suppressed } = mergeRecords();
  for (const rec of master) applyInferredState(rec);

  const payload = {
    generated: new Date().toISOString(),
    country: "CA",
    recordCount: master.length,
    records: master,
  };
  writeJson(MASTER_PATH, payload);
  writeJson(QA_PATH, buildQaReport(master, suppressed));
  console.log("Wrote", MASTER_PATH, master.length, "campgrounds");
  return payload;
}

export { includeInEmbed };

if (process.argv[1]?.endsWith("build-camping-ca-master.mjs")) {
  buildCampingMaster();
}
