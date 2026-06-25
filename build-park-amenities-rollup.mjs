/**
 * Per-park amenity rollup from park-amenities-us-master.json.
 */
import {
  CAMP_TIERS,
  MASTER_PATH,
  ROLLUP_PATH,
  emptyCampgroundRollup,
  emptyKindRollup,
  readJson,
  writeJson,
} from "./park-amenities-us-lib.mjs";

function rollupKey(record) {
  const pu = record.parentUnit || {};
  const system = pu.system || "nps";
  const id = record.parkCode || pu.parkCode || "";
  return `${system}:${id}`;
}

export function buildRollupFromRecords(records) {
  const byParent = new Map();

  for (const r of records) {
    const key = rollupKey(r);
    if (!key.endsWith(":")) {
      if (!byParent.has(key)) {
        const pu = r.parentUnit || {};
        byParent.set(key, {
          parentSystem: pu.system || "nps",
          parentId: r.parkCode || pu.parkCode,
          parentName: pu.name || "",
          parentCategory: pu.category || "",
          parentDesignation: pu.designation || "",
          campground: emptyCampgroundRollup(),
          picnic_area: emptyKindRollup(),
          restroom: emptyKindRollup(),
          sources: new Set(),
          coverage: "official",
        });
      }
      const row = byParent.get(key);
      row.sources.add(r.ingestSource || r.coordSource || "unknown");

      if (r.kind === "campground" && r.campTier && row.campground[r.campTier]) {
        row.campground[r.campTier].count += 1;
        row.campground[r.campTier].has = true;
      } else if (r.kind === "picnic_area") {
        row.picnic_area.count += 1;
        row.picnic_area.has = true;
      } else if (r.kind === "restroom") {
        row.restroom.count += 1;
        row.restroom.has = true;
      }
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
      },
    }))
    .sort((a, b) => a.parentId.localeCompare(b.parentId));

  return {
    generated: new Date().toISOString(),
    parentCount: parents.length,
    parents,
    byParentId: Object.fromEntries(parents.map((p) => [p.parentId, p])),
  };
}

export async function buildRollup() {
  const master = readJson(MASTER_PATH, { records: [] });
  const rollup = buildRollupFromRecords(master.records || []);
  writeJson(ROLLUP_PATH, rollup);
  console.log("Rollup:", rollup.parentCount, "parent parks");
  return rollup;
}

if (process.argv[1]?.endsWith("build-park-amenities-rollup.mjs")) {
  await buildRollup();
}
