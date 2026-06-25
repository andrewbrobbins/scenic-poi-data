/**
 * Slim park amenities layer for poi-explorer / scenic-router.
 */
import fs from "fs";
import { EMBED_PATH, MASTER_PATH } from "./park-amenities-us-lib.mjs";

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
    parkCode: r.parkCode || pu.parkCode || "",
    parentName: pu.name || "",
    parentCategory: pu.category || "",
    landManager: r.landManager || "NPS",
    url: r.urls?.detail || r.urls?.park || "",
    coordConfidence: r.coordConfidence || "",
    needsReview: !!r.needsReview,
  };
  if (r.kind === "campground") row.campTier = r.campTier || "developed";
  return row;
}

const master = JSON.parse(fs.readFileSync(MASTER_PATH, "utf8"));
const records = (master.records || []).map(toEmbedRow);

const byKind = {};
const byCampTier = { developed: 0, backcountry: 0, primitive: 0 };
for (const r of records) {
  byKind[r.kind] = (byKind[r.kind] || 0) + 1;
  if (r.kind === "campground" && r.campTier) {
    byCampTier[r.campTier] = (byCampTier[r.campTier] || 0) + 1;
  }
}

const payload = {
  generated: master.generated,
  kind: "park_amenity",
  region: "us",
  manager: "nps",
  count: records.length,
  byKind,
  byCampTier,
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

console.log("Wrote", EMBED_PATH, records.length, "records", byKind, byCampTier);
