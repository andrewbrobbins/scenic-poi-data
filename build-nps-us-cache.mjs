import { buildNpsCache } from "./build-nps-us-cache-core.mjs";
const refresh = process.argv.includes("--refresh-network");
await buildNpsCache(refresh);
