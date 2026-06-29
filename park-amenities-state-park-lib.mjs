/**
 * Parent-unit resolution for state / provincial park catalogs (SP-001).
 */
import { MASTER_US_PATH, MASTER_CA_PATH, readJson, haversineM } from "./state-parks-lib.mjs";
import { parentFromStatePark } from "./park-amenities-lib.mjs";

export function normalizeStateParkUnitName(name) {
  return (name || "")
    .toLowerCase()
    .replace(/\b(state|provincial)\b/g, "")
    .replace(/\b(park|historic|historical|site|monument|memorial|preserve|recreation area)\b/g, "")
    .replace(/\b(sp|shp|shm|pp|php|hs)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function loadStateParkIndex(country) {
  const masterPath = country === "CA" ? MASTER_CA_PATH : MASTER_US_PATH;
  const master = readJson(masterPath, { records: [] });
  const byOfficialCode = new Map();
  const byId = new Map();
  const byState = new Map();
  const byNormalizedName = new Map();
  for (const r of master.records || []) {
    byId.set(r.id, r);
    if (r.officialCode != null && String(r.officialCode).trim()) {
      byOfficialCode.set(String(r.officialCode).trim(), r);
    }
    const st = r.state || "";
    if (!byState.has(st)) byState.set(st, []);
    byState.get(st).push(r);
    for (const label of [r.name, r.displayName]) {
      const key = normalizeStateParkUnitName(label);
      if (!key) continue;
      const scoped = `${st}:${key}`;
      if (!byNormalizedName.has(scoped)) byNormalizedName.set(scoped, r);
      if (!byNormalizedName.has(key)) byNormalizedName.set(key, r);
    }
  }
  return { byOfficialCode, byId, byState, byNormalizedName, records: master.records || [] };
}

export function resolveStateParkParentByName(
  { parkUnitName, lat, lon, state, country = "US" },
  index,
  maxSpatialM = 3000
) {
  const raw = parkUnitName != null ? String(parkUnitName).trim() : "";
  if (raw) {
    const key = normalizeStateParkUnitName(raw);
    const scoped = state ? `${state}:${key}` : "";
    const hit = (scoped && index.byNormalizedName.get(scoped)) || index.byNormalizedName.get(key);
    if (hit) return parentFromStatePark(hit);
  }
  return resolveStateParkParent({ lat, lon, state, country }, index, maxSpatialM);
}

export function resolveStateParkParent(
  { officialCode, lat, lon, state, country = "US" },
  index,
  maxSpatialM = 3000
) {
  const code = officialCode != null ? String(officialCode).trim() : "";
  if (code && index.byOfficialCode.has(code)) {
    return parentFromStatePark(index.byOfficialCode.get(code));
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return {
      system: country === "CA" ? "state_park_ca" : "state_park_us",
      id: "",
      parkCode: code || "",
      name: "",
      designation: "",
      category: "park",
      state: state || "",
    };
  }

  const pool = state ? index.byState.get(state) || [] : index.records;
  let best = null;
  let bestD = Infinity;
  for (const p of pool) {
    const d = haversineM({ lat, lon }, { lat: p.lat, lon: p.lon });
    if (d < bestD && d <= maxSpatialM) {
      best = p;
      bestD = d;
    }
  }
  if (best) return parentFromStatePark(best);

  return {
    system: country === "CA" ? "state_park_ca" : "state_park_us",
    id: "",
    parkCode: code || "",
    name: "",
    designation: "",
    category: "park",
    state: state || "",
  };
}
