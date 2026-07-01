#!/usr/bin/env node
/**
 * Full US park amenities pipeline.
 *
 * Usage:
 *   node build-park-amenities-us-all.mjs
 *   node build-park-amenities-us-all.mjs --fetch-trails --state=CA,MT,WY
 */
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { ingestNpsArcgis } from "./build-park-amenities-ingest-nps-arcgis.mjs";
import { ingestStateArcgis } from "./build-park-amenities-ingest-state-arcgis.mjs";
import { ingestStateOsmPbf } from "./build-park-amenities-ingest-state-osm.mjs";
import { buildMaster } from "./build-park-amenities-us-master.mjs";
import { buildRollup } from "./build-park-amenities-rollup.mjs";
import { readJson, QA_PATH, MANIFEST_PATH, loadUsMasterRecords } from "./park-amenities-us-lib.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));
const extraArgs = process.argv.slice(2).filter((a) => a.startsWith("--"));

async function main() {
  await ingestNpsArcgis();
  await ingestStateArcgis({ region: "us" });
  await ingestStateOsmPbf();
  await buildMaster();

  const enrichArgs = ["node", "build-park-amenities-enrich-access.mjs", "--region=us", ...extraArgs].join(" ");
  execSync(enrichArgs, { cwd: tools, stdio: "inherit" });

  await buildRollup();
  execSync("node build-park-amenities-us-explorer-embed.mjs", { cwd: tools, stdio: "inherit" });
  execSync("node validate-park-amenities-us.mjs", { cwd: tools, stdio: "inherit" });

  const qa = readJson(QA_PATH, {});
  const manifest = readJson(MANIFEST_PATH, loadUsMasterRecords());
  console.log(
    "US park amenities done.",
    manifest.recordCount,
    "records | access",
    JSON.stringify(manifest.byAccessMode || qa.byAccessMode || {})
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
