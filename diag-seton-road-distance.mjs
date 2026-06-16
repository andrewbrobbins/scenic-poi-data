import { createReadStream } from "fs";
import { pipeline } from "stream/promises";
import { Writable } from "stream";
import { buildSegmentGridIndex, isDrivableHighway, nearestRoadDistanceM, distPointToSegmentM } from "./poi-road-network.mjs";
const clip = "c:/Users/arobbins/OneDrive - University of Texas at Tyler/Documents/Vancouver Trip/tools/osm-pbf/road-clips/seton-full.osm.pbf";
const points = [
  { label: "Seton parking (web)", lat: 50.662457, lon: -121.990923 },
  { label: "Seton trail lookout (web)", lat: 50.660328, lon: -121.986269 },
  { label: "OSM node 4740878166", lat: 50.6625405, lon: -121.9910523 },
];
async function loadClip() {
  const mod = await import("osm-pbf-parser");
  const parser = mod.default || mod;
  const nodeCoords = new Map();
  const ways = [];
  await pipeline(createReadStream(clip), parser(), new Writable({ objectMode: true, write(chunks, _enc, cb) {
    for (const item of chunks) {
      if (item.type === "node") nodeCoords.set(item.id, { lat: item.lat, lon: item.lon, tags: item.tags || {} });
      else if (item.type === "way") ways.push({ id: item.id, refs: item.refs || [], tags: item.tags || {} });
    }
    cb();
  }}));
  return { nodeCoords, ways };
}
function buildSegments(ways, nodeCoords, filterFn) {
  const segments = [];
  const byHw = {};
  for (const way of ways) {
    const hw = way.tags.highway;
    if (!hw || !filterFn(way.tags)) continue;
    byHw[hw] = (byHw[hw] || 0) + 1;
    let prev = null;
    for (const id of way.refs) {
      const c = nodeCoords.get(id);
      if (!c) { prev = null; continue; }
      if (prev) segments.push({ hw, aLat: prev.lat, aLon: prev.lon, bLat: c.lat, bLon: c.lon });
      prev = c;
    }
  }
  return { segments, byHw };
}
function bruteNearest(lat, lon, segments) {
  let best = Infinity, bestHw = null;
  for (const s of segments) {
    const d = distPointToSegmentM(lat, lon, s.aLat, s.aLon, s.bLat, s.bLon);
    if (d < best) { best = d; bestHw = s.hw; }
  }
  return { d: best === Infinity ? null : best, hw: bestHw };
}
const { nodeCoords, ways } = await loadClip();
console.log("clip nodes", nodeCoords.size, "ways", ways.length);
console.log("highway tags:", [...new Set(ways.filter(w=>w.tags.highway).map(w=>w.tags.highway))].sort().join(", "));
for (const [name, filterFn] of [["lean", t => isDrivableHighway(t, { lean: true })], ["full", t => isDrivableHighway(t, { lean: false })], ["any", t => Boolean(t.highway)]]) {
  const { segments, byHw } = buildSegments(ways, nodeCoords, filterFn);
  console.log("\n=== " + name + ": " + segments.length + " segs ===", byHw);
  for (const cellDeg of [0.0027, 0.0015, 0.0005]) {
    const index = segments.length ? buildSegmentGridIndex(segments.map(s => [s.aLat, s.aLon, s.bLat, s.bLon]), cellDeg) : null;
    for (const p of points) {
      const brute = bruteNearest(p.lat, p.lon, segments);
      const grid = index ? nearestRoadDistanceM(p.lat, p.lon, index, { searchRadiusCells: 5 }) : null;
      console.log("  cell=" + cellDeg + " " + p.label + ": brute=" + (brute.d?.toFixed(1) ?? "null") + " (" + brute.hw + ") grid=" + (grid?.toFixed(1) ?? "null"));
    }
  }
}
console.log("\nviewpoint nodes:");
for (const [id, c] of nodeCoords) if (c.tags.tourism === "viewpoint") console.log(" ", id, c.lat, c.lon, c.tags.name||"");