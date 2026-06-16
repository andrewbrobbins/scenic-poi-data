/**
 * Build fuel-us-supplements.json from known Buc-ee's store list (public addresses).
 * Skips locations already within DEDUPE_MI of fuel-us-master.json.
 */
import {
  MASTER_PATH,
  TOOLS_DIR,
  haversineMi,
  readJson,
  slugify,
  sleep,
  writeJson,
} from "./fuel-us-lib.mjs";

const DEDUPE_MI = 0.12;
const OUT_PATH = `${TOOLS_DIR}/fuel-us-supplements.json`;
const USER_AGENT = "ScenicRouterFuelSupplement/1.0";

/** Store list from Buc-ee's public locations (early 2026). */
const BUCEES_STORES = [
  { city: "Lake Jackson", state: "TX", address: "899 Oyster Creek Drive", zip: "77566" },
  { city: "Lake Jackson", state: "TX", address: "101 N Hwy 2004", zip: "77566" },
  { city: "Brazoria", state: "TX", address: "801 N Brooks", zip: "77422" },
  { city: "Freeport", state: "TX", address: "4231 E. Hwy 332", zip: "77541" },
  { city: "Freeport", state: "TX", address: "1002 N Brazosport Blvd.", zip: "77541" },
  { city: "Port Lavaca", state: "TX", address: "2318 W Main", zip: "77979" },
  { city: "Angleton", state: "TX", address: "2299 E Mulberry St", zip: "77515" },
  { city: "Alvin", state: "TX", address: "780 Hwy-35 N Byp", zip: "77511" },
  { city: "Giddings", state: "TX", address: "2375 E Austin St", zip: "78942" },
  { city: "Luling", state: "TX", address: "10070 West IH 10", zip: "78648" },
  { city: "Waller", state: "TX", address: "40900 US Hwy 290 Bypass", zip: "77484" },
  { city: "Pearland", state: "TX", address: "2541 S Main St", zip: "77584" },
  { city: "Pearland", state: "TX", address: "11151 Shadow Creek Pky", zip: "77584" },
  { city: "Angleton", state: "TX", address: "931 Loop 274", zip: "77515" },
  { city: "New Braunfels", state: "TX", address: "2760 IH 35 North", zip: "78130" },
  { city: "League City", state: "TX", address: "1702 League City Pkwy", zip: "77573" },
  { city: "Eagle Lake", state: "TX", address: "505 E Main St", zip: "77434" },
  { city: "Angleton", state: "TX", address: "2304 W Mulberry St", zip: "77515" },
  { city: "Madisonville", state: "TX", address: "205 IH-45 South", zip: "77864" },
  { city: "Bastrop", state: "TX", address: "1700 Highway 71 East", zip: "78602" },
  { city: "Lake Jackson", state: "TX", address: "598 Hwy 332", zip: "77566" },
  { city: "Wharton", state: "TX", address: "10484 US 59 Road", zip: "77488" },
  { city: "Richmond", state: "TX", address: "1243 Crabb River Rd", zip: "77469" },
  { city: "Cypress", state: "TX", address: "27106 US-290", zip: "77433" },
  { city: "Texas City", state: "TX", address: "6201 Gulf Fwy (IH 45)", zip: "77591" },
  { city: "Baytown", state: "TX", address: "4080 East Freeway", zip: "77521" },
  { city: "Temple", state: "TX", address: "4155 N General Bruce Dr.", zip: "76501" },
  { city: "Terrell", state: "TX", address: "506 W. IH 20", zip: "75160" },
  { city: "Fort Worth", state: "TX", address: "15901 N Freeway", zip: "76177" },
  { city: "Royse City", state: "TX", address: "5005 E Interstate 30", zip: "75189" },
  { city: "Denton", state: "TX", address: "2800 S Interstate 35 E", zip: "76210" },
  { city: "Katy", state: "TX", address: "27700 Katy Fwy", zip: "77494" },
  { city: "Robertsdale", state: "AL", address: "20403 County Rd. 68", zip: "36567" },
  { city: "Leeds", state: "AL", address: "6900 Buc-ee's Blvd.", zip: "35094" },
  { city: "Melissa", state: "TX", address: "1550 Central Texas Expressway", zip: "75454" },
  { city: "Kodak", state: "TN", address: "170 Buc-ee's Blvd", zip: "37764" },
  { city: "Saint Augustine", state: "FL", address: "200 World Commerce Pkwy", zip: "32092" },
  { city: "Daytona Beach", state: "FL", address: "2330 Gateway North Drive", zip: "32117" },
  { city: "Ennis", state: "TX", address: "1402 South IH- 45", zip: "75119" },
  { city: "Crossville", state: "TN", address: "2045 Genesis Road", zip: "38555" },
  { city: "Fort Valley", state: "GA", address: "7001 Russell Parkway", zip: "31030" },
  { city: "Adairsville", state: "GA", address: "601 Union Grove Rd. SE", zip: "30103" },
  { city: "Florence", state: "SC", address: "3390 North Williston Road", zip: "29506" },
  { city: "Richmond", state: "KY", address: "1013 Buc-ee's Boulevard", zip: "40475" },
  { city: "Smiths Grove", state: "KY", address: "4001 Smiths Grove-Scottsville Road", zip: "42171" },
  { city: "Athens", state: "AL", address: "2328 Lindsay Lane South", zip: "35613" },
  { city: "Auburn", state: "AL", address: "2500 Buc-ee's Blvd", zip: "36832" },
  { city: "Hillsboro", state: "TX", address: "165 State Highway 77", zip: "76645" },
  { city: "Berthoud", state: "CO", address: "5201 Nugget Road", zip: "80513" },
  { city: "Pass Christian", state: "MS", address: "8245 Firetower Road", zip: "39571" },
  { city: "Springfield", state: "MO", address: "3284 N Beaver Rd", zip: "65803" },
  { city: "Brunswick", state: "GA", address: "6900 Hwy 99", zip: "31525" },
  { city: "Amarillo", state: "TX", address: "9900 East Interstate 40", zip: "79118" },
  { city: "Mount Crawford", state: "VA", address: "6500 Buc-ee's Blvd", zip: "22841" },
  { city: "Goodyear", state: "AZ", address: "5525 N Dysart Rd", zip: "85338" },
];

