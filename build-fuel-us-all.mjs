import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const tools = path.dirname(fileURLToPath(import.meta.url));
const refresh = process.argv.includes("--refresh");

console.log("=== Fuel US pipeline (extract cache -> filter -> master -> embed) ===\n");
const extractCmd = refresh
  ? "node build-fuel-us-extract-all-pbf.mjs --refresh"
  : "node build-fuel-us-extract-all-pbf.mjs";
execSync(extractCmd, { cwd: tools, stdio: "inherit" });
execSync("node build-fuel-us-filter-brands.mjs", { cwd: tools, stdio: "inherit" });
execSync("node build-fuel-us-master.mjs", { cwd: tools, stdio: "inherit" });
execSync("node build-fuel-us-explorer-embed.mjs", { cwd: tools, stdio: "inherit" });
console.log("\nDone. Tweak fuel-us-brand-catalog.json then re-run filter only:");
console.log("  node build-fuel-us-filter-brands.mjs && node build-fuel-us-master.mjs && node build-fuel-us-explorer-embed.mjs");
