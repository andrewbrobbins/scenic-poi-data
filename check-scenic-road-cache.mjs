import { roadDistancesCachePath } from "./build-scenic-road-distances.mjs";
import { cacheStatus } from "./scenic-road-cache.mjs";
const region = process.argv.find((a) => a.startsWith("--region="))?.slice(9) || "ca";
const st = cacheStatus(region, roadDistancesCachePath(region));
console.log(JSON.stringify(st, null, 2));