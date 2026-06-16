/**
 * Named park polygons + point-in-polygon helpers for playground filtering.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const tools = path.dirname(fileURLToPath(import.meta.url));

export function parkDisplayName(tags) {
  return (tags?.name || tags?.["name:en"] || tags?.["name:fr"] || "").trim();
}

export function isNamedOsmPark(tags) {
  if (!tags) return false;
  const name = parkDisplayName(tags);
  if (!name || name.length < 2) return false;
  const access = String(tags.access || "").trim().toLowerCase();
  if (access === "private" || access === "no" || access === "customers") return false;
  if (tags.leisure === "park") return true;
  if (tags.landuse === "recreation_ground") return true;
  if (tags.boundary === "national_park") return true;
  return false;
}

export function ringBbox(ring) {
  let s = Infinity;
  let w = Infinity;
  let n = -Infinity;
  let e = -Infinity;
  for (const [lon, lat] of ring) {
    if (lat < s) s = lat;
    if (lat > n) n = lat;
    if (lon < w) w = lon;
    if (lon > e) e = lon;
  }
  return { south: s, west: w, north: n, east: e };
}

export function pointInRing(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInPolygonRings(lat, lon, rings) {
  if (!rings?.length || rings[0].length < 3) return false;
  if (!pointInRing(lat, lon, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) {
    if (rings[i].length >= 3 && pointInRing(lat, lon, rings[i])) return false;
  }
  return true;
}

export function wayToRings(refs, nodeCoords) {
  const ring = [];
  for (const id of refs || []) {
    const c = nodeCoords.get(id);
    if (!c) return null;
    ring.push([c.lon, c.lat]);
  }
  if (ring.length < 3) return null;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  return [ring];
}

const GRID = 0.1;

function cellKey(lat, lon) {
  return `${Math.floor(lat / GRID)}:${Math.floor(lon / GRID)}`;
}

export class ParkSpatialIndex {
  constructor() {
    this.parks = [];
    this.grid = new Map();
  }

  add(park) {
    const idx = this.parks.length;
    this.parks.push(park);
    const bb = park.bbox;
    const y0 = Math.floor(bb.south / GRID);
    const y1 = Math.floor(bb.north / GRID);
    const x0 = Math.floor(bb.west / GRID);
    const x1 = Math.floor(bb.east / GRID);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const k = `${y}:${x}`;
        if (!this.grid.has(k)) this.grid.set(k, []);
        this.grid.get(k).push(idx);
      }
    }
  }

  findParkAt(lat, lon) {
    const y = Math.floor(lat / GRID);
    const x = Math.floor(lon / GRID);
    const seen = new Set();
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const list = this.grid.get(`${y + dy}:${x + dx}`);
        if (!list) continue;
        for (const idx of list) {
          if (seen.has(idx)) continue;
          seen.add(idx);
          const park = this.parks[idx];
          const bb = park.bbox;
          if (lat < bb.south || lat > bb.north || lon < bb.west || lon > bb.east) continue;
          if (pointInPolygonRings(lat, lon, park.rings)) return park;
        }
      }
    }
    return null;
  }
}

export function loadNpsParkPolygons(region) {
  const geoPath = path.join(tools, "park-boundaries.geojson");
  if (!fs.existsSync(geoPath)) return [];
  const geo = JSON.parse(fs.readFileSync(geoPath, "utf8"));
  const wantCountry = region === "ca" ? "CA" : "US";
  const parks = [];
  for (const f of geo.features || []) {
    const p = f.properties || {};
    if (p.country !== wantCountry) continue;
    const name = (p.name || "").trim();
    if (!name) continue;
    const geom = f.geometry;
    if (!geom) continue;
    if (geom.type === "Polygon") {
      const rings = geom.coordinates;
      if (!rings?.[0]?.length) continue;
      parks.push({
        name,
        source: "nps",
        rings,
        bbox: ringBbox(rings[0]),
      });
    } else if (geom.type === "MultiPolygon") {
      for (const poly of geom.coordinates || []) {
        if (!poly?.[0]?.length) continue;
        parks.push({
          name,
          source: "nps",
          rings: poly,
          bbox: ringBbox(poly[0]),
        });
      }
    }
  }
  return parks;
}
