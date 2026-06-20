#!/usr/bin/env node
/**
 * Full NPS visitor centers pipeline.
 *
 * Usage:
 *   node build-nps-visitor-centers-all.mjs
 *   node build-nps-visitor-centers-all.mjs --verify-osm [--refresh-osm]
 *   node build-nps-visitor-centers-all.mjs --skip-api
 *   node build-nps-visitor-centers-all.mjs --require-api
 */
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { ingestArcgis } from "./build-nps-visitor-centers-ingest-arcgis.mjs";
import { ingestApi } from "./build-nps-visitor-centers-ingest-api.mjs";
import { buildMaster } from "./build-nps-visitor-centers-master.mjs";
import { hasNpsApiKey, readJson, QA_PATH } from "./nps-visitor-centers-lib.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));
const skipApi = process.argv.includes("--skip-api");
const requireApi = process.argv.includes("--require-api");
const verifyOsm = process.argv.includes("--verify-osm");
const refreshOsm = process.argv.includes("--refresh-osm");

async function main() {
  if (requireApi && !hasNpsApiKey()) {
    console.error("NPS_API_KEY is required but not set. Copy .env.example to .env and add your key.");
    console.error("Get a key: https://www.nps.gov/subjects/developer/get-started.htm");
    process.exit(1);
  }

  await ingestArcgis();

  let apiResult = { skipped: true, recordCount: 0 };
  if (!skipApi) {
    apiResult = await ingestApi();
    if (requireApi && (apiResult.skipped || !apiResult.recordCount)) {
      console.error("API ingest did not produce records — check NPS_API_KEY and rate limits.");
      process.exit(1);
    }
  } else if (requireApi) {
    console.error("--require-api conflicts with --skip-api");
    process.exit(1);
  }

  await buildMaster({ verifyOsm, refreshOsm });
  execSync("node build-nps-visitor-centers-explorer-embed.mjs", { cwd: tools, stdio: "inherit" });
  execSync("node build-poi-explorer-data.mjs", { cwd: tools, stdio: "inherit" });

  const qa = readJson(QA_PATH, {});
  console.log(
    "NPS visitor centers pipeline done.",
    `| withHours ${qa.withHours ?? 0}/${qa.totalRecords ?? "?"}`
  );

  if (requireApi || (!skipApi && !apiResult.skipped && apiResult.recordCount > 0)) {
    execSync("node validate-nps-visitor-centers.mjs --expect-api", { cwd: tools, stdio: "inherit" });
  } else if (!hasNpsApiKey()) {
    console.warn("Skipped API ingest — set NPS_API_KEY in .env and rerun without --skip-api (VC-001).");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
