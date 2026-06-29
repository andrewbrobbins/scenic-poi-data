#!/usr/bin/env node
/**
 * Full Canada park amenities pipeline.
 */
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { ingestPcArcgis } from "./build-park-amenities-ingest-pc-arcgis.mjs";
import { ingestStateArcgis } from "./build-park-amenities-ingest-state-arcgis.mjs";
import { ingestProvincialOsmPbf } from "./build-park-amenities-ingest-provincial-osm.mjs";
import { buildMaster } from "./build-park-amenities-ca-master.mjs";
import { readJson } from "./park-amenities-lib.mjs";
import { INGEST_DIR, MASTER_PATH } from "./park-amenities-ca-lib.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  await ingestPcArcgis();
  await ingestStateArcgis({ region: "ca", ingestRoot: INGEST_DIR });
  await ingestProvincialOsmPbf();
  await buildMaster();
  execSync(`node build-park-amenities-enrich-access.mjs --region=ca ${process.argv.slice(2).join(" ")}`, {
    cwd: tools,
    stdio: "inherit",
  });
  execSync("node build-park-amenities-ca-explorer-embed.mjs", { cwd: tools, stdio: "inherit" });
  execSync("node build-park-amenities-ca-rollup.mjs", { cwd: tools, stdio: "inherit" });
  execSync("node validate-park-amenities-ca.mjs", { cwd: tools, stdio: "inherit" });

  const master = readJson(MASTER_PATH, {});
  console.log("CA park amenities done.", master.recordCount, "records");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
