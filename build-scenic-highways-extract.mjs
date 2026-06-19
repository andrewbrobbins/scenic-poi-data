/**
 * Build highways-only PBF extract for scenic road-distance pipeline.
 * Usage: node build-scenic-highways-extract.mjs [--source=ca|us|tx] [--refresh]
 */
import { buildHighwaysExtract, requireOsmium } from "./scenic-osmium-lib.mjs";
import { logSection } from "./pipeline-log.mjs";

function parseArgs() {
  const out = { sourceKey: "ca", refresh: false };
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--source=")) out.sourceKey = arg.slice(9);
    else if (arg === "--refresh") out.refresh = true;
  }
  return out;
}

const args = parseArgs();
requireOsmium();
logSection(`highways extract (${args.sourceKey})`);
buildHighwaysExtract(args.sourceKey, { refresh: args.refresh });