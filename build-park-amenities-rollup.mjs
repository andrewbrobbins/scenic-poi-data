import { loadUsMasterRecords, ROLLUP_PATH } from "./park-amenities-us-lib.mjs";
import { writeRollupFromRecords } from "./build-park-amenities-rollup-lib.mjs";

export async function buildRollup() {
  const { records } = loadUsMasterRecords();
  return writeRollupFromRecords(records, ROLLUP_PATH);
}

if (process.argv[1]?.endsWith("build-park-amenities-rollup.mjs")) {
  await buildRollup();
}
