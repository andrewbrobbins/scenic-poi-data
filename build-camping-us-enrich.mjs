#!/usr/bin/env node
/**
 * Enrich camping-us-master.json with filter tiers (all records retained).
 *
 * Usage:
 *   node build-camping-us-enrich.mjs
 *   node build-camping-us-enrich.mjs --fetch-roads
 *   node build-camping-us-enrich.mjs --skip-roads
 *   node build-camping-us-enrich.mjs --embed-only
 *   node build-camping-us-enrich.mjs --disable-filter
 *   node build-camping-us-enrich.mjs --restore-backup
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { readJson, writeJson } from "./camping-us-lib.mjs";
import { applyInferredState } from "./camping-us-geo-utils.mjs";
import {
  FILTER_CONFIG_PATH,
  loadFilterConfig,
  assignMicroClusters,
  applyDisplayTiers,
} from "./camping-us-filter.mjs";
import {
  roadCachePath,
  fetchAndCacheStateRoads,
  roadDistanceForRecord,
  clearRoadIndexCache,
  loadRoadCache,
} from "./camping-us-road-enrich.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));
const masterPath = path.join(tools, "camping-us-master.json");

function hasRoadCache(st) {
  const p = roadCachePath(st);
  if (!fs.existsSync(p)) return false;
  const head = readJson(p);
  if (head?.segments?.length) return true;
  if (head?.parts?.length && head.segmentCount > 0) return true;
  return false;
}

function statesInRecords(records) {
  const set = new Set();
  for (const r of records) {
    if (r.state && r.state.length === 2) set.add(r.state);
  }
  return [...set].sort();
}

function filterStats(records) {
  const displayTier = { default: 0, qa: 0, excluded: 0 };
  const excludeReason = {};
  const roadDistance = { null: 0, lte800: 0, lte1200: 0, gt1200: 0 };
  for (const r of records) {
    displayTier[r.displayTier || "qa"] = (displayTier[r.displayTier || "qa"] || 0) + 1;
    if (r.excludeReason) {
      excludeReason[r.excludeReason] = (excludeReason[r.excludeReason] || 0) + 1;
    }
    const d = r.roadDistanceM;
    if (d == null) roadDistance.null++;
    else if (d <= 800) roadDistance.lte800++;
    else if (d <= 1200) roadDistance.lte1200++;
    else roadDistance.gt1200++;
  }
  return { displayTier, excludeReason, roadDistance };
}

async function ensureRoadCaches(states, fetchRoads) {
  for (const st of states) {
    if (!fetchRoads) {
      if (!hasRoadCache(st)) continue;
    } else if (hasRoadCache(st)) {
      console.log(`Roads ${st}: cache exists, skip fetch`);
    } else {
      try {
        await fetchAndCacheStateRoads(st);
      } catch (e) {
        console.warn(`Roads ${st}: skip (${e.message})`);
      }
    }
  }
  clearRoadIndexCache();
}

function applyRoadDistances(records) {
  for (const r of records) {
    const idx = getStateRoadIndex(r.state);
    if (!idx) {
      r.roadDistanceM = null;
      continue;
    }
    r.roadDistanceM = minRoadDistanceM([r.lat, r.lon], idx);
  }
}

function resetEnrichmentFields(records) {
  for (const r of records) {
    r.roadDistanceM = null;
    r.roadEvidence = null;
    r.displayTier = null;
    r.excludeReason = null;
    r.clusterGroupId = null;
    r.clusterKeepId = null;
    r.clusterRole = null;
    delete r._clusterIdx;
  }
}

function runEmbeds() {
  execSync("node build-camping-us-explorer-embed.mjs", { cwd: tools, stdio: "inherit" });
  execSync("node build-camping-us-viewer-data.mjs", { cwd: tools, stdio: "inherit" });
}

async function main() {
  const embedOnly = process.argv.includes("--embed-only");
  const skipRoads = process.argv.includes("--skip-roads");
  const fetchRoads = process.argv.includes("--fetch-roads");
  const stateArg = process.argv.find((a) => a.startsWith("--state="));
  const statesOnly = stateArg
    ? stateArg
        .split("=")[1]
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    : null;

  if (process.argv.includes("--disable-filter")) {
    const cfg = loadFilterConfig();
    cfg.enabled = false;
    writeJson(FILTER_CONFIG_PATH, cfg);
    console.log("Filter disabled in", FILTER_CONFIG_PATH);
    runEmbeds();
    return;
  }

  if (process.argv.includes("--restore-backup")) {
    const cfg = loadFilterConfig();
    const backup = path.join(tools, cfg.backupFile || "camping-us-master.pre-filter-backup.json");
    if (!fs.existsSync(backup)) throw new Error(`Missing backup: ${backup}`);
    fs.copyFileSync(backup, masterPath);
    console.log("Restored master from", backup);
    return;
  }

  if (!fs.existsSync(masterPath)) throw new Error(`Missing ${masterPath}`);

  if (embedOnly) {
    runEmbeds();
    return;
  }

  const cfg = loadFilterConfig();
  const master = readJson(masterPath);
  const records = master.records;

  if (cfg.enabled && !fs.existsSync(path.join(tools, cfg.backupFile || "camping-us-master.pre-filter-backup.json"))) {
    fs.copyFileSync(masterPath, path.join(tools, cfg.backupFile || "camping-us-master.pre-filter-backup.json"));
    console.log("Backup:", cfg.backupFile);
  }

  if (!statesOnly) resetEnrichmentFields(records);

  for (const r of records) applyInferredState(r);

  if (!skipRoads) {
    const states = statesOnly || statesInRecords(records);
    await ensureRoadCaches(states, fetchRoads);
    const roadStates = statesOnly || statesInRecords(records);
    for (const st of roadStates) {
      const batch = records.filter((r) => r.state === st);
      console.log(`Road distances: ${st} (${batch.length} records)…`);
      for (const r of batch) {
        r.roadDistanceM = roadDistanceForRecord(r);
      }
      clearRoadIndexCache();
    }
    for (const r of records) {
      if (roadStates.includes(r.state)) continue;
      r.roadDistanceM = roadDistanceForRecord(r);
    }
    clearRoadIndexCache();
  }

  if (cfg.enabled) {
    if (!statesOnly) {
      assignMicroClusters(records, cfg.microClusterRadiusM, cfg.microClusterMinMembers);
    }
    applyDisplayTiers(records, cfg);
  } else {
    for (const r of records) {
      r.displayTier = "default";
      r.excludeReason = null;
    }
  }

  master.filterStats = {
    generated: new Date().toISOString(),
    filterEnabled: cfg.enabled,
    filterVersion: cfg.version,
    total: records.length,
    ...filterStats(records),
    clusterDropped: records.filter((r) => r.clusterRole === "dropped").length,
  };

  writeJson(masterPath, master);
  console.log("Enriched master:", master.filterStats);
  runEmbeds();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
