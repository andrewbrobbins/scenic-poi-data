/**
 * Provincial park amenities from local Canada OSM PBF.
 */
import path from "path";
import { pbfFilePath } from "./poi-osm-pbf-config.mjs";
import { coordValid } from "./camping-ca-lib.mjs";
import { inferStateFromCoords } from "./camping-ca-geo-utils.mjs";
import { ensureIngestDir } from "./park-amenities-ca-lib.mjs";
import {
  isProvincialParkOsm,
  scanParkAmenitiesOsmPbf,
} from "./park-amenities-osm-pbf-lib.mjs";

export async function ingestProvincialOsmPbf() {
  const outDir = ensureIngestDir("03-provincial-osm");
  return scanParkAmenitiesOsmPbf({
    pbfPath: pbfFilePath("ca"),
    country: "CA",
    outPath: path.join(outDir, "amenities.json"),
    coordValid,
    inferRegion: inferStateFromCoords,
    isParkOsm: isProvincialParkOsm,
    landManager: "Provincial",
    idPrefix: "SP-OSM-CA",
    sourceLabel: "03-provincial-osm",
  });
}

if (process.argv[1]?.endsWith("build-park-amenities-ingest-provincial-osm.mjs")) {
  await ingestProvincialOsmPbf();
}
