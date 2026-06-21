#!/usr/bin/env node
/**
 * Full Parks Canada visitor centers pipeline (VC-CA-001).
 *
 * Usage:
 *   node build-parks-canada-visitor-centers-all.mjs
 *   node build-parks-canada-visitor-centers-all.mjs --verify-osm [--refresh-osm]
 */
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { ingestArcgis } from "./build-parks-canada-visitor-centers-ingest-arcgis.mjs";
import { buildMaster } from "./build-parks-canada-visitor-centers-master.mjs";
import { GEO_PATH, readJson } from "./parks-canada-lib.mjs";
import { QA_PATH } from "./parks-canada-visitor-centers-lib.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));
const verifyOsm = process.argv.includes("--verify-osm");
const refreshOsm = process.argv.includes("--refresh-osm");

async function main() {
  const pcGeo = readJson(GEO_PATH, { units: [] });
  if (!pcGeo.units?.length) {
    console.error("Missing parks-canada-geo.json — run node build-parks-canada-cache.mjs first (PC-001).");
    process.exit(1);
  }

  await ingestArcgis();
  await buildMaster({ verifyOsm, refreshOsm });
  execSync("node build-parks-canada-visitor-centers-explorer-embed.mjs", { cwd: tools, stdio: "inherit" });
  execSync("node build-poi-explorer-data.mjs", { cwd: tools, stdio: "inherit" });
  execSync("node validate-parks-canada-visitor-centers.mjs", { cwd: tools, stdio: "inherit" });

  const qa = readJson(QA_PATH, {});
  console.log(
    "Parks Canada visitor centers pipeline done.",
    `| records ${qa.totalRecords ?? "?"} | withHours ${qa.withHours ?? 0}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
