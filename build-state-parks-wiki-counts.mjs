/**
 * Parse Wikipedia list pages into park counts for four-source cross-check.
 *
 * Reads wikitable rows and Location map+ links from wikitext — not a flat [[link]] grep.
 *
 * Usage:
 *   node build-state-parks-wiki-counts.mjs
 *   node build-state-parks-wiki-counts.mjs --state=AR,FL
 */
import path from "path";
import { fileURLToPath } from "url";
import { log, logSection } from "./pipeline-log.mjs";
import { readJson, writeJson } from "./state-parks-lib.mjs";
import {
  fetchWikipediaWikitextBatch,
  parseWikipediaListPage,
} from "./state-parks-listing-lib.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(tools, "state-parks-wiki-counts-cache.json");
const SOURCES_PATH = path.join(tools, "state-parks-cross-check-sources.json");

const args = process.argv.slice(2);
const stateArg = args.find((a) => a.startsWith("--state="));
const countryArg = args.find((a) => a.startsWith("--country="));
const countryFilter = countryArg ? countryArg.replace("--country=", "").toUpperCase() : null;
const stateFilter = stateArg
  ? new Set(stateArg.replace("--state=", "").split(",").map((s) => s.trim().toUpperCase()))
  : null;

function wikiTitleFromUrl(url) {
  return url?.split("/wiki/").pop()?.replace(/#/g, "") || null;
}

function targetsFromSources(crossCheck) {
  const out = [];
  for (const country of ["US", "CA"]) {
    if (countryFilter && country !== countryFilter) continue;
    const key = country === "CA" ? "ca" : "us";
    for (const [admin, row] of Object.entries(crossCheck[key] || {})) {
      if (stateFilter && !stateFilter.has(admin)) continue;
      const wikiUrl = row.sources?.find((s) => s.tier === "wikipedia")?.url;
      const title = wikiTitleFromUrl(wikiUrl);
      if (!title) continue;
      out.push({ admin, country, title, wikiUrl });
    }
  }
  return out.sort((a, b) => a.admin.localeCompare(b.admin));
}

async function main() {
  log("build-state-parks-wiki-counts.mjs starting");
  const crossCheck = readJson(SOURCES_PATH, { us: {}, ca: {} });
  const existing = readJson(OUT_PATH, {});
  const targets = targetsFromSources(crossCheck);

  logSection(`Wikipedia list parse (${targets.length} admins)`);
  const wikitextByTitle = await fetchWikipediaWikitextBatch(targets.map((t) => t.title));

  const cache = { ...existing };
  let ok = 0;
  let failed = 0;

  for (const { admin, country, title, wikiUrl } of targets) {
    const key = `${country}:${admin}`;
    const wikitext = wikitextByTitle.get(title) || "";
    if (!wikitext) {
      log(`${admin}: empty wikitext for ${title}`, { level: "warn" });
      failed += 1;
      continue;
    }
    const parsed = parseWikipediaListPage(wikitext);
    cache[key] = {
      wiki: title,
      wikiUrl,
      total: parsed.total,
      parks: parsed.parks.length,
      historic: parsed.historic.length,
      method: parsed.method,
      tables: parsed.tables,
      namesSample: parsed.names.slice(0, 3),
    };
    log(
      `${admin}: ${parsed.total} parks (${parsed.parks.length} park, ${parsed.historic.length} historic) via ${parsed.method}`
    );
    ok += 1;
  }

  cache.generated = new Date().toISOString();
  writeJson(OUT_PATH, cache);
  log(`Wikipedia counts done: ${ok} ok, ${failed} failed — wrote ${OUT_PATH}`);
}

main();
