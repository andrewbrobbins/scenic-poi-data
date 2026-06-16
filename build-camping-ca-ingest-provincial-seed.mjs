/**
 * Curated provincial park pins from state-parks-camping-source.json (BC etc.).
 */
import path from "path";
import { fileURLToPath } from "url";
import { baseRecord, ensureIngestDir, readJson, writeJson, TOOLS_DIR } from "./camping-ca-lib.mjs";
import { formatCaCampgroundDisplayName } from "./camping-ca-display-name.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));

export function ingestProvincialSeed() {
  const outDir = ensureIngestDir("03-provincial-seed");
  const src = readJson(path.join(TOOLS_DIR, "state-parks-camping-source.json"), { stateParks: [] });
  const records = [];

  for (const p of src.stateParks || []) {
    if (!p.state || !/^[A-Z]{2}$/.test(p.state)) continue;
    const isCa = ["BC", "AB", "SK", "MB", "ON", "QC", "NB", "NS", "PE", "NL", "YT", "NT", "NU"].includes(p.state);
    if (!isCa) continue;
    if (p.landManager !== "Provincial" && p.landManager !== "State") continue;

    const rec = baseRecord({
        id: p.id.replace(/^C-SP-/, "CG-CA-SEED-") || `CG-CA-SEED-${p.state}-${p.name}`,
        name: p.name,
        type: "developed",
        landManager: "Provincial",
        parentUnit: null,
        state: p.state,
        lat: p.lat,
        lon: p.lon,
        coordSource: "manual-curated",
        coordConfidence: "medium",
        cost: p.cost || "fee",
        commercial: false,
        ingestSource: "03-provincial-seed",
        sourceIds: { seedId: p.id },
        urls: {},
      });
    rec.name = formatCaCampgroundDisplayName(rec);
    records.push(rec);
  }

  const payload = {
    generated: new Date().toISOString(),
    source: "state-parks-camping-source.json (Canada rows)",
    recordCount: records.length,
    records,
  };
  writeJson(path.join(outDir, "campgrounds.json"), payload);
  console.log("Provincial seed:", records.length);
  return payload;
}

if (process.argv[1]?.endsWith("build-camping-ca-ingest-provincial-seed.mjs")) {
  ingestProvincialSeed();
}
