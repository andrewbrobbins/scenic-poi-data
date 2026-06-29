/**
 * Canada park amenities paths.
 */
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

export const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const INGEST_DIR = path.join(TOOLS_DIR, "park-amenities-ca-ingest");
export const MASTER_PATH = path.join(TOOLS_DIR, "park-amenities-ca-master.json");
export const ROLLUP_PATH = path.join(TOOLS_DIR, "park-amenities-ca-rollup.json");
export const QA_PATH = path.join(TOOLS_DIR, "park-amenities-ca-qa.json");
export const EMBED_PATH = path.join(TOOLS_DIR, "park-amenities-ca-explorer-embed.js");

export function ensureIngestDir(step) {
  const d = path.join(INGEST_DIR, step);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
