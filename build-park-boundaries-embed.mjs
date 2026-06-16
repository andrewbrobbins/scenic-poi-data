/**
 * Embed park-boundaries.geojson for route-editor (works without fetch / file://).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const tools = path.dirname(fileURLToPath(import.meta.url));
const geoPath = path.join(tools, "park-boundaries.geojson");
const outPath = path.join(tools, "park-boundaries-embed.js");

if (!fs.existsSync(geoPath)) {
  fs.writeFileSync(
    outPath,
    "/* Run node build-park-boundaries.mjs first */\nvar PARK_BOUNDARIES={type:\"FeatureCollection\",count:0,features:[]};\n",
    "utf8"
  );
  console.warn("Missing park-boundaries.geojson; wrote empty embed");
  process.exit(0);
}

const geo = JSON.parse(fs.readFileSync(geoPath, "utf8"));
fs.writeFileSync(
  outPath,
  "/* Auto-generated — node build-park-boundaries-embed.mjs */\nvar PARK_BOUNDARIES=" +
    JSON.stringify(geo) +
    ";\n",
  "utf8"
);
console.log("Wrote", outPath, geo.features?.length || 0, "features");
