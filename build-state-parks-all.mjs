/**
 * Full state/provincial parks pipeline.
 *
 * Usage:
 *   node build-state-parks-all.mjs
 *   node build-state-parks-all.mjs --refresh
 *   node build-state-parks-all.mjs --region=us
 */
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { log, logSection } from "./pipeline-log.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));
const nodeArgs = process.argv.slice(2);

const STEPS = [
  { script: "build-state-parks-cache.mjs", label: "PBF extract" },
  { script: "build-state-parks-master.mjs", label: "Master merge" },
  { script: "build-state-parks-explorer-embed.mjs", label: "Explorer embed" },
  { script: "validate-state-parks.mjs", label: "Validation" },
];

function run(step, index) {
  logSection(`Step ${index + 1}/${STEPS.length}: ${step.label}`);
  log(`Running ${step.script}...`);
  const r = spawnSync(process.execPath, [path.join(tools, step.script), ...nodeArgs], {
    stdio: "inherit",
    cwd: tools,
  });
  if (r.status !== 0) {
    log(`${step.script} failed (exit ${r.status})`, { level: "error" });
    process.exit(r.status || 1);
  }
  log(`${step.label} complete`);
}

logSection("State parks pipeline");
log(`Args: ${nodeArgs.join(" ") || "(none)"}`);
for (let i = 0; i < STEPS.length; i += 1) {
  run(STEPS[i], i);
}
logSection("State parks pipeline finished");
