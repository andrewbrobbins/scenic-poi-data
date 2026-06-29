/**
 * US state park amenities from local OSM PBF (camp, picnic, restroom).
 */
import path from "path";
import { pbfFilePath } from "./poi-osm-pbf-config.mjs";
import { coordValid, ensureIngestDir } from "./park-amenities-us-lib.mjs";
import { inferStateFromCoords } from "./camping-us-geo-utils.mjs";
import { isStateParkOsm, scanParkAmenitiesOsmPbf } from "./park-amenities-osm-pbf-lib.mjs";

export async function ingestStateOsmPbf() {
  const outDir = ensureIngestDir("03-state-osm");
  return scanParkAmenitiesOsmPbf({
    pbfPath: pbfFilePath("us"),
    country: "US",
    outPath: path.join(outDir, "amenities.json"),
    coordValid,
    inferRegion: inferStateFromCoords,
    isParkOsm: isStateParkOsm,
    landManager: "State",
    idPrefix: "SP-OSM",
    sourceLabel: "03-state-osm",
  });
}

if (process.argv[1]?.endsWith("build-park-amenities-ingest-state-osm.mjs")) {
  await ingestStateOsmPbf();
}
