/**
 * Shared OSM PBF scan for state/provincial park amenities.
 */
import fs from "fs";
import { createReadStream } from "fs";
import { pipeline } from "stream/promises";
import { Writable } from "stream";
import {
  amenityId,
  baseRecord,
  classifyOsmCampTier,
  applyInferredCampgroundAccess,
  writeJson,
} from "./park-amenities-lib.mjs";
import { loadStateParkIndex, resolveStateParkParent } from "./park-amenities-state-park-lib.mjs";
import { isCommercialName } from "./camping-us-lib.mjs";

export function osmAmenityKind(tags) {
  if (tags.tourism === "camp_site" || tags.camp_site) return "campground";
  if (tags.tourism === "picnic_site" || tags.leisure === "picnic_table") return "picnic_area";
  if (tags.amenity === "toilets" || tags.building === "toilets") return "restroom";
  if (tags.amenity === "parking" || tags.parking === "yes") return "parking";
  if (tags.tourism === "information" && /visitor|interpret/i.test(tags.information || tags.name || "")) {
    return "visitor_center";
  }
  if (tags.amenity === "ranger_station" || tags.tourism === "museum") return "visitor_center";
  return null;
}

const PROVINCIAL_PARK_OPERATOR =
  /parks canada|parcs canada|bc parks|british columbia parks|alberta parks|ontario parks|parks ontario|saskatchewan parks|manitoba parks|sepaq|parc provincial|provincial park|ministry of environment|ministry of tourism|novascotia\.ca\/parks|parcsnb|newfoundlandlabrador\.com\/parks/i;

export function isProvincialParkOsm(tags) {
  const op = [tags.operator, tags.owner, tags.brand, tags["operator:fr"]].filter(Boolean).join(" ");
  if (PROVINCIAL_PARK_OPERATOR.test(op)) return true;
  if (/provincial park|parc provincial|sepaq/i.test(tags.name || tags["name:fr"] || "")) return true;
  const website = (tags.website || "").toLowerCase();
  if (/bcparks\.ca|ontarioparks\.|albertaparks\.ca|sepaq\.com|novascotia\.ca\/parks|parks\.saskatchewan\.ca/i.test(website)) {
    return true;
  }
  return false;
}

export function isStateParkOsm(tags) {
  const op = [tags.operator, tags.owner, tags.brand].filter(Boolean).join(" ");
  if (/state park|state parks|dept of natural|dnr|provincial park|bc parks|ontario parks/i.test(op)) {
    return true;
  }
  if (/state park|provincial park/i.test(tags.name || "")) return true;
  return false;
}

async function loadParser() {
  const mod = await import("osm-pbf-parser");
  return mod.default || mod;
}

/**
 * @param {object} opts
 * @param {string} opts.pbfPath
 * @param {"US"|"CA"} opts.country
 * @param {string} opts.outPath
 * @param {function} opts.coordValid
 * @param {function} opts.inferRegion
 * @param {function} opts.isParkOsm
 * @param {string} opts.landManager
 * @param {string} opts.idPrefix
 * @param {string} opts.sourceLabel
 */
