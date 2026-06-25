/**
 * SP-001 source research orchestrator.
 *
 *   node build-state-parks-research-all.mjs           # hub search all + apply overrides
 *   node build-state-parks-research-all.mjs --discover # also probe seed URLs
 */
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { log, logSection } from "./pipeline-log.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

function run(script, extra = []) {
  log(`Running ${script}...`);
  const r = spawnSync(process.execPath, [path.join(tools, script), ...args, ...extra], {
    stdio: "inherit",
    cwd: tools,
  });
  if (r.status !== 0) process.exit(r.status || 1);
}

logSection("State parks source research");
if (args.includes("--discover")) run("build-state-parks-discover-sources.mjs");
run("build-state-parks-search-arcgis-hub.mjs");
run("build-state-parks-apply-matrix-overrides.mjs");
logSection("Research complete — review state-parks-source-matrix.json");
