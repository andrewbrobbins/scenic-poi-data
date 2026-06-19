/**
 * Shared fuel brand/type helpers for masters, explorers, and UI filters.
 */

export const FUEL_TYPE_TRAVEL_PLAZA = "travel_plaza";
export const FUEL_TYPE_CONVENIENCE = "convenience_fuel";

export const PFJ_BRAND_IDS = new Set(["pilot", "flyingj", "pilot_flyingj"]);

const LEGACY_TRAVEL_TYPES = new Set(["travel_center", "highway_service_centre"]);

/** Normalize stored type values (legacy travel_center → travel_plaza). */
export function normalizeFuelType(type) {
  if (!type || LEGACY_TRAVEL_TYPES.has(type)) return FUEL_TYPE_TRAVEL_PLAZA;
  if (type === FUEL_TYPE_CONVENIENCE) return FUEL_TYPE_CONVENIENCE;
  return type;
}

export function isTravelPlazaType(type) {
  return normalizeFuelType(type) === FUEL_TYPE_TRAVEL_PLAZA;
}

export function isConvenienceFuelType(type) {
  return normalizeFuelType(type) === FUEL_TYPE_CONVENIENCE;
}

/** Unified gas-select id (Pilot + Flying J → pilot_flyingj). */
export function brandIdToSelectId(brandId) {
  if (PFJ_BRAND_IDS.has(brandId)) return "pilot_flyingj";
  return brandId || "unknown";
}

export function selectIdMatchesBrand(selectId, brandId) {
  return brandIdToSelectId(brandId) === selectId;
}

const PFJ_SELECT = {
  id: "pilot_flyingj",
  name: "Pilot Flying J",
  type: FUEL_TYPE_TRAVEL_PLAZA,
  brandIds: ["pilot", "flyingj", "pilot_flyingj"],
};

/**
 * Build deduped brand groups for gas-select UI (US + CA merged, PFJ bundled).
 * @returns {Array<{ id: string, name: string, type: string, brandIds: string[], regions: string[], strict: boolean }>}
 */
export function buildBrandGroups(usCatalog, caCatalog) {
  const byId = new Map();

  function upsert(selectId, partial) {
    const prev = byId.get(selectId);
    byId.set(selectId, {
      id: selectId,
      name: partial.name,
      type: normalizeFuelType(partial.type),
      brandIds: [...new Set([...(prev?.brandIds || []), ...(partial.brandIds || [])])],
      regions: [...new Set([...(prev?.regions || []), ...(partial.regions || [])])],
      strict: !!(prev?.strict || partial.strict),
    });
  }

  for (const [region, catalog] of [
    ["us", usCatalog],
    ["ca", caCatalog],
  ]) {
    for (const b of catalog?.brands || []) {
      if (b.id === "flyingj") continue;
      const selectId = brandIdToSelectId(b.id);
      if (selectId === "pilot_flyingj") {
        upsert("pilot_flyingj", { ...PFJ_SELECT, regions: [region], strict: !!(b.osm && b.osm.strict) });
        continue;
      }
      upsert(selectId, {
        name: b.displayName,
        type: b.type,
        brandIds: [b.id],
        regions: [region],
        strict: !!(b.osm && b.osm.strict),
      });
    }
  }

  if (!byId.has("pilot_flyingj")) byId.set("pilot_flyingj", { ...PFJ_SELECT, regions: [], strict: false });

  const typeOrder = { [FUEL_TYPE_TRAVEL_PLAZA]: 0, [FUEL_TYPE_CONVENIENCE]: 1 };
  return [...byId.values()].sort((a, b) => {
    const ta = typeOrder[a.type] ?? 9;
    const tb = typeOrder[b.type] ?? 9;
    if (ta !== tb) return ta - tb;
    return a.name.localeCompare(b.name);
  });
}

export function brandGroupLabel(group) {
  const kind = group.type === FUEL_TYPE_CONVENIENCE ? "Convenience fuel" : "Travel plaza";
  return `${group.name} (${kind})`;
}
