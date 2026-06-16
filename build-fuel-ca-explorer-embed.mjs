/**
 * Static browser bundle for Canada fuel stops.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const tools = path.dirname(fileURLToPath(import.meta.url));
const masterPath = path.join(tools, "fuel-ca-master.json");
const outPath = path.join(tools, "fuel-ca-explorer-embed.js");

if (!fs.existsSync(masterPath)) {
  const empty = { generated: new Date().toISOString(), count: 0, brands: [], records: [] };
  fs.writeFileSync(
    outPath,
    "/* Auto-generated — run node build-fuel-ca-all.mjs */\nvar FUEL_CA=" + JSON.stringify(empty) + ";\n",
    "utf8"
  );
  console.warn("No fuel-ca-master.json; wrote empty FUEL_CA embed");
  process.exit(0);
}

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
  "/* Auto-generated — node build-fuel-ca-explorer-embed.mjs */\nvar FUEL_CA=" + JSON.stringify(payload) + ";\n",
  "utf8"
);
console.log("Wrote", outPath, records.length, "fuel stops");
