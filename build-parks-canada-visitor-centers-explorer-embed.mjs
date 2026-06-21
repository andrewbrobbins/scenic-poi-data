/**
 * Slim Parks Canada visitor center layer for poi-explorer.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { MASTER_PATH } from "./parks-canada-visitor-centers-lib.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(tools, "parks-canada-visitor-centers-ca-explorer-embed.js");

function toEmbedRow(r) {
  const pu = r.parentUnit || {};
  return {
    id: r.id,
    name: r.name,
    lat: r.lat,
    lon: r.lon,
    state: r.state || "",
    parkCode: r.parkCode || pu.parkCode || "",
    parentName: pu.name || "",
    parentCategory: pu.category || "",
    parentDesignation: pu.designation || "",
    hoursSummary: r.hoursSummary || { hasHours: false, summary: "", seasonalNote: "" },
    seasonal: r.seasonal || { isSeasonal: null, description: "" },
    url: r.urls?.detail || r.urls?.park || "",
    coordConfidence: r.coordConfidence || "",
    needsReview: !!r.needsReview,
  };
}

const master = JSON.parse(fs.readFileSync(MASTER_PATH, "utf8"));
const records = (master.records || []).map(toEmbedRow);

const payload = {
  generated: master.generated,
  kind: "pc_visitor_center",
  region: "ca",
  count: records.length,
  withHours: records.filter((r) => r.hoursSummary?.hasHours).length,
  needsReviewCount: records.filter((r) => r.needsReview).length,
  records,
};

fs.writeFileSync(
  outPath,
  "/* Auto-generated — node build-parks-canada-visitor-centers-explorer-embed.mjs */\nvar PARKS_CANADA_VISITOR_CENTERS_CA=" +
    JSON.stringify(payload) +
    ";\n",
  "utf8"
);

console.log("Wrote", outPath, records.length, "records");
