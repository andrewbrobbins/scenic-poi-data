/**
 * Fetch and parse Buc-ee's official store list from buc-ees.com/locations/.
 * Coordinates come from schema.org JSON-LD embedded in the page.
 */
import { coordValid } from "./fuel-us-lib.mjs";

export const BUCEES_LOCATIONS_URL = "https://buc-ees.com/locations/";
export const BUCEES_CONTACT_URL = "https://www.buc-ees.com/contact/";
export const USER_AGENT = "ScenicRouterFuelBucees/1.0 (+https://github.com/andrewbrobbins/scenic-poi-data)";

const STATE_ABBR = {
  Alabama: "AL",
  Alaska: "AK",
  Arizona: "AZ",
  Arkansas: "AR",
  California: "CA",
  Colorado: "CO",
  Connecticut: "CT",
  Delaware: "DE",
  Florida: "FL",
  Georgia: "GA",
  Hawaii: "HI",
  Idaho: "ID",
  Illinois: "IL",
  Indiana: "IN",
  Iowa: "IA",
  Kansas: "KS",
  Kentucky: "KY",
  Louisiana: "LA",
  Maine: "ME",
  Maryland: "MD",
  Massachusetts: "MA",
  Michigan: "MI",
  Minnesota: "MN",
  Mississippi: "MS",
  Missouri: "MO",
  Montana: "MT",
  Nebraska: "NE",
  Nevada: "NV",
  "New Hampshire": "NH",
  "New Jersey": "NJ",
  "New Mexico": "NM",
  "New York": "NY",
  "North Carolina": "NC",
  "North Dakota": "ND",
  Ohio: "OH",
  Oklahoma: "OK",
  Oregon: "OR",
  Pennsylvania: "PA",
  "Rhode Island": "RI",
  "South Carolina": "SC",
  "South Dakota": "SD",
  Tennessee: "TN",
  Texas: "TX",
  Utah: "UT",
  Vermont: "VT",
  Virginia: "VA",
  Washington: "WA",
  "West Virginia": "WV",
  Wisconsin: "WI",
  Wyoming: "WY",
};

export function decodeHtmlEntities(s) {
  return (s || "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#8211;/g, "–")
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'");
}

/** @returns {{ storeNumber: number|null, label: string, city: string, state: string }} */
export function parseStoreTitle(name) {
  const label = decodeHtmlEntities(name).trim();
  const m = label.match(/^#(\d+)\s*[–-]\s*(.+)$/);
  if (!m) return { storeNumber: null, label, city: label, state: "" };
  const tail = m[2].trim();
  const parts = tail.split(",").map((p) => p.trim());
  const state = parts.length > 1 ? parts[parts.length - 1] : "";
  const city = parts.length > 1 ? parts.slice(0, -1).join(", ") : tail;
  return { storeNumber: Number(m[1]), label, city, state };
}

export function stateAbbr(region) {
  const r = (region || "").trim();
  if (!r) return "";
  if (r.length === 2) return r.toUpperCase();
  return STATE_ABBR[r] || "";
}

function normalizeStore(dept) {
  const title = parseStoreTitle(dept.name);
  const addr = dept.address || {};
  const lat = parseFloat(dept.geo?.latitude);
  const lon = parseFloat(dept.geo?.longitude);
  const state = stateAbbr(addr.addressRegion) || title.state;
  const amenities = (dept.amenityFeature || []).map((a) => ({
    name: a.name || "",
    description: a.description || "",
  }));
  return {
    storeNumber: title.storeNumber,
    label: title.label,
    city: addr.addressLocality || title.city,
    state,
    street: addr.streetAddress || "",
    zip: addr.postalCode || "",
    lat,
    lon,
    amenities,
    sourceUrl: BUCEES_LOCATIONS_URL,
  };
}

function extractDepartmentJsonLd(html) {
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/gi)];
  for (const m of scripts) {
    const raw = m[1].trim();
    if (!raw.includes('"department"')) continue;
    return JSON.parse(raw);
  }
  throw new Error("No Buc-ee's location JSON-LD found on page");
}

