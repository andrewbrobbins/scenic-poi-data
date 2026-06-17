import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const tools = path.dirname(fileURLToPath(import.meta.url));
const refresh = process.argv.includes("--refresh");
const proof = process.argv.includes("--proof");

console.log("=== Fuel US pipeline (ensure cache -> filter -> master -> embed) ===\n");
const ensureParts = ["node ensure-fuel-cache.mjs --region=us"];
if (refresh) ensureParts.push("--force-extract");
if (proof) ensureParts.push("--proof");
execSync(ensureParts.join(" "), { cwd: tools, stdio: "inherit" });
execSync("node build-fuel-us-filter-brands.mjs", { cwd: tools, stdio: "inherit" });
execSync("node build-fuel-us-master.mjs", { cwd: tools, stdio: "inherit" });
execSync("node build-fuel-us-explorer-embed.mjs", { cwd: tools, stdio: "inherit" });
execSync("node build-fuel-explorer-data.mjs", { cwd: tools, stdio: "inherit" });
console.log("\nDone. Open fuel-explorer.html in a browser to evaluate filtering.");
console.log("Tweak fuel-us-brand-catalog.json then re-run filter only:");
console.log(
  "  node build-fuel-us-filter-brands.mjs && node build-fuel-us-master.mjs && node build-fuel-explorer-data.mjs"
);
