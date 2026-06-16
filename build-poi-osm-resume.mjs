/**
 * Resume interrupted POI OSM build using cached state files.
 */
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const tools = path.dirname(fileURLToPath(import.meta.url));

function run(cmd) {
  console.log("\n>>", cmd);
  execSync(cmd, { cwd: tools, stdio: "inherit" });
}

console.log("=== POI OSM resume ===\n");

const missingPg = "PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
const refreshPg = "ND OK HI".split(" ");

for (const st of missingPg) {
  run(`node build-poi-osm-ingest-us.mjs --kind=playground --state=${st}`);
}
for (const st of refreshPg) {
  run(`node build-poi-osm-ingest-us.mjs --kind=playground --state=${st} --refresh`);
}

run("node build-poi-osm-ingest-us.mjs --kind=viewpoint");
run("node build-poi-osm-ingest-ca.mjs");
run("node build-poi-osm-master.mjs");
run("node build-poi-osm-explorer-embed.mjs");

console.log("\nDone.");
