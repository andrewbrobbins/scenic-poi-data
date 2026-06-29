/**
 * Track four-source completion per US state (SP-001).
 *
 * Goal: each state should have GIS, OSM, official website listing, and Wikipedia
 * list page; mark **completed** when all four exist and catalog counts roughly agree.
 *
 * Usage:
 *   node build-state-parks-four-source-status.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log, logSection } from "./pipeline-log.mjs";
import { readJson, US_STATES, writeJson } from "./state-parks-lib.mjs";
import { loadListingCache } from "./state-parks-listing-lib.mjs";
import { loadSourceMatrix } from "./state-parks-official-lib.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));
const OUT_JSON = path.join(tools, "state-parks-four-source-status.json");
const OUT_MD = path.join(tools, "STATE-PARKS-COMPLETION.md");
const WIKI_CACHE = path.join(tools, "state-parks-wiki-counts-cache.json");

/** max/min among GIS, website, Wikipedia, plotted must be <= this to count as agreeing */
const AGREE_RATIO = 1.35;

function osmRawCount(records, admin) {
  return records.filter((r) => r.state === admin).length;
}

function osmPlottedCount(records, admin) {
  return records.filter((r) => r.state === admin && r.source === "osm").length;
}

function gisRow(matrix, admin) {
  const m = (matrix.us || []).find((r) => r.admin === admin) || {};
  const has = m.status === "verified" && !!m.queryUrl;
  return {
    has,
    count: has ? (m.featureCount ?? null) : null,
    url: m.queryUrl || null,
    status: m.status || "pending",
  };
}

function websiteRow(crossCheck, admin) {
  const listing = loadListingCache(admin);
  const url = crossCheck.us?.[admin]?.sources?.find((s) => s.tier === "official_listing")?.url;
  const has = !!(listing?.count > 0);
  return {
    has,
    count: listing?.count ?? null,
    url: listing?.listingUrl || url || null,
    method: listing?.scrapeMethod || null,
  };
}

function wikiRow(crossCheck, wikiCache, admin) {
  const cached = wikiCache[`US:${admin}`]?.total;
  const listing = loadListingCache(admin);
  const url = crossCheck.us?.[admin]?.sources?.find((s) => s.tier === "wikipedia")?.url;
  let count = cached ?? null;
  if (count == null && listing?.scrapeMethod?.includes("wikipedia")) count = listing.count;
  const has = count != null && count > 0;
  return { has, count, url: url || null };
}

function catalogAgrees(counts) {
  const v = counts.filter((x) => x != null && x > 0);
  if (v.length < 3) return false;
  const min = Math.min(...v);
  const max = Math.max(...v);
  return max / min <= AGREE_RATIO;
}

function buildRows() {
  const matrix = loadSourceMatrix();
  const crossCheck = readJson(path.join(tools, "state-parks-cross-check-sources.json"), { us: {} });
  const master = readJson(path.join(tools, "state-parks-us-master.json"), { records: [] });
  const pbf = readJson(path.join(tools, "state-parks-ingest/00-pbf/state-parks-us.json"), { records: [] });
  const wikiCache = fs.existsSync(WIKI_CACHE) ? readJson(WIKI_CACHE, {}) : {};

  const rows = [];
  for (const admin of US_STATES.filter((s) => s !== "DC")) {
    const gis = gisRow(matrix, admin);
    const website = websiteRow(crossCheck, admin);
    const wikipedia = wikiRow(crossCheck, wikiCache, admin);
    const osm = {
      has: osmRawCount(pbf.records || [], admin) > 0,
      raw: osmRawCount(pbf.records || [], admin),
      plotted: osmPlottedCount(master.records || [], admin),
    };
    const plotted = master.records.filter((r) => r.state === admin).length;
    const catalogCounts = {
      gis: gis.count,
      website: website.count,
      wikipedia: wikipedia.count,
      plotted,
    };
    const fourPresent = gis.has && osm.has && website.has && wikipedia.has;
    const agree = catalogAgrees([gis.count, website.count, wikipedia.count, plotted]);
    const completed = fourPresent && agree;
    const missing = [
      !gis.has && "GIS",
      !osm.has && "OSM",
      !website.has && "website",
      !wikipedia.has && "Wikipedia",
    ].filter(Boolean);

    rows.push({
      admin,
      completed,
      fourPresent,
      catalogAgree: agree,
      plotted,
      gis,
      osm,
      website,
      wikipedia,
      catalogCounts,
      missing,
    });
  }
  return rows;
}

