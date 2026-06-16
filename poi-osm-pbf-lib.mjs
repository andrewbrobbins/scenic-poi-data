/**
 * Osmium CLI helpers + GeoJSONSeq reader for PBF extract pipeline.
 */
import { osmiumExePath } from "./scenic-osmium-lib.mjs";
import { execSync, spawnSync } from "child_process";
import { createReadStream } from "fs";
import fs from "fs";
import readline from "readline";
import path from "path";
import {
  EXTRACTED_DIR,
  OSMIUM_TAG_FILTERS,
  extractedGeojsonPath,
  extractedJsonlPath,
} from "./poi-osm-pbf-config.mjs";
import {
  POI_KINDS,
  featuresToRecords,
  coordValidCa,
  coordValidUs,
  writeJson,
} from "./poi-osm-lib.mjs";

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function fileSizeMb(filePath) {
  if (!fs.existsSync(filePath)) return 0;
  return Math.round((fs.statSync(filePath).size / (1024 * 1024)) * 10) / 10;
}

export function findOsmiumCommand() {
  const bundled = osmiumExePath();
  if (bundled) return bundled;
  const candidates = ["osmium", "osmium-tool"];
  for (const cmd of candidates) {
    const r = spawnSync(cmd, ["--version"], { encoding: "utf8", shell: true });
    if (r.status === 0) return cmd;
  }
  return null;
}

export function runOsmiumExtract(pbfPath, sourceKey, kind) {
  const osmium = findOsmiumCommand();
  if (!osmium) return false;

  const filters = OSMIUM_TAG_FILTERS[kind];
  if (!filters?.length) throw new Error("No osmium filter for kind: " + kind);

  ensureDir(EXTRACTED_DIR);
  const filteredPbf = path.join(EXTRACTED_DIR, `${kind}-${sourceKey}.osm.pbf`);
  const outGeo = extractedGeojsonPath(sourceKey, kind);
  const filterExpr = filters.join(" ");

  console.log(`  osmium tags-filter â†’ ${path.basename(filteredPbf)}`);
  execSync(`"${osmium}" tags-filter "${pbfPath}" -o "${filteredPbf}" ${filterExpr}`, {
    stdio: "inherit",
    shell: true,
  });

  console.log(`  osmium export â†’ ${path.basename(outGeo)}`);
  execSync(
    `"${osmium}" export "${filteredPbf}" -o "${outGeo}" -f geojsonseq --attributes=id,type`,
    { stdio: "inherit", shell: true }
  );

  try {
    fs.unlinkSync(filteredPbf);
  } catch {
    /* optional cleanup */
  }
  return true;
}

export async function readGeojsonSeq(filePath) {
  const features = [];
  if (!fs.existsSync(filePath)) return features;

  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    try {
      features.push(JSON.parse(t));
    } catch {
      /* skip malformed lines */
    }
  }
  return features;
}

function coordValidForRegion(regionLabel) {
  return regionLabel === "CA" ? coordValidCa : coordValidUs;
}

export async function ingestExtractedFile({
  sourceKey,
  kind,
  region,
  regionLabel,
  stateFilter,
  extractPath,
}) {
  const kindCfg = POI_KINDS[kind];
  const coordValid = coordValidForRegion(regionLabel);
  let features = [];

  if (extractPath.endsWith(".geojsonseq")) {
    features = await readGeojsonSeq(extractPath);
  } else if (extractPath.endsWith(".jsonl")) {
    const text = fs.readFileSync(extractPath, "utf8");
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        const row = JSON.parse(t);
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [row.lon, row.lat] },
          properties: { id: row.osmId, type: row.osmType, tags: row.tags },
        });
      } catch {
        /* skip */
      }
    }
  } else {
    throw new Error("Unsupported extract format: " + extractPath);
  }

  const seen = new Set();
  const records = featuresToRecords(features, kind, kindCfg, regionLabel, coordValid, seen, stateFilter);

  return {
    generated: new Date().toISOString(),
    source: sourceKey,
    kind,
    region,
    extractPath,
    featureCount: features.length,
    recordCount: records.length,
    records,
  };
}

export function writeExtractJsonl(sourceKey, kind, parseResult) {
  ensureDir(EXTRACTED_DIR);
  const out = extractedJsonlPath(sourceKey, kind);
  const lines = parseResult.records.map((r) =>
    JSON.stringify({
      osmType: r.osm.type,
      osmId: r.osm.id,
      lat: r.lat,
      lon: r.lon,
      tags:
        r.subtype != null
          ? { name: r.name, historic: r.subtype }
          : { name: r.name },
    })
  );
  fs.writeFileSync(out, lines.join("\n") + (lines.length ? "\n" : ""), "utf8");
  return out;
}

