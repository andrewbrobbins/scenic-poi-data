/**
 * Conservative nationwide camping display rules (see CAMPING-US.md).
 * Master keeps all records; displayTier controls default map visibility.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { haversineMi } from "./camping-us-lib.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));
export const FILTER_CONFIG_PATH = path.join(tools, "camping-us-filter-config.json");

export const FEDERAL_INGEST_SOURCES = new Set(["01-nps-poi", "02-usfs-recreation", "04-ridb"]);
export const KNOWN_MANAGERS = new Set(["NPS", "USFS", "BLM", "State", "COE", "USFWS", "County", "City"]);

const DEFAULT_CONFIG = {
  enabled: true,
  version: 1,
  microClusterRadiusM: 80,
  microClusterMinMembers: 3,
  roadMaxDefaultM: 800,
  roadMaxQaM: 1200,
  roadMaxKnownManagerM: 1200,
  roadDefaultGoodNameNoCache: true,
  backupFile: "camping-us-master.pre-filter-backup.json",
};

export function loadFilterConfig() {
  try {
    if (fs.existsSync(FILTER_CONFIG_PATH)) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(FILTER_CONFIG_PATH, "utf8")) };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_CONFIG };
}

export function isGenericOsmName(name) {
  const n = (name || "").trim();
  if (!n) return true;
  if (/^OSM\s+(node|way|relation)\b/i.test(n)) return true;
  if (/^(node|way|relation)\s+\d+$/i.test(n)) return true;
  if (/^unnamed\b/i.test(n)) return true;
  return false;
}

export function isNumericOnlyName(name) {
  const n = (name || "").trim();
  return /^\u0023?\d{1,4}$/.test(n);
}

export function isPerSiteLabel(name) {
  const n = (name || "").trim();
  return (
    /^(site|plot|pitch|walk-in|group|loop)\s+[a-z0-9.\-]+$/i.test(n) ||
    /^.+\s+\u0023\d+$/i.test(n)
  );
}

export function isGoodHumanName(name) {
  const n = (name || "").trim();
  if (n.length < 4) return false;
  if (isGenericOsmName(n)) return false;
  if (isNumericOnlyName(n)) return false;
  return true;
}

export function isFederalGisRecord(r) {
  return FEDERAL_INGEST_SOURCES.has(r.ingestSource);
}

export function hardExcludeReason(r) {
  if (r.isPlaceholder) return "placeholder";
  if (r.type === "dispersed") return "dispersed";
  if ((r.mapFlags || []).includes("NPS_NO_CG")) return "nps-no-campground";
  if (isGenericOsmName(r.name)) return "generic-osm-name";
  return null;
}

export function recordKeepScore(r) {
  let s = 0;
  if (isFederalGisRecord(r)) s += 1000;
  if (isGoodHumanName(r.name)) s += 200;
  else if (!isGenericOsmName(r.name) && !isNumericOnlyName(r.name)) s += 50;
  if (r.coordConfidence === "high") s += 80;
  else if (r.coordConfidence === "medium") s += 40;
  if (r.sourceIds?.osmType === "relation") s += 30;
  else if (r.sourceIds?.osmType === "way") s += 20;
  else if (r.sourceIds?.osmType === "node" && isGoodHumanName(r.name)) s += 10;
  if (KNOWN_MANAGERS.has(r.landManager) && r.landManager !== "Unknown") s += 25;
  if (isPerSiteLabel(r.name)) s -= 30;
  if (isGenericOsmName(r.name)) s -= 500;
  return s;
}

export function hasClusterAnchor(members) {
  return members.some((r) => isFederalGisRecord(r) || isGoodHumanName(r.name));
}

/**
 * Union-find clustering within radiusM meters (conservative micro-cluster).
 */