function renderMarkdown(rows, generated) {
  const completed = rows.filter((r) => r.completed);
  const remaining = rows.filter((r) => !r.completed);

  const lines = [
    "# State parks — four-source completion (SP-001)",
    "",
    `Generated: \`${generated}\` — refresh with \`node build-state-parks-four-source-status.mjs\``,
    "",
    "See **[STATE-PARKS.md](STATE-PARKS.md#four-source-completion-goal)** for policy.",
    "",
    "## Completed (" + completed.length + "/50)",
    "",
    "| ST | Plotted | GIS | Website | Wikipedia | OSM (raw PBF) |",
    "|----|--------:|----:|--------:|----------:|--------------:|",
  ];

  for (const r of completed.sort((a, b) => a.admin.localeCompare(b.admin))) {
    const c = r.catalogCounts;
    lines.push(
      `| ${r.admin} | ${c.plotted} | ${c.gis} | ${c.website} | ${c.wikipedia} | ${r.osm.raw} |`
    );
  }

  lines.push(
    "",
    "## Remaining (" + remaining.length + "/50)",
    "",
    "| ST | Plotted | GIS | OSM raw | Website | Wiki | 4/4 | Counts agree | Missing |",
    "|----|--------:|----:|--------:|--------:|-----:|:---:|:------------:|---------|"
  );

  for (const r of remaining.sort((a, b) => a.missing.length - b.missing.length || a.admin.localeCompare(b.admin))) {
    lines.push(
      `| ${r.admin} | ${r.plotted} | ${r.gis.count ?? "—"} | ${r.osm.raw} | ${r.website.count ?? "—"} | ${r.wikipedia.count ?? "—"} | ${r.fourPresent ? "Y" : "N"} | ${r.catalogAgree ? "Y" : "N"} | ${r.missing.join(", ") || "—"} |`
    );
  }

  lines.push(
    "",
    "### Notes",
    "",
    "- **GIS** — verified ArcGIS layer in `state-parks-source-matrix.json` (`featureCount`).",
    "- **OSM raw** — unfiltered PBF extract (`state-parks-ingest/00-pbf/state-parks-us.json`); presence only for completion, not count agreement.",
    "- **Website** — listing cache count from agency park finder (`state-parks-ingest/02-listings/{st}.json`).",
    "- **Wikipedia** — parsed list-page link count (`state-parks-wiki-counts-cache.json` or listing fallback).",
    "- **Counts agree** — GIS, website, Wikipedia, and plotted master counts within ratio " +
      AGREE_RATIO +
      "× (excluding raw OSM).",
    "- States with all four sources but no agreement usually have GIS polygons that include sub-units, SNAs, or stale Wikipedia/HTML allowlists."
  );

  return lines.join("\n");
}

function main() {
  log("build-state-parks-four-source-status.mjs starting");
  const rows = buildRows();
  const generated = new Date().toISOString();
  const completed = rows.filter((r) => r.completed).map((r) => r.admin);

  writeJson(OUT_JSON, {
    generated,
    policy: {
      requiredSources: ["GIS", "OSM", "official_website", "wikipedia"],
      agreementCounts: ["gis", "website", "wikipedia", "plotted"],
      agreeMaxRatio: AGREE_RATIO,
    },
    completedCount: completed.length,
    completed,
    rows,
  });

  fs.writeFileSync(OUT_MD, renderMarkdown(rows, generated));

  logSection("Four-source completion");
  log(`Completed: ${completed.length}/50 — ${completed.join(", ") || "(none)"}`);
  log(`All four present: ${rows.filter((r) => r.fourPresent).length}/50`);
  log(`Wrote ${OUT_JSON}`);
  log(`Wrote ${OUT_MD}`);
}

main();