async function geocodePhoton(store) {
  const q = `Buc-ee's, ${store.address}, ${store.city}, ${store.state}`;
  const url = `https://photon.komoot.io/api/?${new URLSearchParams({ q, limit: "1", lang: "en" })}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const f = data.features?.[0];
  if (!f) return null;
  const [lon, lat] = f.geometry.coordinates;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, display: q };
}

async function geocodeNominatim(store) {
  const q = `Buc-ee's, ${store.address}, ${store.city}, ${store.state} ${store.zip}`;
  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
    format: "json",
    q,
    limit: "1",
    countrycodes: "us",
  })}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return null;
  const data = await res.json();
  const hit = data[0];
  if (!hit) return null;
  const lat = parseFloat(hit.lat);
  const lon = parseFloat(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, display: hit.display_name };
}

async function geocodeStore(store) {
  const nom = await geocodeNominatim(store);
  if (nom) return nom;
  return geocodePhoton(store);
}

function nearExisting(lat, lon, existing) {
  for (const rec of existing) {
    if (rec.brandId !== "bucees") continue;
    if (haversineMi([lat, lon], [rec.lat, rec.lon]) <= DEDUPE_MI) return true;
  }
  return false;
}

export async function buildFuelSupplements() {
  const master = readJson(MASTER_PATH);
  const existing = master?.records ?? [];
  const records = [];
  const skipped = [];

  for (const store of BUCEES_STORES) {
    const geo = await geocodeStore(store);
    await sleep(1100);
    if (!geo) {
      skipped.push({ store, reason: "geocode-failed" });
      continue;
    }
    if (nearExisting(geo.lat, geo.lon, existing)) {
      skipped.push({ store, reason: "near-existing", lat: geo.lat, lon: geo.lon });
      continue;
    }
    if (nearExisting(geo.lat, geo.lon, records)) {
      skipped.push({ store, reason: "duplicate-supplement" });
      continue;
    }
    const name = `Buc-ee's — ${store.city}`;
    records.push({
      id: `FUEL-BUCEES-${store.state}-${slugify(store.city)}-${slugify(store.address)}-supp`,
      name,
      brand: "Buc-ee's",
      brandId: "bucees",
      brandTier: "A",
      type: "travel_center",
      state: store.state,
      lat: geo.lat,
      lon: geo.lon,
      highway: "",
      fuels: { gasoline: true, diesel: false },
      sources: ["supplement", "bucees-public-list"],
      mapFlags: ["SUPPLEMENT"],
      reviewReasons: [],
      needsReview: false,
      manualVerified: true,
      url: "https://www.buc-ees.com/",
    });
    console.log(`+ ${store.city}, ${store.state}`);
  }

  const payload = {
    generated: new Date().toISOString(),
    source: "Buc-ee's public store list + Nominatim geocode",
    recordCount: records.length,
    skippedCount: skipped.length,
    records,
  };
  writeJson(OUT_PATH, payload);
  console.log(`Wrote ${OUT_PATH}: ${records.length} supplements (${skipped.length} skipped)`);
  return payload;
}

if (process.argv[1]?.endsWith("build-fuel-us-supplements.mjs")) {
  buildFuelSupplements().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
