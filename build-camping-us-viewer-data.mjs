/**
 * Compact camping data for the interactive map (camping-map.html).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const tools = path.dirname(fileURLToPath(import.meta.url));
const masterPath = path.join(tools, "camping-us-master.json");
const jsonPath = path.join(tools, "camping-us-viewer.json");
const jsPath = path.join(tools, "camping-us-viewer.js");

const MGR_CODES = {
  NPS: 0,
  USFS: 1,
  BLM: 2,
  State: 3,
  COE: 4,
  USFWS: 5,
  County: 6,
  City: 7,
  Unknown: 8,
  Federal: 9,
};

const TYPE_CODES = { developed: 0, dispersed: 1, group: 2, placeholder: 3 };
const TIER_CODES = { default: 0, qa: 1, excluded: 2 };

function parentLabel(pu) {
  if (!pu) return "";
  if (pu.parkCode) return pu.name || pu.parkCode;
  return pu.name || "";
}

function toRow(r) {
  const flags = (r.mapFlags || []).join(",");
  const typ = TYPE_CODES[r.type] ?? 0;
  const tier = TIER_CODES[r.displayTier] ?? 2;
  return [
    Math.round(r.lat * 1e5) / 1e5,
    Math.round(r.lon * 1e5) / 1e5,
    MGR_CODES[r.landManager] ?? 8,
    r.needsReview ? 1 : 0,
    flags,
    r.name,
    r.id,
    r.state || "",
    typ,
    parentLabel(r.parentUnit),
    r.cost || "",
    r.isPlaceholder ? 1 : 0,
    r.urls?.detail || "",
    tier,
    r.roadDistanceM != null ? Math.min(99999, Math.round(r.roadDistanceM)) : -1,
    r.excludeReason || "",
  ];
}

const master = JSON.parse(fs.readFileSync(masterPath, "utf8"));
const payload = {
  g: master.generated,
  n: master.recordCount,
  mgr: Object.fromEntries(Object.entries(MGR_CODES).map(([k, v]) => [v, k])),
  typ: ["developed", "dispersed", "group", "placeholder"],
  cols: [
    "lat",
    "lon",
    "mgr",
    "review",
    "flags",
    "name",
    "id",
    "state",
    "type",
    "parent",
    "cost",
    "placeholder",
    "url",
    "displayTier",
    "roadDistanceM",
    "excludeReason",
  ],
  tier: ["default", "qa", "excluded"],
  r: master.records.map(toRow),
};

const json = JSON.stringify(payload);
fs.writeFileSync(jsonPath, json, "utf8");
fs.writeFileSync(jsPath, "/* Auto-generated */\nvar CAMPING_VIEWER=" + json + ";\n", "utf8");
const mb = (Buffer.byteLength(json) / 1024 / 1024).toFixed(2);
console.log("Wrote", jsonPath, "and", jsPath, `(${mb} MB, ${payload.r.length} rows)`);
