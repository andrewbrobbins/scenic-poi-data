#!/usr/bin/env node
/**
 * Build Parks Canada unit catalog (PC-001).
 *
 * Usage:
 *   node build-parks-canada-cache.mjs
 *   node build-parks-canada-cache.mjs --refresh
 */
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { buildParksCanadaCache } from "./build-parks-canada-cache-core.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));
const refresh = process.argv.includes("--refresh") || process.argv.includes("--force");

await buildParksCanadaCache(refresh);
execSync("node build-poi-explorer-data.mjs", { cwd: tools, stdio: "inherit" });
console.log("Parks Canada catalog done — open poi-explorer.html (Canada or Both region)");
