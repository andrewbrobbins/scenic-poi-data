/**
 * Orchestrator: local PBF extract for US + CA state/provincial parks.
 *
 * Usage:
 *   node build-state-parks-cache.mjs
 *   node build-state-parks-cache.mjs --refresh
 *   node build-state-parks-cache.mjs --region=us
 */
import { buildStateParksCache } from "./build-state-parks-cache-core.mjs";
import { log, logSection } from "./pipeline-log.mjs";

const args = process.argv.slice(2);
const refresh = args.includes("--refresh") || args.includes("--force");
const regionArg = args.find((a) => a.startsWith("--region="));
const region = regionArg ? regionArg.split("=")[1] : "all";

logSection("State parks cache (local PBF)");
log(`Region: ${region}, refresh: ${refresh}`);
const stats = await buildStateParksCache({ refresh, region });
for (const [key, payload] of Object.entries(stats)) {
  log(`${key}: ${payload.recordCount} records`);
}
log("Cache step complete");
