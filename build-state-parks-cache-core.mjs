/**
 * Build state-parks PBF extract cache from local Geofabrik files (US + CA).
 */
import { extractAllStateParks } from "./build-state-parks-extract-pbf.mjs";

export async function buildStateParksCache(opts = {}) {
  const refresh = !!opts.refresh;
  const region = opts.region || "all";
  const source = region === "ca" ? "ca" : region === "us" ? "us" : "all";
  return extractAllStateParks({ force: refresh, source });
}
