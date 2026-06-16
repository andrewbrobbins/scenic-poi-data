import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const tools = path.dirname(fileURLToPath(import.meta.url));

console.log("=== Fuel US pipeline (8 brands, local PBF) ===\n");
execSync("node build-fuel-us-ingest-pbf.mjs", { cwd: tools, stdio: "inherit" });
execSync("node build-fuel-us-master.mjs", { cwd: tools, stdio: "inherit" });
execSync("node build-fuel-us-explorer-embed.mjs", { cwd: tools, stdio: "inherit" });
console.log("\nDone.");
