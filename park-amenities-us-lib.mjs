/**
 * US park amenities paths + NPS-specific helpers.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fetchArcgisAllFeatures } from "./camping-us-lib.mjs";
import {
  CAMP_TIERS,
  AMENITY_KINDS,
  ACCESS_MODES,
  readJson,
  writeJson,
  slugify,
  coordValid,
  baseRecord,
  addReview,
  haversineM,
  normalizeAmenityName,
  amenityId,
  inferAccessFromCampTier,
  classifyAccessMode,
  applyAccessFields,
  applyInferredCampgroundAccess,
  dedupeAmenityRecords,
  emptyCampgroundRollup,
  emptyKindRollup,
  classifyCaCampTier,
  classifyOsmCampTier,
} from "./park-amenities-lib.mjs";
import {
  loadNpsUnitMaps,
  resolveParentUnit,
  resolveVisitorCenterState,
  NPS_GEO_PATH,
  ARCGIS_POI_QUERY,
} from "./nps-visitor-centers-lib.mjs";

export const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const POI_TYPES_PATH = path.join(TOOLS_DIR, "park-amenities-nps-poi-types.json");
export const STATE_SOURCES_PATH = path.join(TOOLS_DIR, "park-amenities-state-sources.json");
export const INGEST_DIR = path.join(TOOLS_DIR, "park-amenities-us-ingest");
/** @deprecated Monolithic master — gitignored; use sharded outputs + manifest. */
export const MASTER_PATH = path.join(TOOLS_DIR, "park-amenities-us-master.json");
export const NPS_MASTER_PATH = path.join(TOOLS_DIR, "park-amenities-us-nps-master.json");
export const STATE_MASTER_DIR = path.join(TOOLS_DIR, "park-amenities-us-state-master");
export const MANIFEST_PATH = path.join(TOOLS_DIR, "park-amenities-us-master-manifest.json");
export const ROLLUP_PATH = path.join(TOOLS_DIR, "park-amenities-us-rollup.json");
export const QA_PATH = path.join(TOOLS_DIR, "park-amenities-us-qa.json");
export const EMBED_PATH = path.join(TOOLS_DIR, "park-amenities-us-explorer-embed.js");

export {
  CAMP_TIERS,
  AMENITY_KINDS,
  ACCESS_MODES,
  fetchArcgisAllFeatures,
  readJson,
  writeJson,
  slugify,
  coordValid,
  baseRecord,
  addReview,
  haversineM,
  normalizeAmenityName,
  amenityId,
  inferAccessFromCampTier,
  classifyAccessMode,
  applyAccessFields,
  applyInferredCampgroundAccess,
  dedupeAmenityRecords,
  emptyCampgroundRollup,
  emptyKindRollup,
  classifyCaCampTier,
  classifyOsmCampTier,
  loadNpsUnitMaps,
  resolveParentUnit,
  NPS_GEO_PATH,
  ARCGIS_POI_QUERY,
};

