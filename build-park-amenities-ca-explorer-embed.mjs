/**
 * Explorer embed for Canada park amenities.
 */
import fs from "fs";
import { EMBED_PATH, MASTER_PATH } from "./park-amenities-ca-lib.mjs";

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
    country: "CA",
    parkCode: r.parkCode || pu.parkCode || "",
    parentName: pu.name || "",
    parentCategory: pu.category || "",
    landManager: r.landManager || "",
    url: r.urls?.detail || r.urls?.park || "",
    coordConfidence: r.coordConfidence || "",
    needsReview: !!r.needsReview,
  };
  if (r.kind === "campground") {
    row.campTier = r.campTier || "developed";
    row.accessMode = r.accessMode || "unknown";
    row.accessConfidence = r.accessConfidence || "";
  }
  return row;
}

const master = JSON.parse(fs.readFileSync(MASTER_PATH, "utf8"));
const records = (master.records || []).map(toEmbedRow);

const payload = {
  generated: master.generated,
  kind: "park_amenity",
  region: "ca",
  count: records.length,
  byKind: master.byKind || {},
  byCampTier: master.byCampTier || {},
  needsReviewCount: records.filter((r) => r.needsReview).length,
  records,
};

fs.writeFileSync(
  EMBED_PATH,
  "/* Auto-generated — node build-park-amenities-ca-explorer-embed.mjs */\nvar PARK_AMENITIES_CA=" +
    JSON.stringify(payload) +
    ";\n",
  "utf8"
);

console.log("Wrote", EMBED_PATH, records.length);
