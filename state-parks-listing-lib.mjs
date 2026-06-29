/**
 * Official agency park listing scrape + allowlist matching (SP-001).
 * Website park finder is source of truth; GIS/Wikipedia are inputs to match against it.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  INGEST_DIR,
  coordValid,
  haversineM,
  isExcludedCatalogRecord,
  normalizeName,
  readJson,
  slugify,
  stateParkDisplayName,
  normalizeOfficialParkAbbrevFields,
  writeJson,
} from "./state-parks-lib.mjs";

import { cachePathForAdmin } from "./state-parks-official-lib.mjs";
import {
  GIS_LISTING_OVERRIDES,
  LISTING_FALLBACK_URLS,
  LISTING_VISITOR_CENTER_PARENT,
  SKIP_LISTING_SLUGS,
  WIKIPEDIA_COORD_ALTS,
  buildListingEntryFromSlug,
  buildListingsFromGisUrls,
  buildListingsFromGisNames,
  buildListingsFromHtml,
  buildListingsFromWordPressApi,
  listingKeyFromPublicName,
  LISTING_COORD_OVERRIDES,
  shouldEnrichListingPages,
  slugFromGisUrl,
  slugToListingKey,
  titleCaseFromKey,
  WORDPRESS_LISTING_SOURCES,
} from "./state-parks-listing-adapters.mjs";

const tools = path.dirname(fileURLToPath(import.meta.url));
export const LISTING_INGEST_DIR = path.join(INGEST_DIR, "02-listings");
export const CROSS_CHECK_SOURCES_PATH = path.join(tools, "state-parks-cross-check-sources.json");

export {
  GIS_LISTING_OVERRIDES,
  LISTING_FALLBACK_URLS,
  LISTING_VISITOR_CENTER_PARENT,
  SKIP_LISTING_SLUGS,
  slugToListingKey,
  titleCaseFromKey,
};

/** GIS polygon names that are sub-units of a single public park listing. */
const GIS_SUBUNIT_SUFFIX =
  /\s+(Trailway|Trail Corridor|Visitor Center|Reservior Trailway)$/i;

export function listingKeyFromGisName(gisName) {
  if (!gisName) return "";
  let base = gisName.trim();
  const wbc = base.match(/^World Birding Center\s*-\s*(.+)$/i);
  if (wbc) {
    base = wbc[1].trim();
  } else if (base.includes(" - ")) {
    base = base.split(" - ")[0].trim();
  }
  base = base.replace(GIS_SUBUNIT_SUFFIX, "").trim();
  return normalizeName(base).replace(/\s+state park$/i, "").trim();
}

export { listingKeyFromPublicName };

function applyListingCoordOverrides(listings, admin) {
  const overrides = LISTING_COORD_OVERRIDES[admin];
  if (!overrides) return listings;
  return listings.map((listing) => {
    const o = overrides[listing.slug];
    if (!o) return listing;
    return {
      ...listing,
      lat: Math.round(o.lat * 1e5) / 1e5,
      lon: Math.round(o.lon * 1e5) / 1e5,
      coordSource: o.source || "manual_override",
    };
  });
}

export function classifyListingFromPageTitle(pageTitle) {
  const t = (pageTitle || "")
    .replace(/[—–-]\s*(Texas Parks|California State Parks|Florida State Parks).*$/i, "")
    .replace(/&amp;/g, "&")
    .trim();
  if (/visitor center/i.test(t) && !/\bstate park\b/i.test(t) && !/\bstate natural area\b/i.test(t)) {
    return { listingKind: "visitor_center", category: "park", designation: "State Park" };
  }
  if (/\bstate natural area\b/i.test(t)) {
    return { listingKind: "park", category: "park", designation: "State Natural Area" };
  }
  const hasPark = /\bstate park\b/i.test(t) || /\bprovincial park\b/i.test(t);
  const hasHistoric = /\bhistoric site\b/i.test(t) || /\bprovincial historic\b/i.test(t);
  if (hasPark && hasHistoric) {
    return {
      listingKind: "park_and_historic",
      category: "park",
      designation: /\bprovincial/i.test(t) ? "Provincial Park & Historic Site" : "State Park & Historic Site",
      alsoHistoricSite: true,
    };
  }
  if (hasHistoric) {
    const designation = /\bprovincial/i.test(t) ? "Provincial Historic Site" : "State Historic Site";
    return { listingKind: "historic", category: "historic_site", designation };
  }
  return { listingKind: "park", category: "park", designation: "State Park" };
}

