import path from "path";
import { PROVINCE_BBOXES } from "./camping-ca-province-bboxes.mjs";
import { coordValid, ensureIngestDir, matchOnrouteServices, slugify, writeJson } from "./fuel-ca-lib.mjs";
const OVERPASS_URL = "https://overpass.kumi.systems/api/interpreter";
function elementCoords(el) {
  if (el.type === "node") return { lat: el.lat, lon: el.lon };
  if (el.center) return { lat: el.center.lat, lon: el.center.lon };
  return null;
}
const bbox = PROVINCE_BBOXES.ON;
const [s, w, n, e] = bbox;
const query = `[out:json][timeout:180];(node["highway"="services"]["name"~"ONroute|OnRoute",i](${s},${w},${n},${e});way["highway"="services"]["name"~"ONroute|OnRoute",i](${s},${w},${n},${e}););out center tags;`;
const res = await fetch(OVERPASS_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "VancouverTripFuelCA/1.0" }, body: "data=" + encodeURIComponent(query) });
const j = await res.json();
const records = [];
const seen = new Set();
for (const el of j.elements || []) {
  const match = matchOnrouteServices(el.tags || {});
  if (!match) continue;
  const coords = elementCoords(el);
  if (!coords || !coordValid(coords.lat, coords.lon)) continue;
  const key = el.type + ":" + el.id;
  if (seen.has(key)) continue;
  seen.add(key);
  const name = (el.tags?.name || "ONroute").trim();
  records.push({ id: `FUEL-CA-ONROUTE-ON-${slugify(name)}-${el.id}`, name, brand: "ONroute", brandId: "onroute", brandTier: "A", type: "highway_service_centre", state: "ON", lat: coords.lat, lon: coords.lon, fuels: { gasoline: true }, sources: ["osm-onroute"], url: `https://www.openstreetmap.org/${el.type}/${el.id}`, mapFlags: [] });
}
const outDir = ensureIngestDir("02-onroute");
writeJson(path.join(outDir, "onroute-ON.json"), { generated: new Date().toISOString(), recordCount: records.length, records });
console.log("ONroute", records.length);
