/**
 * Per-park amenity rollup (shared builder).
 */
import {
  CAMP_TIERS,
  emptyCampgroundRollup,
  emptyKindRollup,
  readJson,
  writeJson,
} from "./park-amenities-lib.mjs";

function rollupKey(record) {
  const pu = record.parentUnit || {};
  const system = pu.system || "nps";
  let id = pu.id || record.parkCode || pu.parkCode || "";
  if (!id && record.sourceIds?.officialCode) {
    id = `code:${String(record.sourceIds.officialCode).trim()}`;
  }
  if (!id) id = `amenity:${record.id}`;
  return `${system}:${id}`;
}

export function buildRollupFromRecords(records) {
  const byParent = new Map();

  for (const r of records) {
    const key = rollupKey(r);
    if (!key) continue;

    if (!byParent.has(key)) {
      const pu = r.parentUnit || {};
      byParent.set(key, {
        parentSystem: pu.system || "nps",
        parentId: pu.id || r.parkCode || pu.parkCode,
        parentName: pu.name || "",
        parentCategory: pu.category || "",
        parentDesignation: pu.designation || "",
        parentState: pu.state || r.state || "",
        campground: emptyCampgroundRollup(),
        picnic_area: emptyKindRollup(),
        restroom: emptyKindRollup(),
        parking: emptyKindRollup(),
        visitor_center: emptyKindRollup(),
        sources: new Set(),
        coverage: "official",
      });
    }
    const row = byParent.get(key);
    row.sources.add(r.ingestSource || r.coordSource || "unknown");

    if (r.kind === "campground" && r.campTier && row.campground[r.campTier]) {
      row.campground[r.campTier].count += 1;
      row.campground[r.campTier].has = true;
      if (r.accessMode === "road") row.campground[r.campTier].road += 1;
      if (r.accessMode === "trail") row.campground[r.campTier].trail += 1;
    } else if (r.kind === "picnic_area") {
      row.picnic_area.count += 1;
      row.picnic_area.has = true;
    } else if (r.kind === "restroom") {
      row.restroom.count += 1;
      row.restroom.has = true;
    } else if (r.kind === "parking") {
      row.parking.count += 1;
      row.parking.has = true;
    } else if (r.kind === "visitor_center") {
      row.visitor_center.count += 1;
      row.visitor_center.has = true;
    }
  }

  const parents = [...byParent.values()]
    .map((row) => ({
      ...row,
      sources: [...row.sources].sort(),
      campground: {
        ...row.campground,
        any: CAMP_TIERS.some((t) => row.campground[t].has),
        total: CAMP_TIERS.reduce((n, t) => n + row.campground[t].count, 0),
        roadAccess: CAMP_TIERS.reduce((n, t) => n + row.campground[t].road, 0),
        trailAccess: CAMP_TIERS.reduce((n, t) => n + row.campground[t].trail, 0),
      },
    }))
    .sort((a, b) => String(a.parentId).localeCompare(String(b.parentId)));

  const byParentId = {};
  for (const p of parents) {
    byParentId[p.parentId] = p;
  }

  return {
    generated: new Date().toISOString(),
    parentCount: parents.length,
    parents,
    byParentId,
  };
}

export async function writeRollup(masterPath, rollupPath) {
  const master = readJson(masterPath, { records: [] });
  const rollup = buildRollupFromRecords(master.records || []);
  writeJson(rollupPath, rollup);
  console.log("Rollup:", rollup.parentCount, "parents →", rollupPath);
  return rollup;
}
