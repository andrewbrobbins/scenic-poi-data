#!/usr/bin/env node
/**
 * Build park amenities for US + Canada.
 *
 * Usage:
 *   node build-park-amenities-all.mjs
 *   node build-park-amenities-all.mjs --fetch-trails --state=CA,MT,WY,CO
 */
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const tools = path.dirname(fileURLToPath(import.meta.url));
const extra = process.argv.slice(2);

execSync(`node build-park-amenities-us-all.mjs ${extra.join(" ")}`, { cwd: tools, stdio: "inherit" });
execSync("node build-park-amenities-ca-all.mjs", { cwd: tools, stdio: "inherit" });
execSync("node build-poi-explorer-data.mjs", { cwd: tools, stdio: "inherit" });

console.log("Park amenities (US + CA) complete.");