export function ensureIngestDir(step) {
  const d = path.join(INGEST_DIR, step);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function loadPoiTypeConfig() {
  return readJson(POI_TYPES_PATH);
}

export function allNpsPoiTypes(config = loadPoiTypeConfig()) {
  const types = new Set();
  for (const tier of CAMP_TIERS) {
    for (const t of config.campground?.[tier] || []) types.add(t);
  }
  for (const t of config.campground?.ambiguous || []) types.add(t);
  for (const t of config.picnic_area?.types || []) types.add(t);
  for (const t of config.restroom?.types || []) types.add(t);
  return [...types];
}

export function classifyNpsPoiType(poiType, name = "", config = loadPoiTypeConfig()) {
  const pt = (poiType || "").trim();
  if (!pt) return null;

  for (const tier of CAMP_TIERS) {
    if ((config.campground?.[tier] || []).includes(pt)) {
      return { kind: "campground", campTier: tier, subtype: tierSubtypeFromName(pt, tier, name) };
    }
  }
  if ((config.campground?.ambiguous || []).includes(pt)) {
    const inferred = inferCampTierFromName(name);
    return { kind: "campground", campTier: inferred, subtype: inferred };
  }
  if ((config.picnic_area?.types || []).includes(pt)) {
    return { kind: "picnic_area", subtype: config.picnic_area.subtypes?.[pt] || "area" };
  }
  if ((config.restroom?.types || []).includes(pt)) {
    return { kind: "restroom", subtype: config.restroom.subtypes?.[pt] || "restroom" };
  }
  return null;
}

function tierSubtypeFromName(poiType, tier, name) {
  const n = (name || "").toLowerCase();
  if (/group/i.test(poiType) || /group/i.test(n)) return "group";
  if (/rv/i.test(poiType) || /\brv\b/i.test(n)) return "rv";
  if (/cabin/i.test(poiType) || /cabin/i.test(n)) return "cabin";
  if (/walk.?in|backcountry|wilderness|dispersed/i.test(n)) return "walk_in";
  return tier;
}

function inferCampTierFromName(name) {
  const n = (name || "").toLowerCase();
  if (/backcountry|wilderness|walk.?in|dispersed/i.test(n)) return "backcountry";
  if (/primitive|dispersed/i.test(n)) return "primitive";
  return "developed";
}

export function buildPoiTypeWhere(types) {
  return types.map((t) => `POITYPE='${String(t).replace(/'/g, "''")}'`).join(" OR ");
}

export function stateByParkCode() {
  const geo = readJson(NPS_GEO_PATH, { units: [] });
  const map = {};
  for (const u of geo.units || []) map[u.parkCode.toLowerCase()] = u.state;
  return map;
}

export function npsAmenityId(parkCode, kind, campTier, name, lat, lon) {
  return amenityId("NPS", parkCode, kind, campTier, name, lat, lon);
}

export function resolveState(record, parkStates) {
  const resolved = resolveVisitorCenterState({
    state: record.state,
    lat: record.lat,
    lon: record.lon,
    parkCode: record.parkCode || record.parentUnit?.parkCode,
    parkStates,
  });
  if (resolved) record.state = resolved;
  return resolved;
}

export function stateShardPath(stateCode) {
  return path.join(STATE_MASTER_DIR, `${String(stateCode).toUpperCase()}.json`);
}

/** State code for state-park shard routing (falls back to parentUnit.state). */
export function shardStateCode(record) {
  return (record.state || record.parentUnit?.state || "").toUpperCase().trim();
}

export function aggregateRecordStats(records) {
  const byKind = {};
  const byCampTier = { developed: 0, backcountry: 0, primitive: 0 };
  const byAccessMode = { road: 0, trail: 0, unknown: 0 };
  const byManager = {};
  for (const r of records) {
    byKind[r.kind] = (byKind[r.kind] || 0) + 1;
    byManager[r.landManager] = (byManager[r.landManager] || 0) + 1;
    if (r.kind === "campground" && r.campTier) byCampTier[r.campTier] += 1;
    if (r.kind === "campground") byAccessMode[r.accessMode] = (byAccessMode[r.accessMode] || 0) + 1;
  }
  return { byKind, byCampTier, byAccessMode, byManager };
}

export function sortUsMasterRecords(records) {
  return [...records].sort(
    (a, b) =>
      (a.landManager || "").localeCompare(b.landManager || "") ||
      (a.parkCode || "").localeCompare(b.parkCode || "") ||
      a.kind.localeCompare(b.kind) ||
      (a.campTier || "").localeCompare(b.campTier || "") ||
      a.name.localeCompare(b.name)
  );
}

export function splitUsMasterRecords(records) {
  const nps = [];
  const byState = new Map();
  for (const r of records) {
    if (r.landManager === "NPS") {
      nps.push(r);
      continue;
    }
    const st = shardStateCode(r);
    if (!st) continue;
    if (!byState.has(st)) byState.set(st, []);
    byState.get(st).push(r);
  }
  return { nps, byState };
}

function writeShard(filePath, records, meta = {}) {
  const stats = aggregateRecordStats(records);
  writeJson(filePath, {
    schemaVersion: 2,
    generated: new Date().toISOString(),
    ...meta,
    recordCount: records.length,
    ...stats,
    records,
  });
}

/**
 * Write NPS shard, per-state state-park shards, and manifest index.
 * Omits empty state files; removes stale state shard files.
 */
export function writeUsMasterShards(records, options = {}) {
  const sorted = sortUsMasterRecords(records);
  const { nps, byState } = splitUsMasterRecords(sorted);
  const generated = new Date().toISOString();
  const totals = aggregateRecordStats(sorted);

  writeShard(NPS_MASTER_PATH, nps, {
    shard: "nps",
    landManager: "NPS",
    description: "US NPS park amenities — campgrounds, picnic, restroom, parking, visitor centers.",
    accessEnriched: options.accessEnriched || undefined,
  });

  fs.mkdirSync(STATE_MASTER_DIR, { recursive: true });
  const stateShards = {};
  for (const [st, stateRecords] of [...byState.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!stateRecords.length) continue;
    const relPath = path.join("park-amenities-us-state-master", `${st}.json`);
    writeShard(path.join(TOOLS_DIR, relPath), stateRecords, {
      shard: "state",
      state: st,
      landManager: "State",
      description: `US state park amenities — ${st}`,
      accessEnriched: options.accessEnriched || undefined,
    });
    const stats = aggregateRecordStats(stateRecords);
    stateShards[st] = {
      path: relPath,
      recordCount: stateRecords.length,
      byKind: stats.byKind,
    };
  }

  const activeStates = new Set(byState.keys());
  for (const name of fs.readdirSync(STATE_MASTER_DIR)) {
    if (!name.endsWith(".json")) continue;
    const st = name.slice(0, -5);
    if (!activeStates.has(st)) {
      fs.unlinkSync(path.join(STATE_MASTER_DIR, name));
    }
  }

  const manifest = {
    schemaVersion: 2,
    generated,
    description:
      options.description ||
      "US park amenities (sharded): NPS + per-state state parks — campgrounds, picnic, restroom, parking, visitor centers.",
    recordCount: sorted.length,
    byKind: totals.byKind,
    byCampTier: totals.byCampTier,
    byAccessMode: totals.byAccessMode,
    byManager: totals.byManager,
    accessEnriched: options.accessEnriched || undefined,
    shards: {
      nps: {
        path: "park-amenities-us-nps-master.json",
        recordCount: nps.length,
        byKind: aggregateRecordStats(nps).byKind,
      },
      state: stateShards,
    },
  };
  writeJson(MANIFEST_PATH, manifest);
  return manifest;
}

/** Load all US master records from manifest shards (falls back to legacy monolithic master). */
export function loadUsMasterRecords() {
  const manifest = readJson(MANIFEST_PATH, null);
  if (manifest?.shards) {
    const records = [];
    const npsPath = path.join(TOOLS_DIR, manifest.shards.nps.path);
    const npsShard = readJson(npsPath, { records: [] });
    records.push(...(npsShard.records || []));
    for (const info of Object.values(manifest.shards.state || {})) {
      const shard = readJson(path.join(TOOLS_DIR, info.path), { records: [] });
      records.push(...(shard.records || []));
    }
    return { ...manifest, records };
  }

  const legacy = readJson(MASTER_PATH, { records: [] });
  if (legacy.records?.length) return legacy;
  return { records: [], recordCount: 0 };
}
