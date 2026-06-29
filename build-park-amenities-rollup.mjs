import { MASTER_PATH, ROLLUP_PATH } from "./park-amenities-us-lib.mjs";
import { writeRollup } from "./build-park-amenities-rollup-lib.mjs";

export async function buildRollup() {
  return writeRollup(MASTER_PATH, ROLLUP_PATH);
}

if (process.argv[1]?.endsWith("build-park-amenities-rollup.mjs")) {
  await buildRollup();
}
