/**
 * Full scenic road-access pipeline: highways extract -> distance cache -> filter -> master -> embed.
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ingestDir, readJson, writeJson } from "./poi-osm-lib.mjs";
import { formatDuration, log, logSection } from "./pipeline-log.mjs";
import { isOsmiumAvailable } from "./scenic-osmium-lib.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const out = { regions: ["us", "ca"], refresh: false, maxM: 120 };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--refresh") out.refresh = true;
    else if (arg.startsWith("--region=")) out.regions = [arg.slice(9)];
    else if (arg === "--max-m" && argv[i + 1] != null) {
      const n = Number(argv[++i]);
      if (Number.isFinite(n)) out.maxM = n;
    } else if (arg.startsWith("--max-m=")) {
      const n = Number(arg.slice(7));
      if (Number.isFinite(n)) out.maxM = n;
    }
  }
  return out;
}

function run(cmd, label) {
  const t0 = Date.now();
  logSection(label || cmd);
  log(`>> ${cmd}`);
  execSync(cmd, { cwd: tools, stdio: "inherit" });
  log(`<< finished in ${formatDuration(Date.now() - t0)}`);
}

function ensureUnfilteredBackup(region) {
  const dir = ingestDir(region, "viewpoint");
  const unfiltered = path.join(dir, "merged-unfiltered.json");
  const merged = path.join(dir, "merged.json");
  if (!fs.existsSync(unfiltered) && fs.existsSync(merged)) {
    writeJson(unfiltered, readJson(merged));
    log(`backed up scenic-${region} -> merged-unfiltered.json`);
  }
}

const args = parseArgs();
const refreshFlag = args.refresh ? "--refresh" : "";
const pipelineT0 = Date.now();

logSection("scenic road-access pipeline");
log(`regions=${args.regions.join(",")} max-m=${args.maxM}${args.refresh ? " refresh" : ""} osmium=${isOsmiumAvailable()}`);

for (const region of args.regions) {
  ensureUnfilteredBackup(region);
    if (isOsmiumAvailable()) {
    run(
      `node build-scenic-highways-extract.mjs --source=${region} ${refreshFlag}`.trim(),
      `step 1/5: highways extract (${region})`
    );
    run(
      `node build-scenic-paths-parking-extract.mjs --source=${region} ${refreshFlag}`.trim(),
      `step 2/5: paths/parking extract (${region})`
    );
  }
  run(
    `node build-scenic-road-distances.mjs --region=${region} --source=${region} ${refreshFlag}`.trim(),
    `step ${isOsmiumAvailable() ? "3/5" : "1/3"}: road distances (${region})`
  );
  run(
    `node build-scenic-filter-road-access.mjs --region=${region} --max-m=${args.maxM}`,
    `step ${isOsmiumAvailable() ? "4/5" : "2/3"}: road-access filter (${region})`
  );
}

const regionFlag = args.regions.length === 2 ? "" : `--region=${args.regions[0]}`;
run(
  `node build-poi-osm-master.mjs ${regionFlag} --kind=viewpoint`.trim(),
  `step ${isOsmiumAvailable() ? "5/5" : "3/3"}: master (viewpoint)`
);
run(`node build-poi-osm-explorer-embed.mjs ${regionFlag} --kind=viewpoint`.trim(), "embed scenic explorer data");

logSection("pipeline complete");
log(`total elapsed ${formatDuration(Date.now() - pipelineT0)}`);
log("retune threshold: node build-scenic-filter-road-access.mjs --max-m=150");