export function assignMicroClusters(records, radiusM, minMembers) {
  const active = records.filter((r) => !hardExcludeReason(r));
  const radiusMi = radiusM / 1609.344;
  const cellDeg = radiusMi / 69;
  const grid = new Map();

  function cellKey(r) {
    return `${Math.floor(r.lat / cellDeg)},${Math.floor(r.lon / cellDeg)}`;
  }

  active.forEach((r, idx) => {
    r._clusterIdx = idx;
    const key = cellKey(r);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(idx);
  });

  const parent = active.map((_, i) => i);
  function find(i) {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  }

  for (let i = 0; i < active.length; i++) {
    const ri = active[i];
    const gx = Math.floor(ri.lat / cellDeg);
    const gy = Math.floor(ri.lon / cellDeg);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = grid.get(`${gx + dx},${gy + dy}`);
        if (!list) continue;
        for (const j of list) {
          if (j <= i) continue;
          const rj = active[j];
          if (haversineMi([ri.lat, ri.lon], [rj.lat, rj.lon]) <= radiusMi) union(i, j);
        }
      }
    }
  }

  const groups = new Map();
  for (let i = 0; i < active.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(active[i]);
  }

  let clusterSerial = 0;
  for (const members of groups.values()) {
    if (members.length < minMembers) continue;
    if (!hasClusterAnchor(members)) {
      const allGeneric = members.every((r) => isGenericOsmName(r.name));
      if (!allGeneric) continue;
    }
    const clusterId = `cluster-${++clusterSerial}`;
    const sorted = [...members].sort((a, b) => recordKeepScore(b) - recordKeepScore(a));
    const keeper = sorted[0];
    for (const r of members) {
      r.clusterGroupId = clusterId;
      r.clusterKeepId = keeper.id;
      if (r.id === keeper.id) r.clusterRole = "keep";
      else {
        r.clusterRole = "dropped";
        if (!r.excludeReason) {
          r.excludeReason = "cluster-duplicate";
          r.displayTier = "excluded";
        }
      }
    }
  }
}

export function roadTierForRecord(r, cfg) {
  const dist = r.roadDistanceM;
  if (dist == null) {
    if (
      cfg.roadDefaultGoodNameNoCache &&
      r.type === "developed" &&
      isGoodHumanName(r.name) &&
      !isFederalGisRecord(r)
    ) {
      return { tier: "default", evidence: "named-no-road-cache", reason: null };
    }
    if (isFederalGisRecord(r) || r.ingestSource === "03-osm") {
      return { tier: "qa", evidence: "road-unknown", reason: null };
    }
    return { tier: "default", evidence: "road-unknown", reason: null };
  }
  const knownMgr = KNOWN_MANAGERS.has(r.landManager) && r.landManager !== "Unknown";
  const maxDefault = cfg.roadMaxDefaultM;
  const maxQa = knownMgr ? cfg.roadMaxKnownManagerM : cfg.roadMaxQaM;
  if (dist <= maxDefault) return { tier: "default", evidence: "road-distance", reason: null };
  if (dist <= maxQa) return { tier: "qa", evidence: "road-distance", reason: null };
  return { tier: "excluded", evidence: "road-distance", reason: "no-road-access" };
}

export function applyDisplayTiers(records, cfg) {
  for (const r of records) {
    if (r.displayTier === "excluded" && r.excludeReason) continue;
    const hard = hardExcludeReason(r);
    if (hard) {
      r.displayTier = "excluded";
      r.excludeReason = hard;
      continue;
    }
    if (r.clusterRole === "dropped") continue;
    if (!isGoodHumanName(r.name) && !isFederalGisRecord(r)) {
      if (isPerSiteLabel(r.name) && r.clusterRole === "keep") {
        /* keeper in cluster may be Site N — still evaluate road */
      } else if (isNumericOnlyName(r.name) || isPerSiteLabel(r.name)) {
        r.displayTier = "excluded";
        r.excludeReason = r.excludeReason || "vague-name";
        continue;
      }
    }
    const road = roadTierForRecord(r, cfg);
    r.roadEvidence = road.evidence;
    if (road.tier === "excluded") {
      r.displayTier = "excluded";
      r.excludeReason = road.reason;
    } else {
      r.displayTier = road.tier;
      r.excludeReason = null;
    }
  }
}

export function includeInDefaultEmbed(r, cfg) {
  if (!cfg.enabled) {
    if (r.isPlaceholder) return false;
    if (r.type === "dispersed") return false;
    if ((r.mapFlags || []).includes("NPS_NO_CG")) return false;
    return true;
  }
  if (r.displayTier !== "default") return false;
  if (r.isPlaceholder) return false;
  if (r.type === "dispersed") return false;
  return true;
}

export function includeInQaEmbed(r, cfg) {
  if (!cfg.enabled) return false;
  return r.displayTier === "qa";
}

/** Route editor / live map — same rules as default embed when filter enabled. */
export function isValidCampingRecord(c, cfg) {
  if (!c || c.lat == null || c.lon == null) return false;
  const name = (c.name || "").trim();
  if (!name) return false;
  if (isGenericOsmName(name)) return false;
  if (cfg?.enabled && c.displayTier && c.displayTier !== "default") return false;
  return true;
}
