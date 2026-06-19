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
const ROOT = path.join(VENDOR, "root");

function platformMicromamba() {
  if (process.platform === "win32") {
    return {
      url: "https://github.com/mamba-org/micromamba-releases/releases/latest/download/micromamba-win-64",
      bin: path.join(VENDOR, "micromamba.exe"),
      shell: true,
    };
  }
  if (process.platform === "linux") {
    return {
      url: "https://github.com/mamba-org/micromamba-releases/releases/latest/download/micromamba-linux-64",
      bin: path.join(VENDOR, "micromamba"),
      shell: false,
    };
  }
  if (process.platform === "darwin") {
    return {
      url: "https://github.com/mamba-org/micromamba-releases/releases/latest/download/micromamba-osx-64",
      bin: path.join(VENDOR, "micromamba"),
      shell: false,
    };
  }
  throw new Error(`Unsupported platform for bundled osmium: ${process.platform}`);
}

async function downloadFile(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  log(`downloading micromamba from ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed HTTP ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  if (process.platform !== "win32") fs.chmodSync(dest, 0o755);
}

if (isOsmiumAvailable()) {
  log(`osmium already available: ${osmiumExePath()}`);
  process.exit(0);
}

const { url, bin, shell } = platformMicromamba();
fs.mkdirSync(VENDOR, { recursive: true });
if (!fs.existsSync(bin)) {
  await downloadFile(url, bin);
}

log("installing osmium-tool (conda-forge)...");
const cmd = `"${bin}" create -y -r "${ROOT}" -p "${path.join(ROOT, "envs", "osmium")}" -c conda-forge osmium-tool`;
execSync(cmd, { stdio: "inherit", shell });

if (!isOsmiumAvailable()) {
  throw new Error(`osmium install finished but binary not found — expected under ${ROOT}`);
}
log(`osmium installed: ${osmiumExePath()}`);
