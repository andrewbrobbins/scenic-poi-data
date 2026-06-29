/**
 * Per-state official park listing scrape adapters (SP-001).
 * Website park finder is source of truth; GIS URLs and Wikipedia are fallbacks.
 */
import { normalizeName, slugify } from "./state-parks-lib.mjs";

/** Nav slugs to ignore across state park websites. */
export const SKIP_LISTING_SLUGS = new Set([
  "find-a-park",
  "parks-map",
  "park-information",
  "parks",
  "reservations",
  "gallery",
  "events",
  "passes",
  "park-reservation-information",
  "parks-and-trails",
  "state-parks",
  "find-parks",
  "park-finder",
  "park-locator",
  "index",
  "search",
  "visit",
  "default",
  "default.aspx",
  "activities",
  "banners",
  "birding",
  "clubs",
  "features",
  "maps",
  "permits",
  "rules",
  "fees",
  "ada",
  "donate",
  "employment",
  "contact-us",
  "find-a-park",
  "agency-legislative-services",
  "arizona-state-parks-board",
  "advisory-committees",
]);

export function slugToListingKey(slug) {
  return (slug || "")
    .replace(/^state-parks\//, "")
    .replace(/^(page|park)-/, "")
    .replace(/-/g, " ")
    .trim()
    .toLowerCase();
}

/** Alternate listing URLs when the primary finder page is JS-rendered. */
export const LISTING_FALLBACK_URLS = {
  TX: ["https://tpwd.texas.gov/state-parks/parks-map"],
  FL: ["https://www.floridastateparks.org/parks-and-trails"],
  CA: ["https://www.parks.ca.gov/ParkList"],
  NC: ["https://www.ncparks.gov/state-parks"],
  WA: ["https://parks.wa.gov/find-parks"],
  SC: ["https://southcarolinaparks.com/park-finder"],
  UT: ["https://stateparks.utah.gov/find-a-park/"],
  OR: ["https://stateparks.oregon.gov/index.cfm?do=visit.find"],
  NY: ["https://parks.ny.gov/parks/"],
  PA: ["https://www.dcnr.pa.gov/StateParks/FindAPark/Pages/default.aspx"],
  TN: ["https://tnstateparks.com/parks"],
  MO: ["https://mostateparks.com/park"],
  MN: ["https://www.dnr.state.mn.us/state_parks/list/index.html"],
  NE: ["https://outdoornebraska.gov/stateparks/"],
  AK: ["https://dnr.alaska.gov/parks/asp"],
  DE: ["https://destateparks.com/FindAStatePark"],
  NV: ["https://parks.nv.gov/parks"],
  RI: ["https://riparks.ri.gov/parks"],
  SD: ["https://gfp.sd.gov/parks/"],
  VT: ["https://vtstateparks.com/find.html"],
  WV: ["https://wvstateparks.com/"],
  WI: ["https://dnr.wisconsin.gov/topic/parks/findpark"],
  GA: ["https://gastateparks.org/Parks"],
  MI: ["https://www.michigan.gov/dnr/places/state-parks"],
  VA: ["https://www.dcr.virginia.gov/state-parks/find-a-park"],
  CT: ["https://portal.ct.gov/deep/state-parks"],
  MD: ["https://dnr.maryland.gov/publiclands/Pages/default.aspx"],
  AZ: ["https://azstateparks.com/find-a-park/"],
  AL: ["https://www.alapark.com/map-of-parks", "https://www.alapark.com/parks"],
  KY: ["https://parks.ky.gov/parks"],
  OK: ["https://www.travelok.com/state-parks"],
  LA: ["https://www.lastateparks.com/", "https://www.lastateparks.com/parks-preserves"],
  ME: ["https://www.maine.gov/dacf/parks/"],
  HI: ["https://dlnr.hawaii.gov/dsp/parks/"],
  ID: ["https://parksandrecreation.idaho.gov/find-a-park/", "https://parksandrecreation.idaho.gov/parks/"],
  KS: ["https://ksoutdoors.com/State-Parks"],
};

/** GIS unit → parent listing slug overrides (visitor centers, etc.). */
export const GIS_LISTING_OVERRIDES = {
  TX: { "barton warnock": "big-bend-ranch" },
};

/** Alternate Wikipedia article titles for coordinate lookup (slug → titles). */
export const WIKIPEDIA_COORD_ALTS = {
  AL: {
    "bucks-pocket-state-park": ["Buck's Pocket State Park"],
    "desoto-state-park": ["DeSoto State Park"],
    "paul-grist-state-park": ["Paul M. Grist State Park"],
    "lake-jackson-rv-park-at-florala": ["Florala State Park"],
  },
  LA: {
    "lake-bruin": ["Lake Bruin State Park"],
    "grand-isle": ["Grand Isle State Park (Louisiana)"],
    "south-toledo-bend": ["South Toledo Bend State Park"],
    "st-bernard": ["St. Bernard State Park", "Saint Bernard State Park"],
    "tickfaw": ["Tickfaw State Park"],
  },
  ID: {
    "city-of-rocks-national-reserve": ["City of Rocks National Reserve", "City of Rocks Idaho"],
    "coeur-dalenes-old-mission-state-park": [
      "Coeur d'Alene's Old Mission State Park",
      "Old Mission State Park",
      "Cataldo Mission",
    ],
    "twin-peaks-ranch-state-park": ["Twin Peaks Ranch State Park"],
    "ashton-to-tetonia-trail": ["Ashton to Tetonia Trail"],
    "trail-of-the-coeur-dalenes": ["Trail of the Coeur d'Alenes"],
    "coeur-dalene-parkway": ["Coeur d'Alene Parkway", "Coeur d'Alene Parkway State Park"],
  },
};

/** Manual lat/lon when agency pages and Wikipedia lack coordinates. */
export const LISTING_COORD_OVERRIDES = {
  ID: {
    "city-of-rocks-national-reserve": { lat: 42.0747, lon: -113.7258, source: "city_of_rocks_idaho_centroid" },
    "coeur-dalenes-old-mission-state-park": { lat: 47.5481, lon: -116.3622, source: "old_mission_cataldo" },
    "twin-peaks-ranch-state-park": { lat: 45.156, lon: -113.895, source: "twin_peaks_ranch_us93" },
    "coeur-dalene-parkway": { lat: 47.652, lon: -116.756, source: "coeur_dalene_parkway_midpoint" },
    "ashton-to-tetonia-trail": { lat: 44.0716, lon: -111.4483, source: "wikipedia_trail_midpoint" },
    "trail-of-the-coeur-dalenes": { lat: 47.5097, lon: -116.5369, source: "wikipedia_trail_midpoint" },
  },
};

/** Listing slugs that are visitor centers, not standalone pins. */
export const LISTING_VISITOR_CENTER_PARENT = {
  TX: { "barton-warnock": "big-bend-ranch" },
};

/**
 * HTML slug extractors: regex on listing page HTML + base URL for park pages.
 * slugGroup: capture group index (default 1).
 */
export const HTML_LISTING_ADAPTERS = {
  TX: {
    slugPattern: /state-parks\/([a-z0-9][a-z0-9-]*)/gi,
    baseUrl: "https://tpwd.texas.gov/state-parks",
    enrichPages: true,
  },
  NC: {
    slugPattern: /\/state-parks\/([a-z0-9][a-z0-9-]*)/gi,
    baseUrl: "https://www.ncparks.gov/state-parks",
  },
  WA: {
    slugPattern: /\/find-parks\/state-parks\/([a-z0-9-]+)/gi,
    baseUrl: "https://parks.wa.gov/find-parks/state-parks",
  },
  MO: {
    slugPattern: /\/park\/([a-z0-9-]+)/gi,
    baseUrl: "https://mostateparks.com/park",
  },
  FL: {
    slugPattern: /parks-and-trails\/([a-z0-9-]+)/gi,
    baseUrl: "https://www.floridastateparks.org/parks-and-trails",
  },
  SC: {
    slugPattern: /\/parks\/([a-z0-9-]+)/gi,
    baseUrl: "https://southcarolinaparks.com/parks",
  },
  UT: {
    slugPattern: /\/parks\/([a-z0-9-]+)/gi,
    baseUrl: "https://stateparks.utah.gov/parks",
  },
  TN: {
    slugPattern: /tnstateparks\.com\/parks\/([a-z0-9-]+)/gi,
    baseUrl: "https://tnstateparks.com/parks",
  },
  OR: {
    slugPattern: /index\.cfm\?do=park\.load&parkId=(\d+)/gi,
    baseUrl: "https://stateparks.oregon.gov/index.cfm?do=park.load&parkId=",
    slugFromMatch: (m) => `park-${m[1]}`,
    urlFromSlug: (slug) => `https://stateparks.oregon.gov/index.cfm?do=park.load&parkId=${slug.replace(/^park-/, "")}`,
  },
  CA: {
    slugPattern: /page_id=(\d+)/gi,
    baseUrl: "https://www.parks.ca.gov/",
    slugFromMatch: (m) => `page-${m[1]}`,
    urlFromSlug: (slug) => `https://www.parks.ca.gov/?page_id=${slug.replace(/^page-/, "")}`,
  },
  NY: {
    slugPattern: /parks\.ny\.gov\/parks\/([a-z0-9]+)/gi,
    baseUrl: "https://parks.ny.gov/parks/",
  },
  PA: {
    slugPattern: /\/StateParks\/FindAPark\/([A-Za-z0-9]+)\//gi,
    baseUrl: "https://www.dcnr.pa.gov/StateParks/FindAPark/",
  },
  AR: {
    slugPattern: /arkansasstateparks\.com\/parks\/([a-z0-9-]+)/gi,
    baseUrl: "https://www.arkansasstateparks.com/parks",
  },
  IN: {
    slugPattern: /in\.gov\/dnr\/state-parks\/([a-z0-9-]+)/gi,
    baseUrl: "https://www.in.gov/dnr/state-parks",
  },
  NE: {
    slugPattern: /outdoornebraska\.gov\/([a-z0-9-]+statepark)/gi,
    baseUrl: "https://outdoornebraska.gov/",
  },
  ND: {
    slugPattern: /parkrec\.nd\.gov\/([a-z0-9-]+)/gi,
    baseUrl: "https://www.parkrec.nd.gov",
  },
  AK: {
    slugPattern: /dnr\.alaska\.gov\/parks\/([a-z0-9-]+)/gi,
    baseUrl: "https://dnr.alaska.gov/parks",
  },
  AB: {
    slugPattern: /albertaparks\.ca\/[^/]+\/([a-z0-9-]+)/gi,
    baseUrl: "https://www.albertaparks.ca",
  },
  ON: {
    slugPattern: /ontarioparks\.ca\/park\/([a-z0-9-]+)/gi,
    baseUrl: "https://www.ontarioparks.ca/park",
  },
  WV: {
    slugPattern: /wvstateparks\.com\/park\/([a-z0-9-]+)/gi,
    baseUrl: "https://wvstateparks.com/park",
  },
  VT: {
    slugPattern: /vtstateparks\.com\/([a-z0-9]+)\.html/gi,
    baseUrl: "https://vtstateparks.com",
    urlFromSlug: (slug) => `https://vtstateparks.com/${slug}.html`,
  },
  WI: {
    slugPattern: /dnr\.wisconsin\.gov\/topic\/parks\/([a-z0-9]+)/gi,
    baseUrl: "https://dnr.wisconsin.gov/topic/parks",
  },
  GA: {
    slugPattern: /gastateparks\.org\/parks\/([a-z0-9-]+)/gi,
    baseUrl: "https://gastateparks.org/parks",
    enrichPages: true,
  },
  MI: {
    slugPattern: /\/dnr\/places\/state-parks\/([a-z0-9-]+)/gi,
    baseUrl: "https://www.michigan.gov/dnr/places/state-parks",
    enrichPages: true,
  },
  VA: {
    slugPattern: /dcr\.virginia\.gov\/state-parks\/([a-z0-9-]+)/gi,
    baseUrl: "https://www.dcr.virginia.gov/state-parks",
    enrichPages: true,
  },
  MD: {
    slugPattern: /publiclands\/Pages\/[^/]+\/([a-z0-9-]+)\.aspx/gi,
    baseUrl: "https://dnr.maryland.gov/publiclands/Pages",
    enrichPages: true,
  },
  AZ: {
    slugPattern: /azstateparks\.com\/([a-z0-9-]+)/gi,
    baseUrl: "https://azstateparks.com",
    enrichPages: true,
  },
  AL: {
    slugPattern: /\/parks\/([a-z0-9-]+)/gi,
    baseUrl: "https://www.alapark.com/parks",
    enrichPages: true,
  },
  KY: {
    slugPattern: /parks\.ky\.gov\/parks\/([a-z0-9-]+)/gi,
    baseUrl: "https://parks.ky.gov/parks",
    enrichPages: true,
  },
  LA: {
    slugPattern: /lastateparks\.com\/parks-preserves\/([a-z0-9-]+)/gi,
    baseUrl: "https://www.lastateparks.com/parks-preserves",
    urlFromSlug: (slug) => `https://www.lastateparks.com/parks-preserves/${slug}`,
    enrichPages: true,
  },
  OK: {
    slugPattern: /travelok\.com\/state-parks\/([a-z0-9-]+)/gi,
    baseUrl: "https://www.travelok.com/state-parks",
    enrichPages: true,
  },
  ID: {
    slugPattern: /\/state-park\/([a-z0-9-]+)/gi,
    baseUrl: "https://parksandrecreation.idaho.gov/state-park",
    enrichPages: true,
  },
};

/** WordPress REST park catalogs (custom post type). */
export const WORDPRESS_LISTING_SOURCES = {
  ID: {
    apiUrl: "https://parksandrecreation.idaho.gov/wp-json/wp/v2/state-park?per_page=100",
    linkPrefix: "https://parksandrecreation.idaho.gov/state-park",
  },
};

function decodeHtmlEntities(text) {
  return (text || "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8211;|&ndash;/g, "–")
    .trim();
}

function classifyIdahoListing(title, slug) {
  if (/old mission|historic site/i.test(title) || /old-mission/i.test(slug)) {
    return { category: "historic_site", designation: "State Historic Site", alsoHistoricSite: true };
  }
  if (/national reserve/i.test(title)) {
    return { category: "park", designation: "National Reserve" };
  }
  if (/trail|parkway/i.test(slug) && !/state park/i.test(title)) {
    return { category: "park", designation: "State Trail" };
  }
  return { category: "park", designation: "State Park" };
}

export async function buildListingsFromWordPressApi(admin, country = "US") {
  const src = WORDPRESS_LISTING_SOURCES[admin];
  if (!src) return [];

  const res = await fetch(src.apiUrl, {
    signal: AbortSignal.timeout(60000),
    headers: { "User-Agent": "scenic-poi-data/SP-001 listing research" },
  });
  if (!res.ok) return [];
  const posts = await res.json();
  if (!Array.isArray(posts)) return [];

  const listings = [];
  for (const post of posts) {
    const slug = (post.slug || "").toLowerCase();
    if (!slug || SKIP_LISTING_SLUGS.has(slug)) continue;
    const title = decodeHtmlEntities(post.title?.rendered || "");
    if (!title) continue;
    const url = (post.link || `${src.linkPrefix}/${slug}/`).split("?")[0];
    const key = slugToListingKey(slug.replace(/-state-park$/, ""));
    const cls = admin === "ID" ? classifyIdahoListing(title, slug) : { category: "park", designation: "State Park" };
    listings.push({
      slug,
      key,
      name: title.replace(/\s+(State Park|State Historic Site|National Reserve|State Trail)$/i, "").trim() || title,
      url,
      admin,
      country,
      source: "official_wordpress_api",
      pageTitle: title,
      ...cls,
    });
  }
  listings.sort((a, b) => a.name.localeCompare(b.name));
  return listings;
}

/** Parse official park page URL → listing slug (for GIS records with embedded URLs). */
export const GIS_URL_PATTERNS = {
  CA: /[?&]page_id=(\d+)/i,
  FL: /parks-and-trails\/([a-z0-9-]+)/i,
  MO: /\/park\/([a-z0-9-]+)/i,
  WA: /\/find-parks\/state-parks\/([a-z0-9-]+)/i,
  NC: /\/state-parks\/([a-z0-9-]+)/i,
  SC: /\/parks\/([a-z0-9-]+)/i,
  UT: /\/parks\/([a-z0-9-]+)/i,
  TN: /tnstateparks\.com\/parks\/([a-z0-9-]+)/i,
  OR: /parkId=(\d+)/i,
  NY: /parks\.ny\.gov\/parks\/([a-z0-9]+)/i,
  TX: /state-parks\/([a-z0-9-]+)/i,
  WI: /topic\/parks\/([^/?]+)/i,
  WV: /wvstateparks\.com\/park\/([a-z0-9-]+)/i,
  MD: /publiclands\/Pages\/[^/]+\/([a-z0-9-]+)\.aspx/i,
  GA: /gastateparks\.org\/parks\/([a-z0-9-]+)/i,
  VA: /dcr\.virginia\.gov\/state-parks\/([a-z0-9-]+)/i,
  KY: /parks\.ky\.gov\/[^/]+\/parks\/(?:historic|recreation|resort)\/([a-z0-9-]+)/i,
};

const KY_URL_SLUG_SUFFIX = /-(?:state-(?:resort-)?park|state-historic-site)$/i;

export function slugFromGisUrl(url, admin) {
  if (!url) return null;
  const pattern = GIS_URL_PATTERNS[admin];
  if (!pattern) return null;
  const m = url.match(pattern);
  if (!m) return null;
  if (admin === "CA" || admin === "OR") return `${admin === "CA" ? "page" : "park"}-${m[1]}`;
  if (admin === "KY") return m[1].toLowerCase().replace(KY_URL_SLUG_SUFFIX, "");
  return m[1].toLowerCase();
}

export function scrapeSlugsFromHtml(html, admin) {
  const adapter = HTML_LISTING_ADAPTERS[admin];
  if (!adapter?.slugPattern) return [];
  const slugs = new Set();
  const re = new RegExp(adapter.slugPattern.source, adapter.slugPattern.flags);
  for (const m of html.matchAll(re)) {
    const slug = adapter.slugFromMatch ? adapter.slugFromMatch(m) : m[1].toLowerCase();
    if (slug.length < 2 || SKIP_LISTING_SLUGS.has(slug)) continue;
    slugs.add(slug);
  }
  return [...slugs].sort();
}

export function buildListingEntryFromSlug(slug, admin, country, adapter) {
  const key = slugToListingKey(slug.replace(/^page-|^park-/, "").replace(/-/g, " "));
  const name = key
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  const url = adapter.urlFromSlug
    ? adapter.urlFromSlug(slug)
    : `${adapter.baseUrl.replace(/\/$/, "")}/${slug}`;
  return { slug, key, name, url, admin, country, source: "official_listing" };
}

export function buildListingsFromHtml(html, admin, country = "US") {
  const adapter = HTML_LISTING_ADAPTERS[admin];
  if (!adapter) return [];
  const slugs = scrapeSlugsFromHtml(html, admin);
  return slugs.map((slug) => buildListingEntryFromSlug(slug, admin, country, adapter));
}

export function buildListingsFromGisUrls(officialRecords, admin, country = "US") {
  const adapter = HTML_LISTING_ADAPTERS[admin];
  const bySlug = new Map();

  for (const rec of officialRecords) {
    if (rec.state !== admin || !rec.url) continue;
    const slug = slugFromGisUrl(rec.url, admin);
    if (!slug || SKIP_LISTING_SLUGS.has(slug)) continue;

    const group = bySlug.get(slug) || {
      slug,
      key: slugToListingKey(slug.replace(/^page-|^park-/, "")),
      name: rec.name.replace(/\s+(State|Provincial)\s+(Park|Historic Site).*$/i, "").trim(),
      url: rec.url.split("?")[0].includes("page_id")
        ? rec.url
        : adapter?.urlFromSlug
          ? adapter.urlFromSlug(slug)
          : rec.url,
      admin,
      country,
      source: "official_gis_url",
      lats: [],
      lons: [],
      categories: new Set(),
    };
    group.lats.push(rec.lat);
    group.lons.push(rec.lon);
    if (rec.category) group.categories.add(rec.category);
    if (rec.name.length > group.name.length) group.name = rec.name.replace(/\s+(State|Provincial)\s+(Park|Historic Site).*$/i, "").trim();
    bySlug.set(slug, group);
  }

  return [...bySlug.values()].map((g) => {
    const lat = g.lats.reduce((a, b) => a + b, 0) / g.lats.length;
    const lon = g.lons.reduce((a, b) => a + b, 0) / g.lons.length;
    const category = g.categories.has("historic_site") && !g.categories.has("park") ? "historic_site" : "park";
    return {
      slug: g.slug,
      key: g.key,
      name: g.name,
      url: g.url,
      admin: g.admin,
      country: g.country,
      source: g.source,
      lat: Math.round(lat * 1e5) / 1e5,
      lon: Math.round(lon * 1e5) / 1e5,
      coordSource: "official_gis",
      category,
      gisUnitCount: g.lats.length,
    };
  });
}

/** Listing entries from official GIS records grouped by normalized park name (no URL required). */
export function buildListingsFromGisNames(officialRecords, admin, country = "US") {
  const byKey = new Map();

  for (const rec of officialRecords) {
    if (rec.state !== admin || !rec.name) continue;
    const key = listingKeyFromPublicName(rec.name);
    if (!key) continue;
    const slug = slugify(key);

    const group = byKey.get(key) || {
      slug,
      key,
      name: rec.name.replace(/\s+(State|Provincial)\s+(Park|Historic Site).*$/i, "").trim(),
      url: rec.url || undefined,
      admin,
      country,
      source: "official_gis_name",
      lats: [],
      lons: [],
      categories: new Set(),
    };
    group.lats.push(rec.lat);
    group.lons.push(rec.lon);
    if (rec.category) group.categories.add(rec.category);
    if (rec.name.length > group.name.length) {
      group.name = rec.name.replace(/\s+(State|Provincial)\s+(Park|Historic Site).*$/i, "").trim();
    }
    if (rec.url && !group.url) group.url = rec.url;
    byKey.set(key, group);
  }

  return [...byKey.values()].map((g) => {
    const lat = g.lats.reduce((a, b) => a + b, 0) / g.lats.length;
    const lon = g.lons.reduce((a, b) => a + b, 0) / g.lons.length;
    const category = g.categories.has("historic_site") && !g.categories.has("park") ? "historic_site" : "park";
    return {
      slug: g.slug,
      key: g.key,
      name: g.name,
      url: g.url,
      admin: g.admin,
      country: g.country,
      source: g.source,
      lat: Math.round(lat * 1e5) / 1e5,
      lon: Math.round(lon * 1e5) / 1e5,
      coordSource: "official_gis",
      category,
      gisUnitCount: g.lats.length,
    };
  });
}

export function shouldEnrichListingPages(admin) {
  return HTML_LISTING_ADAPTERS[admin]?.enrichPages === true || admin === "TX";
}

export function titleCaseFromKey(key) {
  return (key || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function listingKeyFromPublicName(publicName) {
  if (!publicName) return "";
  let n = publicName
    .replace(/\s+(State|Provincial)\s+(Park|Historic Site|Natural Area).*$/i, "")
    .replace(/\s+(SP|SHP|SB|SRA|SMR|SVRA|SNR|SHM)$/i, "")
    .replace(/\s+and Trailway$/i, "")
    .trim();
  return normalizeName(n);
}
