import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const tools = path.dirname(fileURLToPath(import.meta.url));

console.log("=== Camping CA pipeline ===\n");
execSync("node build-camping-ca-ingest-pc.mjs", { cwd: tools, stdio: "inherit" });
execSync("node build-camping-ca-ingest-provincial-seed.mjs", { cwd: tools, stdio: "inherit" });
execSync("node build-camping-ca-osm-ingest.mjs", { cwd: tools, stdio: "inherit" });
execSync("node build-camping-ca-master.mjs", { cwd: tools, stdio: "inherit" });
execSync("node build-camping-ca-explorer-embed.mjs", { cwd: tools, stdio: "inherit" });
console.log("\nDone.");
