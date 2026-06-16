/**
 * Install bundled osmium-tool via micromamba (conda-forge).
 * Usage: node build-scenic-install-osmium.mjs
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isOsmiumAvailable, osmiumExePath } from "./scenic-osmium-lib.mjs";
import { log } from "./pipeline-log.mjs";

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const VENDOR = path.join(TOOLS_DIR, "vendor", "micromamba");
const MM = path.join(VENDOR, "micromamba.exe");
const ROOT = path.join(VENDOR, "root");

if (isOsmiumAvailable()) {
  log(`osmium already available: ${osmiumExePath()}`);
  process.exit(0);
}

const url = "https://github.com/mamba-org/micromamba-releases/releases/latest/download/micromamba-win-64";
fs.mkdirSync(VENDOR, { recursive: true });
if (!fs.existsSync(MM)) {
  log("downloading micromamba...");
  execSync(
    `powershell -NoProfile -Command "Invoke-WebRequest -Uri '${url}' -OutFile '${MM}' -UseBasicParsing"`,
    { stdio: "inherit" }
  );
}

log("installing osmium-tool (conda-forge)...");
execSync(`"${MM}" create -y -r "${ROOT}" -n osmium -c conda-forge osmium-tool`, { stdio: "inherit" });
log(`osmium installed: ${osmiumExePath()}`);