import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const tools = path.dirname(fileURLToPath(import.meta.url));
const refresh = process.argv.includes("--refresh");

console.log("=== Fuel CA pipeline (extract cache -> filter -> master -> embed) ===\n");
const extractCmd = refresh
  ? "node build-fuel-ca-extract-all-pbf.mjs --refresh"
  : "node build-fuel-ca-extract-all-pbf.mjs";
execSync(extractCmd, { cwd: tools, stdio: "inherit" });
execSync("node build-fuel-ca-filter-brands.mjs", { cwd: tools, stdio: "inherit" });
execSync("node build-fuel-ca-master.mjs", { cwd: tools, stdio: "inherit" });
execSync("node build-fuel-ca-explorer-embed.mjs", { cwd: tools, stdio: "inherit" });
console.log("\nDone. Tweak fuel-ca-brand-catalog.json then re-run filter only:");
console.log("  node build-fuel-ca-filter-brands.mjs && node build-fuel-ca-master.mjs && node build-fuel-ca-explorer-embed.mjs");