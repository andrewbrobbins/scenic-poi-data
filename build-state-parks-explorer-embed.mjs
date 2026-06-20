/**
 * Slim state/provincial park layers for scenic-router / poi-explorer.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log } from "./pipeline-log.mjs";
import {
  EMBED_CA_PATH,
  EMBED_US_PATH,
  MASTER_CA_PATH,
  MASTER_US_PATH,
  readJson,
} from "./state-parks-lib.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));

function toEmbedRow(r) {
  return {
    id: r.id,
    name: r.name,
    lat: r.lat,
    lon: r.lon,
    state: r.state || "",
    designation: r.designation || "",
    category: r.category || "",
    url: r.url || "",
    needsReview: !!r.needsReview,
  };
}

function buildEmbed(masterPath, outPath, region) {
  log(`Building ${region.toUpperCase()} embed from ${masterPath}...`);
  const master = readJson(masterPath, { records: [] });
  const records = (master.records || []).map(toEmbedRow);
  const payload = {
    generated: master.generated || new Date().toISOString(),
    kind: "state_park",
    region,
    count: records.length,
    needsReviewCount: records.filter((r) => r.needsReview).length,
    records,
  };
  fs.writeFileSync(
    outPath,
    `/* Auto-generated — node build-state-parks-explorer-embed.mjs */\nvar STATE_PARKS_${region.toUpperCase()}=${JSON.stringify(payload)};\n`,
    "utf8"
  );
  log(`Wrote ${outPath}: ${records.length} records (${payload.needsReviewCount} need review)`);
}

log("build-state-parks-explorer-embed.mjs starting");
buildEmbed(MASTER_US_PATH, EMBED_US_PATH, "us");
buildEmbed(MASTER_CA_PATH, EMBED_CA_PATH, "ca");
log("Explorer embeds complete");
