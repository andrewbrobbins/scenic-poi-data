import path from "path";
import {
  loadEnvFile,
  baseRecord,
  addReview,
  coordValid,
  ensureIngestDir,
  isCommercialName,
  slugify,
  sleep,
  writeJson,
} from "./camping-us-lib.mjs";

function ridbKey() {
  loadEnvFile();
  return process.env.RECREATION_GOV_API_KEY || process.env.RIDB_API_KEY || "";
}

function mapOrg(orgName) {
  const o = (orgName || "").toUpperCase();
  if (o.includes("NATIONAL PARK")) return "NPS";
  if (o.includes("FOREST")) return "USFS";
  if (o.includes("LAND MANAGEMENT") || o.includes("BLM")) return "BLM";
  if (o.includes("CORPS")) return "COE";
  return "Federal";
}

export async function ingestRidb() {
  const outDir = ensureIngestDir("04-ridb");
  const key = ridbKey();
  if (!key) {
    const payload = {
      generated: new Date().toISOString(),
      skipped: true,
      reason: "No RECREATION_GOV_API_KEY or RIDB_API_KEY in .env",
      recordCount: 0,
      records: [],
    };
    writeJson(path.join(outDir, "campgrounds.json"), payload);
    console.log("RIDB: skipped (no API key)");
    return payload;
  }

  const records = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const url = `https://ridb.recreation.gov/api/v1/facilities?activity=CAMPING&limit=${limit}&offset=${offset}`;
    const res = await fetch(url, {
      headers: { apikey: key, Accept: "application/json" },
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) throw new Error(`RIDB HTTP ${res.status}`);
    const j = await res.json();
    const rows = j.RECDATA || [];
    for (const row of rows) {
      const lat = parseFloat(row.FacilityLatitude);
      const lon = parseFloat(row.FacilityLongitude);
      if (!coordValid(lat, lon)) continue;
      const name = (row.FacilityName || "").trim();
      if (!name || isCommercialName(name)) continue;
      const rec = baseRecord({
        id: `CG-RIDB-${row.FacilityID || slugify(name)}`,
        name,
        type: "developed",
        landManager: mapOrg(row.OrgName),
        parentUnit: row.ParentRecAreaName ? { system: "ridb", name: row.ParentRecAreaName } : null,
        state: (row.FacilityState || "").toUpperCase(),
        lat,
        lon,
        coordSource: "recreation.gov-ridb",
        coordConfidence: "high",
        cost: "fee",
        reservable: row.Reservable === "Y",
        commercial: false,
        ingestSource: "04-ridb",
        sourceIds: { facilityId: row.FacilityID },
        urls: {},
      });
      if (!rec.state) addReview(rec, "missing-state", "NO_STATE");
      records.push(rec);
    }
    offset += rows.length;
    if (rows.length < limit) break;
    await sleep(400);
  }
  const payload = { generated: new Date().toISOString(), recordCount: records.length, records };
  writeJson(path.join(outDir, "campgrounds.json"), payload);
  return payload;
}

if (process.argv[1]?.endsWith("build-camping-us-ingest-ridb.mjs")) {
  await ingestRidb();
}
