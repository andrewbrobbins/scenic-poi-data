/**
 * Merge PBF extracts into per-region ingest caches (01-osm/merged.json).
 * Usage:
 *   node build-poi-osm-ingest-pbf.mjs [--source=us|ca|tx] [--kind=playground|viewpoint|historic]
 */
import fs from "fs";
import path from "path";
import {
  PBF_SOURCES,
  extractedGeojsonPath,
  extractedJsonlPath,
} from "./poi-osm-pbf-config.mjs";
import { ingestExtractedFile } from "./poi-osm-pbf-lib.mjs";
import { POI_KINDS, ingestDir, writeJson } from "./poi-osm-lib.mjs";

function parseArgs() {
  const out = { sources: ["us", "ca"], kinds: Object.keys(POI_KINDS) };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--proof") out.sources = ["tx"];
    else if (arg.startsWith("--source=")) out.sources = [arg.slice(9)];
    else if (arg.startsWith("--kind=")) out.kinds = [arg.slice(7)];
  }
  return out;
}

const args = parseArgs();

for (const sourceKey of args.sources) {
  const src = PBF_SOURCES[sourceKey];
  const region = src.region;
  const regionLabel = region === "ca" ? "CA" : "US";

  for (const kind of args.kinds) {
    const geo = extractedGeojsonPath(sourceKey, kind);
    const jsonl = extractedJsonlPath(sourceKey, kind);
    const extractPath = fs.existsSync(geo) ? geo : fs.existsSync(jsonl) ? jsonl : null;

    if (!extractPath) {
      console.error(
        `Missing extract for ${kind} ${sourceKey} — run: node build-poi-osm-extract-pbf.mjs --source=${sourceKey} --kind=${kind}`
      );
      process.exit(1);
    }

    console.log(`Ingest ${kind} ${sourceKey} ← ${path.basename(extractPath)}`);
    const payload = await ingestExtractedFile({
      sourceKey,
      kind,
      region,
      regionLabel,
      stateFilter: src.stateFilter || null,
      extractPath,
    });

    const outDir = ingestDir(region, kind);
    const mergedPath = path.join(outDir, "merged.json");

    if (sourceKey === "tx") {
      writeJson(mergedPath, payload);
      writeJson(path.join(outDir, "proof-tx.json"), payload);
      console.log(`  Wrote proof ${mergedPath} (${payload.recordCount} records)`);
      continue;
    }

    const existing = fs.existsSync(mergedPath) ? JSON.parse(fs.readFileSync(mergedPath, "utf8")) : null;
    if (sourceKey === "us" || sourceKey === "ca") {
      writeJson(mergedPath, payload);
      console.log(`  Wrote ${mergedPath} (${payload.recordCount} records)`);
    } else if (existing?.records?.length) {
      const seen = new Set(existing.records.map((r) => `${r.osm?.type}:${r.osm?.id}`));
      const merged = [...existing.records];
      for (const r of payload.records) {
        const k = `${r.osm?.type}:${r.osm?.id}`;
        if (!seen.has(k)) {
          seen.add(k);
          merged.push(r);
        }
      }
      writeJson(mergedPath, {
        generated: new Date().toISOString(),
        kind,
        region,
        recordCount: merged.length,
        records: merged,
      });
      console.log(`  Merged ${mergedPath} (${merged.length} records)`);
    }
  }
}

console.log("\nIngest complete.");
