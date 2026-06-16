/**
 * Slim camping layer for route-editor (Parks Canada + provincial).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { includeInEmbed } from "./build-camping-ca-master.mjs";
import { rollupParksCanadaForEmbed } from "./camping-ca-embed-rollup.mjs";
import { formatCaCampgroundDisplayName } from "./camping-ca-display-name.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));
const masterPath = path.join(tools, "camping-ca-master.json");
const outPath = path.join(tools, "camping-ca-explorer-embed.js");

function parentLabel(pu) {
  if (!pu) return "";
  return pu.name || pu.parkCode || "";
}

function toEmbedRow(r) {
  return {
    id: r.id,
    name: formatCaCampgroundDisplayName(r),
    lat: r.lat,
    lon: r.lon,
    landManager: r.landManager,
    state: r.state || "",
    cost: r.cost || "",
    url: r.urls?.detail || "",
    parent: parentLabel(r.parentUnit),
  };
}

if (!fs.existsSync(masterPath)) {
  const empty = { generated: new Date().toISOString(), count: 0, records: [] };
  fs.writeFileSync(
    outPath,
    "/* Auto-generated — run node build-camping-ca-all.mjs */\nvar CAMPING_CA_EXPLORER=" + JSON.stringify(empty) + ";\n",
    "utf8"
  );
  console.warn("No camping-ca-master.json; wrote empty embed");
  process.exit(0);
}

const master = JSON.parse(fs.readFileSync(masterPath, "utf8"));
const eligibleMaster = master.records.filter(includeInEmbed);
const rolledMaster = rollupParksCanadaForEmbed(eligibleMaster);
const rolled = rolledMaster.map(toEmbedRow);

const payload = {
  generated: master.generated,
  masterCount: master.records.length,
  embedBeforeRollup: eligibleMaster.length,
  count: rolled.length,
  records: rolled,
};

fs.writeFileSync(
  outPath,
  "/* Auto-generated — node build-camping-ca-explorer-embed.mjs */\nvar CAMPING_CA_EXPLORER=" +
    JSON.stringify(payload) +
    ";\n",
  "utf8"
);
console.log("Wrote", outPath, rolled.length, "campgrounds (from", eligibleMaster.length, "pre-rollup)");
