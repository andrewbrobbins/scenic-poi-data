/**
 * @deprecated Use build-fuel-ca-extract-all-pbf.mjs + build-fuel-ca-filter-brands.mjs
 * Kept for compatibility — runs the fast filter step against the cached extract.
 */
import { filterFuelCaBrands } from "./build-fuel-ca-filter-brands.mjs";

if (process.argv[1]?.endsWith("build-fuel-ca-ingest-pbf.mjs")) {
  filterFuelCaBrands();
}