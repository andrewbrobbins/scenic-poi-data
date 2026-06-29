import { MASTER_PATH, ROLLUP_PATH } from "./park-amenities-ca-lib.mjs";
import { writeRollup } from "./build-park-amenities-rollup-lib.mjs";

await writeRollup(MASTER_PATH, ROLLUP_PATH);
