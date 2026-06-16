import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const tools = path.dirname(fileURLToPath(import.meta.url));
const master = JSON.parse(fs.readFileSync(path.join(tools, "camping-us-master.json"), "utf8"));

const features = master.records
  .filter((r) => r.needsReview || r.isPlaceholder)
  .map((r) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [r.lon, r.lat] },
    properties: {
      id: r.id,
      name: r.name,
      landManager: r.landManager,
      mapFlags: (r.mapFlags || []).join(","),
      reviewReasons: (r.reviewReasons || []).join(";"),
      isPlaceholder: !!r.isPlaceholder,
    },
  }));

const geojson = { type: "FeatureCollection", features };
const out = path.join(tools, "camping-us-needs-review.geojson");
fs.writeFileSync(out, JSON.stringify(geojson), "utf8");
console.log("Wrote", out, features.length, "features");
