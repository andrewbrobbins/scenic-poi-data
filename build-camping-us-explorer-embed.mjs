/**
 * Slim filtered camping layer for route-explorer / route-editor.
 * Full master retained in camping-us-master.json; use --disable-filter to widen embed.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadFilterConfig, includeInDefaultEmbed } from "./camping-us-filter.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));
const masterPath = path.join(tools, "camping-us-master.json");
const outPath = path.join(tools, "camping-us-explorer-embed.js");
const outFullPath = path.join(tools, "camping-us-explorer-embed-full.js");

function parentLabel(pu) {
  if (!pu) return "";
  if (pu.parkCode) return pu.name || pu.parkCode;
  return pu.name || "";
}

function toEmbedRow(r) {
  return {
    id: r.id,
    name: r.name,
    lat: r.lat,
    lon: r.lon,
    landManager: r.landManager,
    state: r.state || "",
    cost: r.cost || "",
    url: r.urls?.detail || "",
    parent: parentLabel(r.parentUnit),
  };
}

function legacyInclude(r) {
  if (r.isPlaceholder) return false;
  if (r.type === "dispersed") return false;
  if ((r.mapFlags || []).includes("NPS_NO_CG")) return false;
  return true;
}

const cfg = loadFilterConfig();
const master = JSON.parse(fs.readFileSync(masterPath, "utf8"));
const allEligible = master.records.filter(legacyInclude);
const defaultRecords = master.records.filter((r) => includeInDefaultEmbed(r, cfg)).map(toEmbedRow);
const fullRecords = allEligible.map(toEmbedRow);

const meta = {
  generated: master.generated,
  filterEnabled: cfg.enabled,
  filterVersion: cfg.version,
  masterCount: master.records.length,
  fullCount: fullRecords.length,
  defaultCount: defaultRecords.length,
  filterStats: master.filterStats || null,
};

const payload = {
  ...meta,
  count: defaultRecords.length,
  records: defaultRecords,
};

fs.writeFileSync(
  outPath,
  "/* Auto-generated — node build-camping-us-explorer-embed.mjs */\nvar CAMPING_US_EXPLORER=" +
    JSON.stringify(payload) +
    ";\n",
  "utf8"
);

const fullPayload = {
  ...meta,
  count: fullRecords.length,
  records: fullRecords,
};

fs.writeFileSync(
  outFullPath,
  "/* Auto-generated — unfiltered legacy embed (placeholders/dispersed/NPS_NO_CG only) */\nvar CAMPING_US_EXPLORER_FULL=" +
    JSON.stringify(fullPayload) +
    ";\n",
  "utf8"
);

console.log(
  "Wrote",
  outPath,
  defaultRecords.length,
  "default |",
  outFullPath,
  fullRecords.length,
  "full | filter",
  cfg.enabled ? "ON" : "OFF"
);
