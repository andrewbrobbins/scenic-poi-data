/**
 * Probe candidate ArcGIS endpoints from state-parks-source-seeds.json.
 * Writes state-parks-ingest/00-research/discovery-{us|ca}.json (gitignored)
 * and updates state-parks-source-matrix.json with verified Tier A rows.
 *
 * Usage:
 *   node build-state-parks-discover-sources.mjs
 *   node build-state-parks-discover-sources.mjs --region=us
 *   node build-state-parks-discover-sources.mjs --state=MN,TX
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log, logSection } from "./pipeline-log.mjs";
import { INGEST_DIR, readJson, writeJson, US_STATES, CA_PROVINCES } from "./state-parks-lib.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));
const SEEDS_PATH = path.join(tools, "state-parks-source-seeds.json");
const MATRIX_PATH = path.join(tools, "state-parks-source-matrix.json");
const RESEARCH_DIR = path.join(INGEST_DIR, "00-research");

function parseArgs() {
  const region = process.argv.includes("--region=ca") ? "ca" : process.argv.includes("--region=us") ? "us" : "all";
  const stateArg = process.argv.find((a) => a.startsWith("--state="));
  const states = stateArg ? stateArg.slice(8).split(",").map((s) => s.trim().toUpperCase()) : null;
  return { region, states };
}

async function probeEndpoint(candidate) {
  const params = new URLSearchParams({
    where: candidate.where || "1=1",
    returnCountOnly: "true",
    f: "json",
  });
  const url = `${candidate.queryUrl}?${params}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, url };
    const j = await res.json();
    if (j.error) return { ok: false, error: JSON.stringify(j.error), url };
    const count = j.count ?? 0;

    // Fetch one sample for field discovery
    const sampleParams = new URLSearchParams({
      where: candidate.where || "1=1",
      outFields: candidate.outFields || "*",
      returnGeometry: "true",
      outSR: "4326",
      resultRecordCount: "1",
      f: "json",
    });
    const sampleUrl = `${candidate.queryUrl}?${sampleParams}`;
    const sampleRes = await fetch(sampleUrl, { signal: AbortSignal.timeout(30000) });
    const sampleJson = sampleRes.ok ? await sampleRes.json() : {};
    const sampleAttrs = sampleJson.features?.[0]?.attributes || {};
    const fields = Object.keys(sampleAttrs);

    return {
      ok: true,
      url: candidate.queryUrl,
      label: candidate.label,
      count,
      sampleFields: fields.slice(0, 30),
      sampleAttrs,
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e), url: candidate.queryUrl, label: candidate.label };
  }
}

function guessNameField(attrs) {
  const keys = Object.keys(attrs || {});
  const priority = [
    "PARK_NAME",
    "ParkName",
    "NAME",
    "Name",
    "UNIT_NAME",
    "UnitName",
    "FACILITY_NAME",
    "FacilityName",
    "SITE_NAME",
    "SiteName",
    "PROP_NAME",
    "PropertyName",
    "DESC_EN",
    "FULL_NAME",
  ];
  for (const p of priority) {
    if (keys.includes(p) && attrs[p]) return p;
  }
  for (const k of keys) {
    if (/name|park|unit|site|facility|desc/i.test(k) && typeof attrs[k] === "string" && attrs[k].length > 2) {
      return k;
    }
  }
  return null;
}

function guessCodeField(attrs) {
  const keys = Object.keys(attrs || {});
  const priority = ["PARK_ID", "ParkID", "UNIT_ID", "UnitID", "OBJECTID", "FID", "PARK_CODE", "CODE", "REF"];
  for (const p of priority) {
    if (keys.includes(p)) return p;
  }
  return null;
}

function buildMatrixRow(admin, agency, probe, candidate) {
  return {
    admin,
    country: US_STATES.includes(admin) ? "US" : "CA",
    agency,
    tier: "A",
    status: "verified",
    primaryUrl: candidate.queryUrl.replace(/\/query$/, ""),
    queryUrl: candidate.queryUrl,
    where: candidate.where || "1=1",
    outFields: candidate.outFields || "*",
    geometry: "polygon",
    license: "public",
    refreshCadence: "unknown",
    includesHistoricSites: true,
    featureCount: probe.count,
    fieldMap: {
      name: guessNameField(probe.sampleAttrs),
      code: guessCodeField(probe.sampleAttrs),
      url: null,
      designation: null,
    },
    notes: probe.label,
    investigatedAt: new Date().toISOString().slice(0, 10),
  };
}

function emptyRow(admin, agency, country, status, notes) {
  return {
    admin,
    country,
    agency,
    tier: null,
    status,
    primaryUrl: null,
    queryUrl: null,
    where: null,
    outFields: null,
    geometry: null,
    license: null,
    refreshCadence: null,
    includesHistoricSites: null,
    featureCount: null,
    fieldMap: null,
    notes,
    investigatedAt: new Date().toISOString().slice(0, 10),
  };
}

async function discoverRegion(seeds, regionKey, adminList, filterStates) {
  const results = {};
  const matrixRows = [];

  for (const admin of adminList) {
    if (filterStates && !filterStates.includes(admin)) continue;
    const entry = seeds[regionKey]?.[admin];
    if (!entry) continue;

    log(`Probing ${admin} (${entry.agency})...`);
    const candidates = entry.candidates || [];
    if (!candidates.length) {
      results[admin] = { agency: entry.agency, status: "none", candidates: [] };
      matrixRows.push(
        emptyRow(admin, entry.agency, regionKey === "us" ? "US" : "CA", "none", "No candidate URLs seeded")
      );
      continue;
    }

    const probes = [];
    for (const c of candidates) {
      const probe = await probeEndpoint(c);
      probes.push({ candidate: c, probe });
      if (probe.ok && probe.count > 0) {
        log(`  ✓ ${c.label}: ${probe.count} features`);
      } else {
        log(`  ✗ ${c.label}: ${probe.error || "0 features"}`, { level: "warn" });
      }
    }

    const winner = probes
      .filter((p) => p.probe.ok && p.probe.count > 0)
      .sort((a, b) => b.probe.count - a.probe.count)[0];

    results[admin] = {
      agency: entry.agency,
      probes,
      winner: winner ? { label: winner.candidate.label, count: winner.probe.count } : null,
    };

    if (winner) {
      matrixRows.push(buildMatrixRow(admin, entry.agency, winner.probe, winner.candidate));
    } else {
      matrixRows.push(
        emptyRow(
          admin,
          entry.agency,
          regionKey === "us" ? "US" : "CA",
          "blocked",
          `All ${candidates.length} candidate endpoint(s) failed — needs manual research`
        )
      );
    }
  }

  return { results, matrixRows };
}

async function main() {
  const { region, states } = parseArgs();
  const seeds = readJson(SEEDS_PATH);
  if (!seeds) {
    log(`Missing ${SEEDS_PATH}`, { level: "error" });
    process.exit(1);
  }

  fs.mkdirSync(RESEARCH_DIR, { recursive: true });
  logSection("State parks source discovery");

  const existing = readJson(MATRIX_PATH, { us: [], ca: [] });
  const allRows = { us: [...(existing.us || [])], ca: [...(existing.ca || [])] };

  if (region === "all" || region === "us") {
    const { results, matrixRows } = await discoverRegion(seeds, "us", US_STATES, states);
    writeJson(path.join(RESEARCH_DIR, "discovery-us.json"), {
      generated: new Date().toISOString(),
      results,
    });
    for (const row of matrixRows) {
      allRows.us = allRows.us.filter((r) => r.admin !== row.admin);
      allRows.us.push(row);
    }
    allRows.us.sort((a, b) => a.admin.localeCompare(b.admin));
    log(`US: ${matrixRows.filter((r) => r.status === "verified").length}/${matrixRows.length} verified`);
  }

  if (region === "all" || region === "ca") {
    const { results, matrixRows } = await discoverRegion(seeds, "ca", CA_PROVINCES, states);
    writeJson(path.join(RESEARCH_DIR, "discovery-ca.json"), {
      generated: new Date().toISOString(),
      results,
    });
    for (const row of matrixRows) {
      allRows.ca = allRows.ca.filter((r) => r.admin !== row.admin);
      allRows.ca.push(row);
    }
    allRows.ca.sort((a, b) => a.admin.localeCompare(b.admin));
    log(`CA: ${matrixRows.filter((r) => r.status === "verified").length}/${matrixRows.length} verified`);
  }

  writeJson(MATRIX_PATH, {
    generated: new Date().toISOString(),
    description: "Verified and candidate data sources for SP-001 state/provincial parks catalog",
    us: allRows.us,
    ca: allRows.ca,
  });
  log(`Wrote ${MATRIX_PATH}`);
}

main().catch((e) => {
  log(String(e), { level: "error" });
  process.exit(1);
});
