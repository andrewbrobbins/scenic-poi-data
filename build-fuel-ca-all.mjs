import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const tools = path.dirname(fileURLToPath(import.meta.url));
const refresh = process.argv.includes("--refresh");

console.log("=== Fuel CA pipeline (ensure cache -> filter -> master -> embed) ===\n");
const ensureCmd = refresh
  ? "node ensure-fuel-cache.mjs --region=ca --force-extract"
  : "node ensure-fuel-cache.mjs --region=ca";
execSync(ensureCmd, { cwd: tools, stdio: "inherit" });
execSync("node build-fuel-ca-filter-brands.mjs", { cwd: tools, stdio: "inherit" });
execSync("node build-fuel-official-reconcile.mjs --region=ca", { cwd: tools, stdio: "inherit" });
execSync("node build-fuel-ca-master.mjs", { cwd: tools, stdio: "inherit" });
execSync("node build-fuel-ca-explorer-embed.mjs", { cwd: tools, stdio: "inherit" });
execSync("node build-fuel-explorer-data.mjs", { cwd: tools, stdio: "inherit" });
console.log("\nDone. Open fuel-explorer.html in a browser to evaluate filtering.");
console.log("Tweak fuel-ca-brand-catalog.json then re-run filter only:");
console.log(
  "  node build-fuel-ca-filter-brands.mjs && node build-fuel-ca-master.mjs && node build-fuel-explorer-data.mjs"
);
