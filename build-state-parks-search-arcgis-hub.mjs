/**
 * Search ArcGIS Online for state park layers and probe candidates.
 * Usage: node build-state-parks-search-arcgis-hub.mjs --state=WI,PA
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { log } from "./pipeline-log.mjs";
import { INGEST_DIR, readJson, writeJson, US_STATES } from "./state-parks-lib.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(INGEST_DIR, "00-research");

const STATE_NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
  CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky",
  LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

async function hubSearch(query) {
  const url = `https://www.arcgis.com/sharing/rest/search?q=${encodeURIComponent(query)}&num=10&f=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) return [];
  const j = await res.json();
  return j.results || [];
}

function serviceUrlFromItem(item) {
  const u = item.url || "";
  if (!u) return null;
  if (u.includes("FeatureServer") || u.includes("MapServer")) {
    return u.replace(/\/+$/, "") + "/0/query";
  }
  return null;
}

async function probeCount(queryUrl) {
  const url = `${queryUrl}?where=1%3D1&returnCountOnly=true&f=json`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const j = await res.json();
    if (j.error) return { ok: false, error: j.error.message || JSON.stringify(j.error) };
    return { ok: true, count: j.count ?? 0 };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

const HUB_EXCLUDE = /PADUS|FederalLands|E911|Green Book|Geoheritage|IndianReservation|NationalParkService|Chesapeake Conservation|Detroit_MP|Oblique Aerial|RaceHispanic|nhgis|shapefile|tract_|USA_|National park \(PADUS\)|Mining Claims|Detailed_Parks|MineClaims/i;

function scoreHubHit(hit, stateName) {
  const title = hit.title || "";
  if (HUB_EXCLUDE.test(title)) return -1000;
  let score = hit.probe?.count || 0;
  if (/state park/i.test(title)) score += 5000;
  if (new RegExp(stateName, "i").test(title)) score += 2000;
  if (/historic site/i.test(title)) score += 500;
  if (hit.probe?.count > 50000) score -= 3000;
  if (hit.probe?.count > 10000) score -= 1000;
  return score;
}

async function searchState(st) {
  const name = STATE_NAMES[st];
  const queries = [
    `${name} state parks FeatureServer`,
    `${st} state parks boundaries`,
    `${name} DNR state parks`,
    `${name} state parks historic sites`,
  ];
  const seen = new Set();
  const hits = [];

  for (const q of queries) {
    const results = await hubSearch(q);
    for (const item of results) {
      const key = item.id || item.url;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const queryUrl = serviceUrlFromItem(item);
      if (!queryUrl) continue;
      const probe = await probeCount(queryUrl);
      hits.push({
        title: item.title,
        owner: item.owner,
        url: item.url,
        queryUrl,
        probe,
        score: 0,
      });
    }
  }

  for (const h of hits) {
    h.score = scoreHubHit(h, name);
  }
  hits.sort((a, b) => b.score - a.score);
  return { state: st, name, hits: hits.filter((h) => h.probe.ok && h.probe.count > 0 && h.score > 0).slice(0, 5) };
}

async function main() {
  const stateArg = process.argv.find((a) => a.startsWith("--state="));
  const states = stateArg ? stateArg.slice(8).split(",") : US_STATES.filter((s) => s !== "DC");

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const existing = readJson(path.join(OUT_DIR, "hub-search-us.json"), { states: {} });

  for (const st of states.map((s) => s.trim().toUpperCase())) {
    log(`Hub search: ${st}...`);
    try {
      existing.states[st] = await searchState(st);
      const n = existing.states[st].hits?.length || 0;
      log(`  ${st}: ${n} viable layer(s)`);
      if (existing.states[st].hits?.[0]) {
        log(`    best: ${existing.states[st].hits[0].title} (${existing.states[st].hits[0].probe.count})`);
      }
    } catch (e) {
      log(`  ${st} search failed: ${e.message}`, { level: "warn" });
    }
    writeJson(path.join(OUT_DIR, "hub-search-us.json"), {
      generated: new Date().toISOString(),
      states: existing.states,
    });
  }
  log(`Wrote ${path.join(OUT_DIR, "hub-search-us.json")}`);
}

main().catch((e) => {
  log(String(e), { level: "error" });
  process.exit(1);
});
