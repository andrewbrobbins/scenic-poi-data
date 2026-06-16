import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const tools = path.dirname(fileURLToPath(import.meta.url));
const masterPath = path.join(tools, "camping-us-master.json");
const outPath = path.join(tools, "camping-us-embed.js");

const master = JSON.parse(fs.readFileSync(masterPath, "utf8"));
const slim = master.records.map((r) => ({
  id: r.id,
  name: r.name,
  type: r.type,
  landManager: r.landManager,
  state: r.state,
  lat: r.lat,
  lon: r.lon,
  cost: r.cost,
  dispersed: r.dispersed,
  needsReview: r.needsReview,
  mapFlags: r.mapFlags,
  isPlaceholder: r.isPlaceholder || false,
  parentUnit: r.parentUnit,
}));

fs.writeFileSync(
  outPath,
  "/* Auto-generated from camping-us-master.json */\nvar CAMPING_US=" +
    JSON.stringify({ generated: master.generated, recordCount: slim.length, records: slim }) +
    ";\n",
  "utf8"
);
console.log("Wrote", outPath, slim.length, "records");
