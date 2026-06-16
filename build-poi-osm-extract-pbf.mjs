/**
 * Extract POI layers from PBF via osmium (if installed) or Node stream parser.
 * Usage:
 *   node build-poi-osm-extract-pbf.mjs [--source=us|ca|tx] [--kind=playground|viewpoint|historic]
 */
import fs from "fs";
import path from "path";
import { PBF_SOURCES, extractedGeojsonPath, pbfFilePath } from "./poi-osm-pbf-config.mjs";
import {
  ensureDir,
  findOsmiumCommand,
  runOsmiumExtract,
  writeExtractJsonl,
} from "./poi-osm-pbf-lib.mjs";
import { POI_KINDS } from "./poi-osm-lib.mjs";
import { parsePbfToRecords } from "./poi-osm-pbf-parse.mjs";

function parseArgs() {
  const out = { sources: ["us", "ca"], kinds: Object.keys(POI_KINDS), force: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--force") out.force = true;
    else if (arg === "--proof") out.sources = ["tx"];
    else if (arg.startsWith("--source=")) out.sources = [arg.slice(9)];
    else if (arg.startsWith("--kind=")) out.kinds = [arg.slice(7)];
  }
  return out;
}

const args = parseArgs();
const osmium = findOsmiumCommand();
if (osmium) console.log("Using osmium:", osmium);
else console.log("osmium not found — using Node PBF parser (npm install in tools/ first)");

for (const sourceKey of args.sources) {
  const src = PBF_SOURCES[sourceKey];
  const pbf = pbfFilePath(sourceKey);
  if (!fs.existsSync(pbf)) {
    console.error(`Missing ${pbf} — run: node build-poi-osm-download.mjs --source=${sourceKey}`);
    process.exit(1);
  }

  const regionLabel = src.region === "ca" ? "CA" : "US";

  for (const kind of args.kinds) {
    const geoPath = extractedGeojsonPath(sourceKey, kind);
    const jsonlPath = geoPath.replace(/\.geojsonseq$/, ".jsonl");

    if (!args.force && (fs.existsSync(geoPath) || fs.existsSync(jsonlPath))) {
      console.log(`Skip ${kind} ${sourceKey} (extract exists, use --force)`);
      continue;
    }

    console.log(`\nExtract ${kind} from ${src.label} (${path.basename(pbf)})...`);
    let usedOsmium = false;
    if (osmium) {
      try {
        usedOsmium = runOsmiumExtract(pbf, sourceKey, kind);
      } catch (e) {
        console.warn("osmium failed, falling back to Node parser:", e.message);
      }
    }

    if (!usedOsmium) {
      const result = await parsePbfToRecords(pbf, {
        kind,
        regionLabel,
        stateFilter: src.stateFilter || null,
      });
      console.log(
        `  nodes ${result.nodeCount}, ways ${result.wayCount} → ${result.recordCount} records`
      );
      writeExtractJsonl(sourceKey, kind, result);
    }
  }
}

console.log("\nExtract complete.");
