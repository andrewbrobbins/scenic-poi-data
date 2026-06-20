#!/usr/bin/env node
/**
 * Full NPS visitor centers pipeline.
 *
 * Usage:
 *   node build-nps-visitor-centers-all.mjs
 *   node build-nps-visitor-centers-all.mjs --verify-osm
 *   node build-nps-visitor-centers-all.mjs --skip-api
 */
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { ingestArcgis } from "./build-nps-visitor-centers-ingest-arcgis.mjs";
import { ingestApi } from "./build-nps-visitor-centers-ingest-api.mjs";
import { buildMaster } from "./build-nps-visitor-centers-master.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));
const skipApi = process.argv.includes("--skip-api");
const verifyOsm = process.argv.includes("--verify-osm");

async function main() {
  await ingestArcgis();
  if (!skipApi) await ingestApi();
  await buildMaster({ verifyOsm });
  execSync("node build-nps-visitor-centers-explorer-embed.mjs", { cwd: tools, stdio: "inherit" });
  execSync("node build-poi-explorer-data.mjs", { cwd: tools, stdio: "inherit" });
  console.log("NPS visitor centers pipeline done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
