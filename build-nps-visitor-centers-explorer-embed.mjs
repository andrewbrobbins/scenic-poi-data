/**
 * Slim NPS visitor center layer for scenic-router / poi-explorer.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { MASTER_PATH } from "./nps-visitor-centers-lib.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(tools, "nps-visitor-centers-us-explorer-embed.js");

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
    url: r.urls?.detail || r.urls?.visitorCenters || r.urls?.park || "",
    coordConfidence: r.coordConfidence || "",
    needsReview: !!r.needsReview,
  };
}

const master = JSON.parse(fs.readFileSync(MASTER_PATH, "utf8"));
const records = (master.records || []).map(toEmbedRow);

const payload = {
  generated: master.generated,
  kind: "nps_visitor_center",
  region: "us",
  count: records.length,
  withHours: records.filter((r) => r.hoursSummary?.hasHours).length,
  needsReviewCount: records.filter((r) => r.needsReview).length,
  records,
};

fs.writeFileSync(
  outPath,
  "/* Auto-generated — node build-nps-visitor-centers-explorer-embed.mjs */\nvar NPS_VISITOR_CENTERS_US=" +
    JSON.stringify(payload) +
    ";\n",
  "utf8"
);

console.log("Wrote", outPath, records.length, "records");