/** Count visible #N store headings on the locations page (cross-check for JSON-LD). */
export function countHtmlStoreList(html) {
  const nums = [
    ...html.matchAll(/<h4>\s*#(\d+)\s*(?:&#8211;|–|-)/gi),
  ].map((m) => Number(m[1]));
  return {
    count: nums.length,
    uniqueNumbers: [...new Set(nums)].sort((a, b) => a - b),
    highestNumber: nums.length ? Math.max(...nums) : null,
  };
}

/** Parse announced future openings from buc-ees.com/contact/ (no coordinates). */
export function parseFutureOpenings(contactHtml) {
  const block = contactHtml.match(
    /Estimated opening dates below[\s\S]*?<ul>([\s\S]*?)<\/ul>/i
  );
  if (!block) return [];
  const items = [...block[1].matchAll(/<li>([^<]+)<\/li>/gi)].map((m) =>
    decodeHtmlEntities(m[1].trim())
  );
  return items.map((label) => {
    const m = label.match(/^(.+?)\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}|\d{4})$/i);
    return m ? { city: m[1].trim(), opening: m[2].trim(), label } : { city: label, opening: "", label };
  });
}

async function fetchFutureOpenings() {
  try {
    const res = await fetch(BUCEES_CONTACT_URL, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return { count: 0, items: [], source: BUCEES_CONTACT_URL, error: `HTTP ${res.status}` };
    const items = parseFutureOpenings(await res.text());
    return { count: items.length, items, source: BUCEES_CONTACT_URL };
  } catch (e) {
    return { count: 0, items: [], source: BUCEES_CONTACT_URL, error: String(e.message || e) };
  }
}

/**
 * @param {string} [html] Optional pre-fetched HTML (for tests).
 */
export async function fetchOfficialBuceesLocations(html) {
  let page = html;
  if (!page) {
    const res = await fetch(BUCEES_LOCATIONS_URL, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new Error(`Buc-ee's locations fetch failed: HTTP ${res.status}`);
    page = await res.text();
  }

  const root = extractDepartmentJsonLd(page);
  const departments = root.department || [];
  const stores = [];
  const skipped = [];

  for (const dept of departments) {
    if (dept["@type"] !== "GasStation") continue;
    const store = normalizeStore(dept);
    if (!coordValid(store.lat, store.lon)) {
      skipped.push({ name: dept.name, reason: "invalid-coords" });
      continue;
    }
    stores.push(store);
  }

  stores.sort((a, b) => {
    if (a.storeNumber != null && b.storeNumber != null) return a.storeNumber - b.storeNumber;
    return `${a.state}-${a.city}`.localeCompare(`${b.state}-${b.city}`);
  });

  const htmlList = countHtmlStoreList(page);
  const storeNumbers = stores.map((s) => s.storeNumber).filter((n) => n != null);
  const maxNum = storeNumbers.length ? Math.max(...storeNumbers) : null;
  const gaps =
    maxNum != null
      ? [...Array(maxNum).keys()].map((i) => i + 1).filter((n) => !storeNumbers.includes(n))
      : [];
  const futureOpenings = await fetchFutureOpenings();

  return {
    generated: new Date().toISOString(),
    source: BUCEES_LOCATIONS_URL,
    storeCount: stores.length,
    skippedCount: skipped.length,
    skipped,
    stores,
    audit: {
      note:
        "Open stores only — parsed from schema.org JSON-LD on /locations/. No size/mega filtering. Store numbers have gaps (retired/unused numbers).",
      htmlListCount: htmlList.count,
      jsonLdCount: stores.length,
      htmlJsonLdMatch: htmlList.count === stores.length,
      highestStoreNumber: maxNum,
      unusedStoreNumbers: gaps,
      futureOpeningsCount: futureOpenings.count,
      futureOpeningsSource: futureOpenings.source,
      futureOpenings: futureOpenings.items,
      openPlusAnnounced: stores.length + futureOpenings.count,
    },
  };
}
