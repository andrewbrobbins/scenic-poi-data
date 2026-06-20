/**
 * Step 2: NPS Developer API visitor centers (requires NPS_API_KEY for full hours/coords).
 */
import path from "path";
import { fileURLToPath } from "url";
import {
  NPS_API_BASE,
  ensureIngestDir,
  loadEnvFile,
  writeJson,
  TOOLS_DIR,
} from "./nps-visitor-centers-lib.mjs";

function apiKey() {
  loadEnvFile();
  return process.env.NPS_API_KEY || "";
}

export async function ingestApi({ force = false } = {}) {
  const outDir = ensureIngestDir("02-nps-api");
  const outPath = path.join(outDir, "visitor-centers.json");

  const key = apiKey();
  if (!key) {
    console.warn("No NPS_API_KEY — skipping API ingest (hours will be incomplete until key is set).");
    return { skipped: true, reason: "missing-api-key", recordCount: 0, records: [] };
  }

  console.log("NPS API: downloading visitor centers...");
  const records = [];
  let start = 0;
  const limit = 50;

  async function fetchPage(startOffset) {
    const url = `${NPS_API_BASE}/visitorcenters?limit=${limit}&start=${startOffset}`;
    for (let attempt = 0; attempt < 6; attempt++) {
      const res = await fetch(url, { headers: { "X-Api-Key": key } });
      if (res.status === 429) {
        const wait = 2000 * (attempt + 1);
        console.warn(`NPS API rate limit — waiting ${wait}ms (start=${startOffset})`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`NPS visitorcenters HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      return res.json();
    }
    throw new Error(`NPS visitorcenters rate limited after retries (start=${startOffset})`);
  }

  while (true) {
    const data = await fetchPage(start);
    const rows = data.data || [];
    for (const vc of rows) {
      const lat = parseFloat(vc.latitude);
      const lon = parseFloat(vc.longitude);
      records.push({
        id: vc.id || "",
        name: (vc.name || "Visitor Center").trim(),
        parkCode: (vc.parkCode || "").toLowerCase(),
        lat: Number.isFinite(lat) ? lat : null,
        lon: Number.isFinite(lon) ? lon : null,
        description: vc.description || "",
        directions: vc.directions || "",
        directionsInfo: vc.directionsInfo || "",
        operatingHours: vc.operatingHours || [],
        phoneNumbers: vc.phoneNumbers || [],
        emailAddresses: vc.emailAddresses || [],
        urls: vc.urls || [],
        addresses: vc.addresses || [],
      });
    }
    if (rows.length < limit) break;
    start += limit;
    if (start % 200 === 0) console.log("NPS API: fetched", records.length, "...");
    await new Promise((r) => setTimeout(r, 400));
  }

  const payload = {
    generated: new Date().toISOString(),
    source: "developer.nps.gov/api/v1/visitorcenters",
    recordCount: records.length,
    records,
  };
  writeJson(outPath, payload);
  console.log("NPS API ingest saved:", payload.recordCount, "records ->", outPath);
  return payload;
}

if (process.argv[1]?.endsWith("build-nps-visitor-centers-ingest-api.mjs")) {
  await ingestApi();
}
