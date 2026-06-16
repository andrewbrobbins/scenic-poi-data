/**
 * Stream-parse Geofabrik PBF and extract POI records (no Overpass / no osmium required).
 */
import { createReadStream } from "fs";
import { pipeline } from "stream/promises";
import { Writable } from "stream";
import {
  POI_KINDS,
  buildPoiRecord,
  coordValidCa,
  coordValidUs,
  inferRegionCode,
} from "./poi-osm-lib.mjs";
import { PBF_TAG_MATCHERS } from "./poi-osm-pbf-config.mjs";

function tagMatcher(kind) {
  return PBF_TAG_MATCHERS[kind] || (() => false);
}

function coordValidForRegion(regionLabel) {
  return regionLabel === "CA" ? coordValidCa : coordValidUs;
}

async function loadParser() {
  const mod = await import("osm-pbf-parser");
  return mod.default || mod;
}

function wayCentroid(refs, nodeCoords) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const id of refs || []) {
    const c = nodeCoords.get(id);
    if (!c) continue;
    sx += c.lon;
    sy += c.lat;
    n += 1;
  }
  if (!n) return null;
  return { lat: sy / n, lon: sx / n };
}

/**
 * @param {string} pbfPath
 * @param {object} opts
 * @param {string} opts.kind
 * @param {string} opts.regionLabel - US or CA
 * @param {string} [opts.stateFilter] - e.g. TX for proof runs
 */
export async function parsePbfToRecords(pbfPath, opts) {
  const kind = opts.kind;
  const kindCfg = POI_KINDS[kind];
  if (!kindCfg) throw new Error("Unknown kind: " + kind);
  const regionLabel = opts.regionLabel || "US";
  const coordValid = coordValidForRegion(regionLabel);
  const matches = tagMatcher(kind);
  const parser = await loadParser();

  const matchingNodes = [];
  const matchingWays = [];
  const neededNodeIds = new Set();

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
              if (matches(tags)) {
                matchingNodes.push({
                  osmType: "node",
                  osmId: item.id,
                  lat: item.lat,
                  lon: item.lon,
                  tags,
                });
              }
            } else if (item.type === "way") {
              const tags = item.tags || {};
              if (matches(tags)) {
                matchingWays.push({
                  osmType: "way",
                  osmId: item.id,
                  tags,
                  refs: item.refs || [],
                });
                for (const id of item.refs || []) neededNodeIds.add(id);
              }
            }
          }
          cb();
        } catch (err) {
          cb(err);
        }
      },
    })
  );

  const nodeCoords = new Map();
  for (const n of matchingNodes) {
    nodeCoords.set(n.osmId, { lat: n.lat, lon: n.lon });
  }

  if (neededNodeIds.size) {
    const need = neededNodeIds;
    await pipeline(
      createReadStream(pbfPath),
      parser(),
      new Writable({
        objectMode: true,
        write(chunks, _enc, cb) {
          try {
            for (const item of chunks) {
              if (item.type === "node" && need.has(item.id) && !nodeCoords.has(item.id)) {
                nodeCoords.set(item.id, { lat: item.lat, lon: item.lon });
              }
            }
            cb();
          } catch (err) {
            cb(err);
          }
        },
      })
    );
  }

  const seen = new Set();
  const records = [];

  function pushRecord(osmType, osmId, lat, lon, tags) {
    if (!coordValid(lat, lon)) return;
    const key = `${osmType}:${osmId}`;
    if (seen.has(key)) return;
    seen.add(key);
    const regionCode = inferRegionCode(lat, lon, regionLabel);
    if (opts.stateFilter && regionCode !== opts.stateFilter) return;
    records.push(
      buildPoiRecord({
        kind,
        kindCfg,
        regionLabel,
        osmType,
        osmId,
        lat,
        lon,
        tags,
        regionCode,
      })
    );
  }

  for (const n of matchingNodes) {
    pushRecord(n.osmType, n.osmId, n.lat, n.lon, n.tags);
  }

  for (const w of matchingWays) {
    const c = wayCentroid(w.refs, nodeCoords);
    if (!c) continue;
    pushRecord(w.osmType, w.osmId, c.lat, c.lon, w.tags);
  }

  return {
    kind,
    regionLabel,
    nodeCount: matchingNodes.length,
    wayCount: matchingWays.length,
    recordCount: records.length,
    records,
  };
}
