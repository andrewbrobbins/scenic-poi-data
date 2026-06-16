import { ingestCampingOsm } from "./camping-ca-osm-core.mjs";

const arg = process.argv.find((a) => a.startsWith("--provinces="));
const filter = arg ? arg.split("=")[1].split(",").map((s) => s.trim().toUpperCase()) : null;
const refresh = process.argv.includes("--refresh");
await ingestCampingOsm(filter, { refresh });
