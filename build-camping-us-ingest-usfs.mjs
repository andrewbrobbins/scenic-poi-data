/**
 * Step 2: USFS developed campgrounds from EDW Recreation Sites.
 */
import path from "path";
import {
  baseRecord,
  addReview,
  coordValid,
  ensureIngestDir,
  fetchArcgisAllFeatures,
  isCommercialName,
  slugify,
  writeJson,
} from "./camping-us-lib.mjs";

const QUERY_BASE =
  "https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_RecInfraRecreationSites_02/MapServer/0/query";

export async function ingestUsfs() {
  const outDir = ensureIngestDir("02-usfs-recreation");
  console.log("USFS: downloading CAMPGROUND sites...");
  const features = await fetchArcgisAllFeatures(
    QUERY_BASE,
    "SITE_TYPE='CAMPGROUND'",
    "SITE_NAME,SITE_TYPE",
    2000
  );
  console.log("USFS: raw features", features.length);

  const records = [];
  const skipped = { noCoords: 0, commercial: 0 };

  for (const f of features) {
    const a = f.attributes || {};
    const lat = f.geometry?.y;
    const lon = f.geometry?.x;
    if (!coordValid(lat, lon)) {
      skipped.noCoords++;
      continue;
    }
    const name = (a.SITE_NAME || a.site_name || "USFS Campground").trim();
    if (isCommercialName(name)) {
      skipped.commercial++;
      continue;
    }

    const rec = baseRecord({
      id: `CG-USFS-${slugify(name)}-${Math.round(lat * 1000)}`,
      name,
      type: "developed",
      landManager: "USFS",
      parentUnit: null,
      state: "",
      lat,
      lon,
      coordSource: "usfs-arcgis-recreation",
      coordConfidence: "high",
      cost: "mixed",
      reservable: null,
      commercial: false,
      ingestSource: "02-usfs-recreation",
      sourceIds: { siteType: a.SITE_TYPE || a.site_type },
      urls: { detail: "https://www.fs.usda.gov/visit" },
    });

    addReview(rec, "missing-parent-forest", "NO_PARENT");
    addReview(rec, "missing-state-infer-from-geo", "NO_STATE");

    records.push(rec);
  }

  const payload = {
    generated: new Date().toISOString(),
    source: "EDW_RecInfraRecreationSites_02",
    rawCount: features.length,
    recordCount: records.length,
    skipped,
    records,
  };
  writeJson(path.join(outDir, "campgrounds.json"), payload);
  console.log("USFS ingest saved:", payload.recordCount);
  return payload;
}

if (process.argv[1]?.endsWith("build-camping-us-ingest-usfs.mjs")) {
  await ingestUsfs();
}
