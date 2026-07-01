/**
 * Explorer embed for US park amenities.
 */
import fs from "fs";
import { EMBED_PATH, loadUsMasterRecords } from "./park-amenities-us-lib.mjs";

function toEmbedRow(r) {
  const pu = r.parentUnit || {};
  const row = {
    id: r.id,
    name: r.name,
    kind: r.kind,
    subtype: r.subtype || "",
    lat: r.lat,
    lon: r.lon,
    state: r.state || "",
    country: r.country || "US",
    parkCode: r.parkCode || pu.parkCode || "",
    parentName: pu.name || "",
    parentCategory: pu.category || "",
    landManager: r.landManager || "",
    url: r.urls?.detail || r.urls?.park || r.urls?.osm || "",
    coordConfidence: r.coordConfidence || "",
    needsReview: !!r.needsReview,
  };
  if (r.kind === "campground") {
    row.campTier = r.campTier || "developed";
    row.accessMode = r.accessMode || "unknown";
    row.accessConfidence = r.accessConfidence || "";
    if (r.roadDistanceM != null) row.roadDistanceM = r.roadDistanceM;
    if (r.trailDistanceM != null) row.trailDistanceM = r.trailDistanceM;
  }
  return row;
}

const master = loadUsMasterRecords();
const records = (master.records || []).map(toEmbedRow);

const byKind = {};
const byCampTier = { developed: 0, backcountry: 0, primitive: 0 };
const byAccessMode = { road: 0, trail: 0, unknown: 0 };
for (const r of records) {
  byKind[r.kind] = (byKind[r.kind] || 0) + 1;
  if (r.kind === "campground" && r.campTier) byCampTier[r.campTier] += 1;
  if (r.kind === "campground") byAccessMode[r.accessMode] = (byAccessMode[r.accessMode] || 0) + 1;
}

const payload = {
  generated: master.generated,
  kind: "park_amenity",
  region: "us",
  count: records.length,
  byKind,
  byCampTier,
  byAccessMode,
  needsReviewCount: records.filter((r) => r.needsReview).length,
  records,
};

fs.writeFileSync(
  EMBED_PATH,
  "/* Auto-generated — node build-park-amenities-us-explorer-embed.mjs */\nvar PARK_AMENITIES_US=" +
    JSON.stringify(payload) +
    ";\n",
  "utf8"
);

console.log("Wrote", EMBED_PATH, records.length, byKind, byCampTier, byAccessMode);
