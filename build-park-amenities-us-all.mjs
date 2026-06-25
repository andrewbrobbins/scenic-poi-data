#!/usr/bin/env node
/**
 * Full NPS park amenities pipeline (Phase 1: ArcGIS ingest).
 *
 * Usage:
 *   node build-park-amenities-us-all.mjs
 */
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { ingestNpsArcgis } from "./build-park-amenities-ingest-nps-arcgis.mjs";
import { buildMaster } from "./build-park-amenities-us-master.mjs";
import { buildRollup } from "./build-park-amenities-rollup.mjs";
import { readJson, QA_PATH } from "./park-amenities-us-lib.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  await ingestNpsArcgis();
  await buildMaster();
  await buildRollup();
  execSync("node build-park-amenities-us-explorer-embed.mjs", { cwd: tools, stdio: "inherit" });
  execSync("node validate-park-amenities-us.mjs", { cwd: tools, stdio: "inherit" });

  const qa = readJson(QA_PATH, {});
  console.log(
    "Park amenities pipeline done.",
    "| records",
    qa.totalRecords,
    "| camp tiers",
    JSON.stringify(qa.byCampTier || {})
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
