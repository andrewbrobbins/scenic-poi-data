/**
 * Geofabrik PBF sources and per-kind OSM tag filters.
 * Bulk files live under tools/osm-pbf/ (gitignored).
 */
import path from "path";
import { TOOLS_DIR, shouldIncludeHistoric } from "./poi-osm-lib.mjs";

export const PBF_DIR = path.join(TOOLS_DIR, "osm-pbf");
export const GEOFABRIK_DIR = path.join(PBF_DIR, "geofabrik");
export const EXTRACTED_DIR = path.join(PBF_DIR, "extracted");

/** Geofabrik north-america extracts. */
export const PBF_SOURCES = {
  us: {
    region: "us",
    label: "United States",
    filename: "us-latest.osm.pbf",
    url: "https://download.geofabrik.de/north-america/us-latest.osm.pbf",
    coordValid: "us",
  },
  ca: {
    region: "ca",
    label: "Canada",
    filename: "canada-latest.osm.pbf",
    url: "https://download.geofabrik.de/north-america/canada-latest.osm.pbf",
    coordValid: "ca",
  },
  tx: {
    region: "us",
    label: "Texas (proof)",
    filename: "texas-latest.osm.pbf",
    url: "https://download.geofabrik.de/north-america/us/texas-latest.osm.pbf",
    coordValid: "us",
    proofOnly: true,
    stateFilter: "TX",
  },
};

/** osmium tags-filter expressions (used when osmium-tool is on PATH). */
export const OSMIUM_TAG_FILTERS = {
  playground: ["nwr/leisure=playground"],
  viewpoint: ["nwr/tourism=viewpoint"],
  historic: ["nwr/historic"],
};

/** Node/way tag match for streaming PBF parser (no osmium). */
export const PBF_TAG_MATCHERS = {
  playground(tags) {
    return tags.leisure === "playground";
  },
  viewpoint(tags) {
    return tags.tourism === "viewpoint";
  },
  historic(tags) {
    return shouldIncludeHistoric(tags);
  },
};

export function extractedGeojsonPath(sourceKey, kind) {
  return path.join(EXTRACTED_DIR, `${kind}-${sourceKey}.geojsonseq`);
}

export function extractedJsonlPath(sourceKey, kind) {
  return path.join(EXTRACTED_DIR, `${kind}-${sourceKey}.jsonl`);
}

export function pbfFilePath(sourceKey) {
  const src = PBF_SOURCES[sourceKey];
  if (!src) throw new Error("Unknown PBF source: " + sourceKey);
  return path.join(GEOFABRIK_DIR, src.filename);
}
