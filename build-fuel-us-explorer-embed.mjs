/**
 * Static browser bundle for fuel stops (catalog brands only).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const tools = path.dirname(fileURLToPath(import.meta.url));
const masterPath = path.join(tools, "fuel-us-master.json");
const outPath = path.join(tools, "fuel-us-explorer-embed.js");

const master = JSON.parse(fs.readFileSync(masterPath, "utf8"));
const records = master.records.map((r) => ({
  id: r.id,
  name: r.name,
  brand: r.brand,
  brandId: r.brandId,
  lat: r.lat,
  lon: r.lon,
  state: r.state || "",
  type: r.type || "",
  diesel: !!r.fuels?.diesel,
  url: r.url || "",
  highway: r.highway || "",
}));

const payload = {
  generated: master.generated,
  count: records.length,
  brands: [...new Set(records.map((r) => r.brandId))].sort(),
  records,
};

fs.writeFileSync(
  outPath,
  "/* Auto-generated — node build-fuel-us-explorer-embed.mjs */\nvar FUEL_US=" + JSON.stringify(payload) + ";\n",
  "utf8"
);
console.log("Wrote", outPath, records.length, "fuel stops");
