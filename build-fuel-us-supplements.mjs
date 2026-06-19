/**
 * @deprecated Use build-fuel-official-reconcile.mjs --region=us
 */
import { reconcileOfficialRegion } from "./build-fuel-official-reconcile.mjs";

if (process.argv[1]?.endsWith("build-fuel-us-supplements.mjs")) {
  reconcileOfficialRegion("us").catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