export async function scanParkAmenitiesOsmPbf(opts) {
  const {
    pbfPath,
    country,
    outPath,
    coordValid,
    inferRegion,
    isParkOsm,
    landManager,
    idPrefix,
    sourceLabel,
  } = opts;

  if (!fs.existsSync(pbfPath)) {
    console.warn("PBF missing — skip OSM amenities:", pbfPath);
    const empty = { generated: new Date().toISOString(), skipped: true, recordCount: 0, records: [] };
    writeJson(outPath, empty);
    return empty;
  }

  const parkIndex = loadStateParkIndex(country);
  const parser = await loadParser();
  const nodes = [];
  const ways = [];
  const needed = new Set();

  console.log(`${sourceLabel}: scanning PBF...`);

  await pipeline(
    createReadStream(pbfPath),
    parser(),
    new Writable({
      objectMode: true,
      write(chunks, _enc, cb) {
        try {
          for (const item of chunks) {
            if (item.type === "node") {
              const tags = item.tags || {};
              const kind = osmAmenityKind(tags);
              if (!kind) continue;
              if (!isParkOsm(tags) && kind === "campground") continue;
              nodes.push({ kind, tags, lat: item.lat, lon: item.lon, osmId: item.id });
            } else if (item.type === "way") {
              const tags = item.tags || {};
              const kind = osmAmenityKind(tags);
              if (!kind) continue;
              if (!isParkOsm(tags) && kind === "campground") continue;
              ways.push({ kind, tags, refs: item.refs, osmId: item.id });
              for (const id of item.refs || []) needed.add(id);
            }
          }
          cb();
        } catch (e) {
          cb(e);
        }
      },
    })
  );

  const nodeCoords = new Map();
  await pipeline(
    createReadStream(pbfPath),
    parser(),
    new Writable({
      objectMode: true,
      write(chunks, _enc, cb) {
        try {
          for (const item of chunks) {
            if (item.type === "node" && needed.has(item.id)) {
              nodeCoords.set(item.id, { lat: item.lat, lon: item.lon });
            }
          }
          cb();
        } catch (e) {
          cb(e);
        }
      },
    })
  );

  const records = [];
  const skipped = { noCoords: 0, commercial: 0, noParent: 0, parksCanada: 0 };

  function pushRecord(kind, tags, lat, lon, osmId, osmType) {
    if (!coordValid(lat, lon)) {
      skipped.noCoords++;
      return;
    }
    const name = (tags.name || tags["name:fr"] || tags.ref || kind.replace("_", " ")).trim();
    if (isCommercialName(name, tags.operator, tags.brand)) {
      skipped.commercial++;
      return;
    }
    const state = inferRegion(lat, lon);
    const parentUnit = resolveStateParkParent(
      { lat, lon, state, country },
      parkIndex,
      country === "CA" ? 8000 : 5000
    );
    if (!parentUnit.id) {
      skipped.noParent++;
      return;
    }
    const opBlob = [tags.operator, tags.owner, tags.brand, tags["operator:fr"]].filter(Boolean).join(" ");
    if (/parks canada|parcs canada/i.test(opBlob)) {
      skipped.parksCanada++;
      return;
    }

    let campTier;
    if (kind === "campground") {
      campTier = classifyOsmCampTier(tags);
    }

    const rec = baseRecord({
      id: amenityId(idPrefix, parentUnit.id || osmId, kind, campTier, name, lat, lon),
      name,
      kind,
      subtype: tags.leisure === "picnic_table" ? "table" : campTier || kind,
      campTier,
      country,
      landManager,
      parkCode: parentUnit.parkCode || "",
      parentUnit,
      state,
      lat,
      lon,
      coordSource: "osm-pbf",
      coordConfidence: "medium",
      ingestSource: sourceLabel,
      sourceIds: {
        osmType,
        osmId,
        tags: { tourism: tags.tourism, amenity: tags.amenity, leisure: tags.leisure },
      },
      urls: { osm: `https://www.openstreetmap.org/${osmType}/${osmId}` },
    });
    applyInferredCampgroundAccess(rec);
    records.push(rec);
  }

  for (const n of nodes) pushRecord(n.kind, n.tags, n.lat, n.lon, n.osmId, "node");
  for (const w of ways) {
    let sx = 0;
    let sy = 0;
    let c = 0;
    for (const id of w.refs || []) {
      const pt = nodeCoords.get(id);
      if (!pt) continue;
      sx += pt.lon;
      sy += pt.lat;
      c++;
    }
    if (!c) continue;
    pushRecord(w.kind, w.tags, sy / c, sx / c, w.osmId, "way");
  }

  const payload = {
    generated: new Date().toISOString(),
    source: sourceLabel,
    pbfPath,
    recordCount: records.length,
    skipped,
    records,
  };
  writeJson(outPath, payload);
  console.log(`${sourceLabel}:`, records.length, "skipped", skipped);
  return payload;
}
