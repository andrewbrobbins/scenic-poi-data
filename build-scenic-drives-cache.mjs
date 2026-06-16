/**
 * Build scenic drive polylines via OSRM (run once; cached for explorer).
 * node tools/build-scenic-drives-cache.mjs
 * node tools/build-scenic-drives-cache.mjs --refresh-network
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(__dirname, "scenic-drives-source.json");
const CACHE = path.join(__dirname, "scenic-drives-cache.json");
const EMBED = path.join(__dirname, "scenic-drives-embed.js");
const OSRM = "https://router.project-osrm.org/route/v1/driving";

async function fetchGeometry(waypoints) {
  if (!waypoints || waypoints.length < 2) return waypoints || [];
  const coordStr = waypoints.map((p) => p[1] + "," + p[0]).join(";");
  const url = OSRM + "/" + coordStr + "?overview=full&geometries=geojson";
  const res = await fetch(url);
  const data = await res.json();
  if (data.code === "Ok" && data.routes?.[0]) {
    return data.routes[0].geometry.coordinates.map((c) => [c[1], c[0]]);
  }
  return waypoints;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getDefaultSource() {
  return {
    version: 1,
    note: "From research/database/01-scenic-drives.md — edit and run build with --refresh-network",
    drives: [
      { id: "S-TX-01", name: "Piney Woods north (US-69/75)", roads: "US-69, US-75", priority: "M", states: ["TX"], corridors: ["SW", "CO", "SWY", "MT"], waypoints: [[32.3513, -95.3011], [33.2, -95.25], [34.77, -95.97]] },
      { id: "S-OK-01", name: "Route 66 historic (OK)", roads: "OK-66", priority: "M", states: ["OK"], corridors: ["SW", "CO", "SWY", "MT"], waypoints: [[35.51, -98.97], [35.41, -99.39], [35.22, -99.88]] },
      { id: "S-OK-02", name: "Wichita Mountains Scenic Byway", roads: "US-281", priority: "H", states: ["OK"], corridors: ["SW", "CO"], waypoints: [[34.72, -98.52], [34.71, -98.67], [34.74, -98.78]] },
      { id: "S-OK-03", name: "Talimena National Scenic Byway", roads: "OK-1", priority: "H", states: ["OK"], corridors: ["SW"], waypoints: [[34.71, -94.68], [34.78, -94.55], [34.85, -94.42]] },
      { id: "S-KS-01", name: "Flint Hills National Scenic Byway", roads: "KS-177", priority: "H", states: ["KS"], corridors: ["CO", "SWY", "MT"], waypoints: [[38.66, -96.77], [38.5, -96.72], [38.33, -96.43]] },
      { id: "S-KS-02", name: "Smoky Valley Scenic Byway", roads: "KS-147", priority: "M", states: ["KS"], corridors: ["CO", "SWY", "MT"], waypoints: [[38.88, -100.13], [38.93, -100.13], [39.02, -100.08]] },
      { id: "S-CO-01", name: "US-50 Bighorn Sheep Canyon", roads: "US-50", priority: "H", states: ["CO"], corridors: ["SW", "CO", "SWY", "MT"], waypoints: [[38.25, -104.61], [38.42, -105.24], [38.53, -105.99]] },
      { id: "S-CO-02", name: "Monarch Pass (US-50)", roads: "US-50", priority: "H", states: ["CO"], corridors: ["SW", "CO", "SWY", "MT"], waypoints: [[38.53, -105.99], [38.45, -106.32], [38.39, -106.2]] },
      { id: "S-CO-03", name: "Curecanti / Blue Mesa (US-50)", roads: "US-50", priority: "H", states: ["CO"], corridors: ["SW", "CO", "SWY", "MT"], waypoints: [[38.39, -107.32], [38.47, -107.14], [38.5, -107.05]] },
      { id: "S-CO-04", name: "Million Dollar Highway (US-550)", roads: "US-550", priority: "H", states: ["CO"], corridors: ["SW", "CO"], waypoints: [[37.88, -107.67], [38.02, -107.67], [38.17, -107.75]] },
      { id: "S-CO-05", name: "Trail Ridge Road", roads: "US-34", priority: "H", states: ["CO"], corridors: ["SWY", "MT"], waypoints: [[40.38, -105.73], [40.44, -105.75], [40.42, -105.64]] },
      { id: "S-UT-01", name: "Dinosaur Diamond Scenic Byway", roads: "US-40, UT-10", priority: "H", states: ["UT"], corridors: ["SW", "CO", "SWY", "MT"], waypoints: [[40.44, -109.52], [40.35, -109.55], [40.17, -110.16]] },
      { id: "S-UT-02", name: "US-6 Price Canyon", roads: "US-6", priority: "M", states: ["UT"], corridors: ["SW", "CO", "SWY", "MT"], waypoints: [[39.72, -110.81], [39.6, -110.81], [39.55, -110.81]] },
      { id: "S-ID-03", name: "Craters of the Moon loop", roads: "Loop Rd", priority: "M", states: ["ID"], corridors: ["SW", "CO", "SWY"], waypoints: [[43.42, -113.52], [43.46, -113.55], [43.44, -113.48]] },
      { id: "S-ID-04", name: "US-20 Sawtooth approach", roads: "US-20", priority: "M", states: ["ID"], corridors: ["MT"], waypoints: [[43.62, -114.35], [43.75, -114.9], [44.2, -115.5]] },
      { id: "S-OR-01", name: "Columbia River Gorge", roads: "I-84, US-30", priority: "H", states: ["OR", "WA"], corridors: ["SW", "CO", "SWY", "MT"], waypoints: [[45.6, -121.65], [45.57, -122.12], [45.59, -122.12]] },
      { id: "S-OR-02", name: "Historic Columbia River Highway", roads: "US-30", priority: "H", states: ["OR"], corridors: ["SW", "CO", "SWY", "MT"], waypoints: [[45.55, -122.23], [45.58, -122.12], [45.59, -122.12]] },
      { id: "S-WA-01", name: "North Cascades Highway (WA-20)", roads: "WA-20", priority: "H", states: ["WA"], corridors: ["SW", "CO", "SWY", "MT"], waypoints: [[48.72, -121.13], [48.53, -120.75], [48.42, -120.55]] },
      { id: "S-WA-02", name: "Cascade Loop (US-97 / WA-20)", roads: "US-97, WA-20", priority: "H", states: ["WA"], corridors: ["SW", "CO", "SWY", "MT"], waypoints: [[47.42, -120.33], [47.84, -120.02], [48.5, -120.5]] },
      { id: "S-WA-03", name: "US-97 Columbia River", roads: "US-97", priority: "M", states: ["WA", "OR"], corridors: ["SW", "CO", "SWY", "MT"], waypoints: [[45.94, -119.97], [46.25, -119.89], [46.65, -119.85]] },
      { id: "S-BC-01", name: "Trans-Canada Hwy 1 (Fraser Valley)", roads: "BC-1", priority: "M", states: ["BC"], corridors: ["SW", "CO", "SWY", "MT"], waypoints: [[49.38, -121.44], [49.1, -122.33], [49.28, -123.12]] },
      { id: "S-BC-02", name: "Sea to Sky Highway (BC-99)", roads: "BC-99", priority: "H", states: ["BC"], corridors: ["SW", "CO", "SWY", "MT"], waypoints: [[49.7, -123.15], [49.95, -123.0], [50.11, -122.95]] },
      { id: "S-ALT-01", name: "US-12 Lolo Pass", roads: "US-12", priority: "H", states: ["ID", "MT"], corridors: ["MT", "SWY"], waypoints: [[46.58, -114.08], [46.63, -113.91], [46.87, -113.99]] },
      { id: "S-NM-01", name: "Enchanted Circle Scenic Byway", roads: "NM-38, US-64", priority: "H", states: ["NM"], corridors: ["SW"], waypoints: [[36.45, -105.57], [36.56, -105.22], [36.42, -105.04]] },
      { id: "S-WY-01", name: "Snowy Range Scenic Byway", roads: "WY-130", priority: "H", states: ["WY"], corridors: ["SWY", "MT"], waypoints: [[41.35, -106.32], [41.38, -106.25], [41.42, -106.18]] },
      { id: "S-WY-02", name: "Bighorn Scenic Byway (US-14)", roads: "US-14", priority: "H", states: ["WY"], corridors: ["SWY", "MT"], waypoints: [[44.52, -107.13], [44.58, -107.45], [44.8, -107.95]] },
    ],
  };
}

export async function buildScenicDrivesCache(refresh = false) {
  if (!refresh && fs.existsSync(CACHE) && fs.existsSync(EMBED)) {
    const c = JSON.parse(fs.readFileSync(CACHE, "utf8"));
    fs.writeFileSync(EMBED, "/* Auto-generated */\nvar SCENIC_DRIVES=" + JSON.stringify(c.drives) + ";\n", "utf8");
    console.log("Using cache:", c.drives.length, "drives");
    return c.drives.length;
  }

  let source;
  if (fs.existsSync(SOURCE)) {
    source = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
  } else {
    source = getDefaultSource();
    fs.writeFileSync(SOURCE, JSON.stringify(source, null, 2), "utf8");
  }
  const drives = [];
  for (const d of source.drives) {
    process.stdout.write("Routing " + d.id + " ... ");
    try {
      const pathPts = await fetchGeometry(d.waypoints);
      drives.push({
        id: d.id,
        name: d.name,
        roads: d.roads,
        priority: d.priority,
        states: d.states,
        corridors: d.corridors,
        path: pathPts,
      });
      console.log(pathPts.length, "pts");
    } catch (e) {
      console.log("fail", e.message);
      drives.push({ ...d, path: d.waypoints });
    }
    await sleep(1200);
  }

  const out = { generated: new Date().toISOString(), source: "scenic-drives-source.json", count: drives.length, drives };
  fs.writeFileSync(CACHE, JSON.stringify(out, null, 2), "utf8");
  fs.writeFileSync(EMBED, "/* Auto-generated */\nvar SCENIC_DRIVES=" + JSON.stringify(drives) + ";\n", "utf8");
  console.log("Wrote", drives.length, "scenic drives");
  return drives.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const refresh = process.argv.includes("--refresh-network");
  await buildScenicDrivesCache(refresh);
}
