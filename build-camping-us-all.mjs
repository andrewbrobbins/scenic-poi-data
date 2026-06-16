#!/usr/bin/env node
import { ingestNps } from "./build-camping-us-ingest-nps.mjs";
import { ingestUsfs } from "./build-camping-us-ingest-usfs.mjs";
import { ingestOsm } from "./build-camping-us-ingest-osm.mjs";
import { ingestRidb } from "./build-camping-us-ingest-ridb.mjs";
import { buildMaster } from "./build-camping-us-master.mjs";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const skipOsm = process.argv.includes("--skip-osm");
const osmOnly = process.argv.includes("--osm-only");
const stateArg = process.argv.find((a) => a.startsWith("--state="));
const states = stateArg ? [stateArg.split("=")[1].toUpperCase()] : null;
const tools = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  if (!osmOnly) {
    await ingestNps();
    await ingestUsfs();
    await ingestRidb();
  }
  if (!skipOsm || osmOnly) await ingestOsm(states);
  await buildMaster();
  const enrichArgs = process.argv.includes("--fetch-roads") ? " --fetch-roads" : "";
  const skipRoads = process.argv.includes("--skip-roads") ? " --skip-roads" : "";
  execSync(`node build-camping-us-enrich.mjs${enrichArgs}${skipRoads}`, { cwd: tools, stdio: "inherit" });
  execSync("node build-camping-us-embed.mjs", { cwd: tools, stdio: "inherit" });
  execSync("node build-camping-us-viewer-data.mjs", { cwd: tools, stdio: "inherit" });
  execSync("node build-camping-us-explorer-embed.mjs", { cwd: tools, stdio: "inherit" });
  execSync("node build-camping-us-review-geojson.mjs", { cwd: tools, stdio: "inherit" });
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