export function scrapeParkPageFields(html) {
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  const pageTitle = titleMatch ? titleMatch[1].replace(/&amp;/g, "&").trim() : "";
  const latMatch =
    html.match(/Latitude:\s*([-]?\d+\.\d+)/i) ||
    html.match(/data-lat=["']([-]?\d+\.\d+)/i) ||
    html.match(/"latitude"\s*:\s*([-]?\d+\.\d+)/i);
  const lonMatch =
    html.match(/Longitude:\s*([-]?\d+\.\d+)/i) ||
    html.match(/data-lng=["']([-]?\d+\.\d+)/i) ||
    html.match(/data-lon=["']([-]?\d+\.\d+)/i) ||
    html.match(/"longitude"\s*:\s*([-]?\d+\.\d+)/i);
  const lat = latMatch ? parseFloat(latMatch[1]) : null;
  const lon = lonMatch ? parseFloat(lonMatch[1]) : null;
  const cls = classifyListingFromPageTitle(pageTitle);
  return { pageTitle, lat, lon, ...cls };
}

export async function enrichListingFromPage(listing, { admin } = {}) {
  if (!listing.url) return listing;
  try {
    const res = await fetch(listing.url, {
      signal: AbortSignal.timeout(60000),
      headers: { "User-Agent": "scenic-poi-data/SP-001 listing research" },
    });
    const html = await res.text();
    const fields = scrapeParkPageFields(html);
    const parentSlug = LISTING_VISITOR_CENTER_PARENT[admin]?.[listing.slug];
    return {
      ...listing,
      pageTitle: fields.pageTitle || undefined,
      listingKind: fields.listingKind,
      category: fields.category,
      designation: fields.designation,
      alsoHistoricSite: fields.alsoHistoricSite || listing.alsoHistoricSite,
      lat: fields.lat ?? listing.lat,
      lon: fields.lon ?? listing.lon,
      coordSource: fields.lat != null ? "official_listing_page" : listing.coordSource,
      parentListingSlug: parentSlug || listing.parentListingSlug,
    };
  } catch {
    return listing;
  }
}

export async function enrichListingsFromPages(listings, admin, { max = 120 } = {}) {
  const out = [];
  let fetched = 0;
  for (const listing of listings) {
    if (fetched >= max && listing.lat != null) {
      out.push(listing);
      continue;
    }
    const enriched = await enrichListingFromPage(listing, { admin });
    out.push(enriched);
    if (listing.lat == null && enriched.lat != null) fetched += 1;
  }
  return out;
}

export function isStandaloneListing(listing, admin) {
  if (listing.listingKind === "visitor_center") return false;
  if (LISTING_VISITOR_CENTER_PARENT[admin]?.[listing.slug]) return false;
  return true;
}

/** Extract park page slugs from TPWD and similar /state-parks/{slug} URL patterns. */
export function scrapeStateParkPathSlugs(html, { pathPrefix = "state-parks" } = {}) {
  const slugs = new Set();
  const re = new RegExp(`${pathPrefix}/([a-z0-9][a-z0-9-]*)`, "gi");
  for (const m of html.matchAll(re)) {
    const slug = m[1].toLowerCase();
    if (slug.length < 3 || SKIP_LISTING_SLUGS.has(slug)) continue;
    slugs.add(slug);
  }
  return [...slugs].sort();
}

const WIKIPEDIA_FETCH_HEADERS = {
  "User-Agent": "scenic-poi-data/SP-001 (state parks catalog research; contact via repo)",
};

function cleanWikiText(text) {
  return (text || "")
    .replace(/''+/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wikiTargetToName(target) {
  return cleanWikiText(target.replace(/_/g, " "));
}

function parseWikiLinkInner(inner) {
  const parts = (inner || "").split("|");
  const target = parts[0].trim();
  const display = cleanWikiText(parts[1] || target.replace(/_/g, " "));
  return { target, display, canonical: wikiTargetToName(target) };
}

function isExcludedWikiTarget(target) {
  const t = (target || "").trim();
  if (!t || t.length < 3) return true;
  if (/^(Category|File|Template|Help|Portal|Wikipedia|Special):/i.test(t)) return true;
  if (/^List of (?!.*state park)/i.test(t)) return true;
  if (/County,|Parish,|Township,|Census/i.test(t)) return true;
  if (/^National Register of Historic Places/i.test(t)) return true;
  if (/^List of U\.S\. state parks$/i.test(t)) return true;
  if (/^List of national parks/i.test(t)) return true;
  if (/tourism industry|AmeriCorps|Commons category/i.test(t)) return true;
  return false;
}

function classifyWikiParkName(name) {
  if (
    /historic site|historical park|state monument|heritage site|heritage park|battleground|battlefield|cemetery state|museum state| post museum|archeological museum|underground railroad/i.test(
      name
    )
  ) {
    return "historic";
  }
  return "park";
}

function tableCaptionKind(caption) {
  const c = (caption || "").toLowerCase();
  if (!c) return "unknown";
  if (/\bformer\b|\bdefunct\b|\bclosed\b|\bdemolished\b|\bdecommissioned\b/.test(c)) return "former";
  if (/\bother properties\b|\brelated\b|\bsee also\b/.test(c)) return "other";
  if (/\bcurrent\b|\bstate parks\b|\bprovincial parks\b|\bnational parks\b/.test(c)) return "current";
  return "unknown";
}

function splitWikiTables(wikitext) {
  const tables = [];
  let i = 0;
  while (i < wikitext.length) {
    const start = wikitext.indexOf("{|", i);
    if (start < 0) break;
    let depth = 0;
    let j = start;
    while (j < wikitext.length) {
      if (wikitext.startsWith("{|", j)) {
        depth += 1;
        j += 2;
        continue;
      }
      if (wikitext.startsWith("|}", j)) {
        depth -= 1;
        j += 2;
        if (depth === 0) {
          tables.push(wikitext.slice(start, j));
          i = j;
          break;
        }
        continue;
      }
      j += 1;
    }
    if (depth !== 0) break;
  }
  return tables;
}

function tableCaption(table) {
  const m = table.match(/^\{\|[\s\S]*?\|\+\s*([^\n]+)/m);
  return m ? cleanWikiText(m[1]) : "";
}

function tableHasNameHeader(table) {
  return /\b(park name|name)\b/i.test(table.slice(0, 1500));
}

function isParkLikeWikiName(name) {
  return /(state park|state historic|historic site|historical park|state monument|state recreation|provincial park|provincial historic|natural area|conservation area|state forest park|state wayside|state beach|state trail|caverns|museum|battleground|battlefield|memorial|heritage)/i.test(
    name
  );
}

function splitTableRows(table) {
  return table.split(/(?:^|\n)\|\s*[-—]{1,2}\s*/).slice(1);
}

function rowNameCells(row) {
  const parts = row.split("||");
  const cells = [];
  if (parts[0] && /\[\[/.test(parts[0])) cells.push(parts[0]);
  if (parts[1] && /\[\[/.test(parts[1])) cells.push(parts[1]);
  if (!cells.length) cells.push(row);
  return cells;
}

function firstParkLinkInText(text) {
  for (const m of text.matchAll(/\[\[([^\]|#]+(?:\|[^\]]+)?)\]\]/g)) {
    const link = parseWikiLinkInner(m[1]);
    if (/^File:/i.test(link.target)) continue;
    if (isExcludedWikiTarget(link.target)) continue;
    return link;
  }
  return null;
}

function parseFirstLinkFromRow(row) {
  // Header / sub-header rows (Name, acres, …) — no data cells with article links.
  if (/^\s*![^\n]*$/m.test(row.trim()) && !/\|\s*\[\[/.test(row)) return null;

  for (const cell of rowNameCells(row)) {
    const link = firstParkLinkInText(cell);
    if (link) return link;
  }
  return firstParkLinkInText(row);
}

function parseTableParkLinks(table) {
  const caption = tableCaption(table);
  const kind = tableCaptionKind(caption);
  if (kind === "former" || kind === "other") return { kind, caption, links: [] };

  const links = [];
  for (const row of splitTableRows(table)) {
    const link = parseFirstLinkFromRow(row);
    if (!link || isExcludedWikiTarget(link.target)) continue;
    if (kind === "unknown" && !tableHasNameHeader(table) && !isParkLikeWikiName(link.canonical)) continue;
    links.push(link);
  }
  return { kind, caption, links };
}

function parseLocationMapLinks(wikitext) {
  const links = [];
  for (const m of wikitext.matchAll(/\{\{Location\s+map\+[\s\S]*?\}\}/gi)) {
    const block = m[0];
    for (const link of block.matchAll(/link=([^|\n}]+)/g)) {
      const target = link[1].trim();
      if (!target || isExcludedWikiTarget(target)) continue;
      links.push(parseWikiLinkInner(target));
    }
    for (const label of block.matchAll(/label=\[\[([^\]|]+(?:\|[^\]]+)?)\]\]/g)) {
      const link = parseWikiLinkInner(label[1]);
      if (isExcludedWikiTarget(link.target)) continue;
      links.push(link);
    }
  }
  return links;
}

/** Section bullet lists (Alaska and similar list pages without a single wikitable). */
function parseBulletListLinks(wikitext) {
  const links = [];
  for (const m of wikitext.matchAll(/^\*+\s*\[\[([^\]|#]+(?:\|[^\]]+)?)\]\]/gm)) {
    const link = parseWikiLinkInner(m[1]);
    if (isExcludedWikiTarget(link.target)) continue;
    if (!isParkLikeWikiName(link.canonical)) continue;
    links.push(link);
  }
  return links;
}

function dedupeWikiLinks(links) {
  const byTarget = new Map();
  for (const link of links) {
    const key = link.target.toLowerCase();
    if (!byTarget.has(key)) byTarget.set(key, link);
  }
  return [...byTarget.values()];
}

/**
 * Parse a Wikipedia "List of … state parks" page from wikitext.
 * Reads wikitable rows and Location map+ markers — not a flat [[link]] grep.
 */
export function parseWikipediaListPage(wikitext) {
  if (!wikitext?.trim()) {
    return { names: [], parks: [], historic: [], total: 0, method: "empty", tables: [] };
  }

  const tables = splitWikiTables(wikitext);
  const tableMeta = [];
  let links = [];

  const currentLinks = [];
  const unknownCandidates = [];

  for (const table of tables) {
    const { kind, caption, links: tableLinks } = parseTableParkLinks(table);
    if (!tableLinks.length) continue;
    tableMeta.push({ caption: caption || null, kind, count: tableLinks.length });
    if (kind === "current") currentLinks.push(...tableLinks);
    else if (kind === "unknown") unknownCandidates.push({ caption, links: tableLinks });
  }

  if (currentLinks.length) {
    links = currentLinks;
  } else if (unknownCandidates.length) {
    unknownCandidates.sort((a, b) => b.links.length - a.links.length);
    const largest = unknownCandidates[0];
    const secondary = unknownCandidates.slice(1).filter((c) => c.links.length >= 5);
    if (largest.links.length < 35 && secondary.length) {
      links = dedupeWikiLinks([largest, ...secondary].flatMap((c) => c.links));
    } else {
      links = largest.links;
    }
  }

  let method = "wikitable";
  if (links.length < 5) {
    const mapLinks = parseLocationMapLinks(wikitext);
    if (mapLinks.length > links.length) {
      links = mapLinks;
      method = "location_map";
    }
  }
  if (links.length < 5) {
    const bulletLinks = parseBulletListLinks(wikitext);
    if (bulletLinks.length > links.length) {
      links = bulletLinks;
      method = "bullet_list";
    }
  }

  links = dedupeWikiLinks(links);
  const names = links.map((l) => l.canonical).sort((a, b) => a.localeCompare(b));
  const parks = names.filter((n) => classifyWikiParkName(n) === "park");
  const historic = names.filter((n) => classifyWikiParkName(n) === "historic");

  return {
    names,
    parks,
    historic,
    total: names.length,
    method,
    tables: tableMeta,
  };
}

/** Parse park names from Wikipedia wikitext (fallback when HTML scrape is thin). */
export function parseWikipediaParkNames(wikitext) {
  return parseWikipediaListPage(wikitext).names;
}

function wikiTitleVariants(title) {
  const bare = title.replace(/^https:\/\/en\.wikipedia\.org\/wiki\//, "");
  const spaced = bare.replace(/_/g, " ");
  return [bare, spaced];
}

/** Fetch wikitext for multiple titles in one API call (max ~20 per batch). */
export async function fetchWikipediaWikitextBatch(titles, { retries = 3 } = {}) {
  const out = new Map();
  const unique = [...new Set(titles.flatMap((t) => wikiTitleVariants(t)))];
  const requested = [...new Set(titles.map((t) => t.replace(/^https:\/\/en\.wikipedia\.org\/wiki\//, "")))];
  for (let i = 0; i < unique.length; i += 20) {
    const chunk = unique.slice(i, i + 20);
    const titleParam = chunk.map(encodeURIComponent).join("|");
    const url = `https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content&format=json&redirects=1&titles=${titleParam}`;
    let json;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(90000),
        headers: WIKIPEDIA_FETCH_HEADERS,
      });
      const text = await res.text();
      try {
        json = JSON.parse(text);
        break;
      } catch {
        if (attempt === retries) {
          throw new Error(`Wikipedia API non-JSON: ${text.slice(0, 120)}`);
        }
        await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
      }
    }
    for (const page of Object.values(json.query?.pages || {})) {
      if (page.missing || !page.title) continue;
      const content = page.revisions?.[0]?.["*"] || "";
      out.set(page.title, content);
      out.set(page.title.replace(/ /g, "_"), content);
    }
    for (const r of json.query?.redirects || []) {
      const content = out.get(r.to) || out.get(r.to.replace(/ /g, "_"));
      if (content) {
        out.set(r.from, content);
        out.set(r.from.replace(/ /g, "_"), content);
      }
    }
    if (i + 20 < unique.length) await new Promise((r) => setTimeout(r, 1500));
  }
  for (const req of requested) {
    if (out.has(req)) continue;
    const spaced = req.replace(/_/g, " ");
    if (out.has(spaced)) out.set(req, out.get(spaced));
  }
  return out;
}

export async function fetchWikipediaWikitext(wikiTitle) {
  const bare = wikiTitle.replace(/^https:\/\/en\.wikipedia\.org\/wiki\//, "");
  const batch = await fetchWikipediaWikitextBatch([bare]);
  return batch.get(bare) || batch.get(bare.replace(/_/g, " ")) || "";
}

const WIKIPEDIA_COORD_SUFFIXES = [
  " State Park",
  " State Historic Site",
  " State Monument",
  " State Recreation Area",
];

const WIKIPEDIA_COORD_DISAMBIG = {
  LA: "Louisiana",
  OK: "Oklahoma",
  AL: "Alabama",
  KS: "Kansas",
  ID: "Idaho",
};

function wikipediaTitleCandidates(listing, admin) {
  const titles = new Set();
  const name = (listing.name || "").trim();
  const disambig = admin ? WIKIPEDIA_COORD_DISAMBIG[admin] : null;
  if (/state park|state historic|state monument|state recreation/i.test(name)) {
    titles.add(name);
    if (disambig) titles.add(`${name} (${disambig})`);
  }
  for (const suffix of WIKIPEDIA_COORD_SUFFIXES) {
    titles.add(`${name}${suffix}`);
    if (disambig) titles.add(`${name}${suffix} (${disambig})`);
  }
  for (const alt of WIKIPEDIA_COORD_ALTS[admin]?.[listing.slug] || []) {
    titles.add(alt);
  }
  return [...titles];
}

function isJunkListingName(name) {
  const n = (name || "").trim();
  if (n.length < 3) return true;
  return /^(louisiana|state park|list of|alt=)/i.test(n);
}

/** Batch-fetch Wikipedia article coordinates for listing names missing lat/lon. */
export async function enrichListingsFromWikipediaCoords(listings, admin) {
  const needCoords = listings.filter((l) => l.lat == null || l.lon == null);
  if (!needCoords.length) return listings;

  const titles = new Set();
  for (const listing of needCoords) {
    for (const title of wikipediaTitleCandidates(listing, admin)) titles.add(title);
  }

  const coordByTitle = new Map();
  const titleList = [...titles];
  for (let i = 0; i < titleList.length; i += 50) {
    const chunk = titleList.slice(i, i + 50);
    const url = `https://en.wikipedia.org/w/api.php?action=query&prop=coordinates&titles=${chunk.map(encodeURIComponent).join("|")}&format=json`;
    try {
      const json = await fetch(url, { signal: AbortSignal.timeout(60000) }).then((r) => r.json());
      for (const page of Object.values(json.query?.pages || {})) {
        if (page.missing || page.invalid) continue;
        const c = page.coordinates?.[0];
        if (c?.lat != null && c?.lon != null) {
          coordByTitle.set(page.title, { lat: c.lat, lon: c.lon });
        }
      }
    } catch {
      /* skip batch */
    }
  }

  if (!coordByTitle.size) return listings;

  return listings.map((listing) => {
    if (listing.lat != null && listing.lon != null) return listing;
    const disambig = admin ? WIKIPEDIA_COORD_DISAMBIG[admin] : null;
    for (const title of wikipediaTitleCandidates(listing, admin)) {
      const coord = coordByTitle.get(title);
      if (coord && coordValid(coord.lat, coord.lon, listing.country || "US")) {
        return {
          ...listing,
          lat: Math.round(coord.lat * 1e5) / 1e5,
          lon: Math.round(coord.lon * 1e5) / 1e5,
          coordSource: "wikipedia_coordinates",
        };
      }
    }
    return listing;
  });
}

export function buildListingEntriesFromSlugs(slugs, { baseUrl, admin, country = "US" }) {
  const adapter = HTML_LISTING_ADAPTERS[admin] || { baseUrl };
  return slugs.map((slug) => buildListingEntryFromSlug(slug, admin, country, adapter));
}

export function buildListingEntriesFromWikiNames(names, { admin, country = "US" }) {
  return names.map((publicName) => {
    const key = listingKeyFromPublicName(publicName);
    return {
      slug: slugify(key),
      key,
      name: publicName.replace(/\s+State Park.*$/i, "").replace(/\s+State Historic Site.*$/i, "").trim(),
      url: "",
      admin,
      country,
      source: "wikipedia",
    };
  });
}

export function matchGisRecordToListing(rec, listings, admin) {
  if (rec.url) {
    const urlSlug = slugFromGisUrl(rec.url, admin);
    if (urlSlug) {
      const byUrl = listings.find((entry) => entry.slug === urlSlug);
      if (byUrl) return byUrl;
    }
  }

  const gisKey = listingKeyFromGisName(rec.name);
  if (!gisKey) return null;

  const overrideSlug = GIS_LISTING_OVERRIDES[admin]?.[gisKey];
  if (overrideSlug) {
    return listings.find((entry) => entry.slug === overrideSlug) || null;
  }

  for (const entry of listings) {
    if (entry.key === gisKey) return entry;
    if (gisKey.startsWith(`${entry.key} `)) return entry;
    if (entry.key.startsWith(gisKey) && gisKey.length >= 4) return entry;
    if (entry.key.replace(/-/g, " ") === gisKey.replace(/-/g, " ")) return entry;
  }
  return null;
}

function buildListingRecord(listing, admin, { units = [], lat, lon, coordSource, officialSource }) {
  // GIS-matched listing rows are agency-scoped; keep SRAs/greenways the official catalog includes.
  if (
    units.length === 0 &&
    isExcludedCatalogRecord({ name: listing.name, country: listing.country || "US" })
  ) {
    return null;
  }
  const category = listing.category || "park";
  const designation =
    listing.designation ||
    (category === "historic_site"
      ? listing.country === "CA"
        ? "Provincial Historic Site"
        : "State Historic Site"
      : listing.country === "CA"
        ? "Provincial Park"
        : "State Park");
  const name = listing.name || titleCaseFromKey(listing.key);
  const slug = listing.slug;

  const rec = {
    id: `sp-${listing.country.toLowerCase()}-${admin.toLowerCase()}-${slug}-listing`,
    country: listing.country,
    state: admin,
    name,
    designation,
    category,
    lat: Math.round(lat * 1e5) / 1e5,
    lon: Math.round(lon * 1e5) / 1e5,
    source: "official",
    needsReview: coordSource === "official_listing_page",
    reviewReasons: coordSource === "official_listing_page" ? ["coords_from_listing_page"] : [],
    url: listing.url || undefined,
    officialSource,
    listingSlug: slug,
    listingSource: listing.source,
  };

  if (units.length) {
    rec.officialCode = units[0].officialCode || undefined;
    rec.gisUnitCount = units.length;
    rec.gisUnitNames = units.length > 1 ? units.map((u) => u.name) : undefined;
    rec.altOfficialCodes =
      units.map((u) => u.officialCode).filter(Boolean).length > 1
        ? units.map((u) => u.officialCode).filter(Boolean).slice(1)
        : undefined;
  }
  if (coordSource) rec.coordSource = coordSource;
  if (listing.alsoHistoricSite) rec.alsoHistoricSite = true;
  rec.displayName = stateParkDisplayName(rec.name, rec.designation, rec.country);
  return normalizeOfficialParkAbbrevFields(rec);
}

export function aggregateOfficialByListing(officialRecords, listings, admin) {
  const standaloneListings = listings.filter((l) => isStandaloneListing(l, admin));
  const bySlug = new Map();

  for (const rec of officialRecords) {
    if (rec.state !== admin) continue;
    const listing = matchGisRecordToListing(rec, listings, admin);
    if (!listing) continue;
    if (!isStandaloneListing(listing, admin)) continue;

    const group = bySlug.get(listing.slug) || {
      listing,
      units: [],
      lats: [],
      lons: [],
    };
    group.units.push(rec);
    group.lats.push(rec.lat);
    group.lons.push(rec.lon);
    bySlug.set(listing.slug, group);
  }

  const out = [];
  for (const [, group] of bySlug) {
    const { listing, units, lats, lons } = group;
    const rec = buildListingRecord(listing, admin, {
        units,
        lat: lats.reduce((a, b) => a + b, 0) / lats.length,
        lon: lons.reduce((a, b) => a + b, 0) / lons.length,
        officialSource: `Official park listing (${units.length} GIS unit${units.length === 1 ? "" : "s"})`,
      });
    if (rec) out.push(rec);
  }

  const matchedSlugs = new Set(out.map((r) => r.listingSlug));
  for (const listing of standaloneListings) {
    if (matchedSlugs.has(listing.slug)) continue;
    if (listing.lat == null || listing.lon == null) continue;
    if (!coordValid(listing.lat, listing.lon, listing.country)) continue;
    const rec = buildListingRecord(listing, admin, {
      lat: listing.lat,
      lon: listing.lon,
      coordSource: listing.coordSource || "official_listing_page",
      officialSource: "Official park listing (page coordinates)",
    });
    if (rec) out.push(rec);
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function listingCachePath(admin) {
  return path.join(LISTING_INGEST_DIR, `${admin.toLowerCase()}.json`);
}

export function loadListingCache(admin) {
  return readJson(listingCachePath(admin), null);
}

export function loadAllListingCaches(admins) {
  const out = new Map();
  for (const admin of admins) {
    const cache = loadListingCache(admin);
    if (cache?.listings?.length) out.set(admin, cache);
  }
  return out;
}

export function saveListingCache(admin, payload) {
  writeJson(listingCachePath(admin), payload);
}

export function crossCheckSources() {
  if (!fs.existsSync(CROSS_CHECK_SOURCES_PATH)) return { us: {}, ca: {} };
  return readJson(CROSS_CHECK_SOURCES_PATH);
}

export function listingUrlForAdmin(admin, country = "US") {
  const src = crossCheckSources();
  const row = (country === "CA" ? src.ca : src.us)?.[admin];
  const listing = row?.sources?.find((s) => s.tier === "official_listing");
  const wiki = row?.sources?.find((s) => s.tier === "wikipedia");
  return {
    listingUrl: listing?.url || null,
    wikipediaUrl: wiki?.url || null,
    wikipediaTitle: wiki?.url?.split("/wiki/").pop()?.replace(/#/g, "") || null,
  };
}

export async function scrapeListingFromHtml(html, { listingUrl, admin, country = "US" }) {
  const listings = buildListingsFromHtml(html, admin, country);
  if (listings.length < 5) return null;
  return { listings, scrapeMethod: "official_listing_html" };
}

function loadOfficialRecordsForAdmin(admin) {
  return readJson(cachePathForAdmin(admin), { records: [] }).records || [];
}

export async function ingestListingForAdmin(admin, country = "US", { force = false } = {}) {
  const cachePath = listingCachePath(admin);
  if (!force && fs.existsSync(cachePath)) {
    return readJson(cachePath);
  }

  const { listingUrl, wikipediaTitle } = listingUrlForAdmin(admin, country);
  const officialRecords = loadOfficialRecordsForAdmin(admin);
  let listings = [];
  let scrapeMethod = null;
  let listingUrlUsed = listingUrl;
  let htmlListings = [];

  if (WORDPRESS_LISTING_SOURCES[admin]) {
    try {
      const wpListings = await buildListingsFromWordPressApi(admin, country);
      if (wpListings.length >= 5) {
        htmlListings = wpListings;
        listingUrlUsed = WORDPRESS_LISTING_SOURCES[admin].apiUrl;
        scrapeMethod = "official_wordpress_api";
      }
    } catch {
      /* fall through to HTML */
    }
  }

  const urlsToTry = [...(LISTING_FALLBACK_URLS[admin] || []), listingUrl].filter(Boolean);

  if (!htmlListings.length) {
    for (const url of urlsToTry) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(60000),
        headers: { "User-Agent": "scenic-poi-data/SP-001 listing research" },
      });
      const html = await res.text();
      const scraped = await scrapeListingFromHtml(html, { listingUrl: url, admin, country });
      if (scraped?.listings?.length) {
        htmlListings = scraped.listings;
        listingUrlUsed = url;
        break;
      }
    } catch {
      /* try next URL */
    }
    }
  }

  const gisListings = officialRecords.length
    ? buildListingsFromGisUrls(officialRecords, admin, country)
    : [];
  const gisNameListings = officialRecords.length
    ? buildListingsFromGisNames(officialRecords, admin, country)
    : [];

  const pickListings = () => {
    const htmlMethod = scrapeMethod === "official_wordpress_api" ? "official_wordpress_api" : "official_listing_html";
    const options = [
      { listings: htmlListings, method: htmlMethod, min: 5 },
      { listings: gisListings, method: "official_gis_urls", min: 5 },
      { listings: gisNameListings, method: "official_gis_names", min: 3 },
    ];
    const viable = options.filter((o) => o.listings.length >= o.min);
    if (!viable.length) return null;
    viable.sort((a, b) => b.listings.length - a.listings.length);
    return viable[0];
  };

  const picked = pickListings();
  if (picked) {
    listings = picked.listings;
    scrapeMethod = picked.method;
  } else if (htmlListings.length >= 5) {
    listings = htmlListings;
    scrapeMethod = "official_listing_html";
  } else if (gisListings.length >= 5) {
    listings = gisListings;
    scrapeMethod = "official_gis_urls";
  } else if (gisNameListings.length >= 3) {
    listings = gisNameListings;
    scrapeMethod = "official_gis_names";
  }

  let wikiCount = 0;
  if (listings.length < 5 && wikipediaTitle) {
    try {
      const wikitext = await fetchWikipediaWikitext(wikipediaTitle);
      const parsed = parseWikipediaListPage(wikitext);
      wikiCount = parsed.total;
      if (parsed.total >= 5) {
        listings = buildListingEntriesFromWikiNames(parsed.names, { admin, country });
        scrapeMethod = "wikipedia";
      }
    } catch {
      /* no listing */
    }
  }

  if (listings.length >= 5) {
    listings = listings.filter((l) => !isJunkListingName(l.name));
    if (admin === "AZ") {
      listings = listings.filter(
        (l) =>
          !/(volunteer|legislative|board|advisory|employment|donate|contact|ada|site-stewards)/i.test(
            `${l.slug} ${l.pageTitle || ""}`
          )
      );
    }
    const needsCoords = listings.some((l) => l.url && l.lat == null);
    if (shouldEnrichListingPages(admin) || needsCoords) {
      listings = await enrichListingsFromPages(listings, admin);
      scrapeMethod = `${scrapeMethod || "official_listing_html"}+page_enrich`;
    }
    if (listings.some((l) => l.lat == null || l.lon == null)) {
      listings = await enrichListingsFromWikipediaCoords(listings, admin);
      if (listings.some((l) => l.coordSource === "wikipedia_coordinates")) {
        scrapeMethod = scrapeMethod ? `${scrapeMethod}+wiki_coords` : "wikipedia_coordinates";
      }
    }
    listings = applyListingCoordOverrides(listings, admin);
  }

  const payload = {
    generated: new Date().toISOString(),
    admin,
    country,
    listingUrl: listingUrlUsed || listingUrl,
    wikipediaTitle,
    scrapeMethod,
    count: listings.length,
    listings,
    crossCheck: {
      gisRecordCount: officialRecords.length,
      gisWithUrl: officialRecords.filter((r) => r.url).length,
      wikipediaNameCount: wikiCount,
    },
  };
  if (listings.length) saveListingCache(admin, payload);
  return payload;
}

/** True when GIS record centroid is near an aggregated listing record (for dedupe checks). */
export function nearListingRecord(a, b, maxM = 5000) {
  return haversineM({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }) <= maxM;
}
