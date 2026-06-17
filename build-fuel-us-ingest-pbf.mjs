/**
 * @deprecated Use build-fuel-us-extract-all-pbf.mjs + build-fuel-us-filter-brands.mjs
 * Kept for compatibility — runs the fast filter step against the cached extract.
 */
import { filterFuelUsBrands } from "./build-fuel-us-filter-brands.mjs";

if (process.argv[1]?.endsWith("build-fuel-us-ingest-pbf.mjs")) {
  filterFuelUsBrands();
}
