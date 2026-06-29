# State parks listing workflow (SP-001)

How we build **one catalog pin per officially listed park** — proven on Texas, extended to all Tier-A states.

## Problem

Official GIS boundary layers often include:

- **Sub-units** (trailways, visitor centers, lake units) as separate polygons
- **Non-park features** (WMAs, hatcheries, unlisted boundaries)
- **Extra polygons** not on the agency’s public park finder

OpenStreetMap adds false positives (operator tags, incomplete names).

**Source of truth:** the state agency’s **public park listing** (website A–Z / park finder).  
**Secondary:** Wikipedia list pages.  
**Coordinates:** GIS boundaries when available; official park page lat/lon when not.

## Texas reference pipeline (what we built)

| Step | Script | Output |
|------|--------|--------|
| 1. Official GIS | `build-state-parks-ingest-official.mjs --state=TX` | `state-parks-ingest/01-official/tx.json` (108 polygons) |
| 2. Website allowlist | `build-state-parks-ingest-listings.mjs --state=TX --refresh` | `state-parks-ingest/02-listings/tx.json` (92 slugs from [parks-map](https://tpwd.texas.gov/state-parks/parks-map)) |
| 3. Master merge | `build-state-parks-master.mjs` | One pin per listed park; GIS units merged |
| 4. Cross-check | `build-state-parks-cross-check.mjs` | Compare master vs listing vs GIS counts |
| 5. Validate | `validate-state-parks.mjs` | Leakage, embed count, coords |

### Texas rules encoded in code

1. **Allowlist** — only parks on TPWD parks-map (not raw GIS count).
2. **Unit merge** — Caprock + Trailway, Choke Canyon units, Ray Roberts units → one pin each.
3. **Visitor centers** — Barton Warnock VC polygon → merged into Big Bend Ranch (not its own pin).
4. **Gap fill** — 8 parks on website without GIS boundaries → coords from park page `Latitude:`/`Longitude:`.
5. **Historic sites** — Fort Leaton = historic-only; Seminole Canyon = **park + historic** (`alsoHistoricSite`, both explorer layers).
6. **No OSM** — Tier-A states with listing-backed records (e.g. TX) drop OSM supplements.
7. **OSM fallback** — Tier-A states where listing + GIS produce **zero** records fall back to filtered OSM (explicit park names only).

**Result:** 91 pins (85 parks + 5 park+historic + 1 historic-only) vs old 121 (108 GIS + 13 OSM).

## All Tier-A states

Run the full listing-backed pipeline:

```bash
# 1. Refresh official GIS caches (network; skip if caches current)
node build-state-parks-ingest-official.mjs --refresh

# 2. Build website allowlists for all Tier-A states
node build-state-parks-ingest-listings.mjs --tier-a --refresh

# 3. Rebuild master + embed + cross-check
node build-state-parks-all.mjs
```

Single state:

```bash
node build-state-parks-ingest-listings.mjs --refresh --state=FL,CA,NC
node build-state-parks-master.mjs
node build-state-parks-cross-check.mjs
```

## Listing ingest priority (per state)

For each admin, `build-state-parks-ingest-listings.mjs` tries:

1. **HTML scrape** — state-specific URL patterns in `state-parks-listing-adapters.mjs` (`HTML_LISTING_ADAPTERS`)
2. **GIS embedded URLs** — unique official park page URLs from Tier-A GIS (`official_gis_urls`) — used when HTML is JS-rendered (FL, CA, MO, WA)
3. **Wikipedia** — list page wikitext parse (fallback)
4. **Page enrich** — fetch each park page for title, category, coordinates when missing

## Verification sources

| Tier | Source | Use |
|------|--------|-----|
| A | Official website park finder | **Allowlist** (primary) |
| A | Official GIS boundaries | Coordinates + unit merge |
| B | Wikipedia list page | Fallback allowlist + spot-check counts |
| C | `state-parks-cross-check-report.json` | Automated flags (`listing_master_mismatch`, `missing_listing_cache`) |
| D | NASPD / America's State Parks | Directory spot-check only — not ingest |

Cross-check URLs for all states: `state-parks-cross-check-sources.json`.

## Key files

| File | Role |
|------|------|
| `state-parks-listing-adapters.mjs` | Per-state HTML/GIS URL scrape patterns |
| `state-parks-listing-lib.mjs` | Ingest, match GIS→listing, aggregate, gap fill |
| `build-state-parks-ingest-listings.mjs` | CLI for listing cache |
| `build-state-parks-master.mjs` | Listing-backed merge for Tier-A |
| `state-parks-ingest/02-listings/{st}.json` | Per-state allowlist cache (gitignored) |

## Adding a new state adapter

1. Probe the official listing page HTML for repeating park URL patterns.
2. Add `HTML_LISTING_ADAPTERS[ST]` with `slugPattern`, `baseUrl`, optional `fallbackUrls` in `LISTING_FALLBACK_URLS`.
3. If GIS records include park page URLs, add `GIS_URL_PATTERNS[ST]`.
4. Run `--refresh --state=ST`, inspect cache count vs Wikipedia and GIS.
5. Fix `GIS_LISTING_OVERRIDES` / visitor-center parent maps as needed.
6. Rebuild master; check `state-parks-cross-check-report.json` flags.

## Category: park + historic

When the official page title includes both “State Park” and “Historic Site”:

- `category: "park"`, `alsoHistoricSite: true`
- `designation: "State Park & Historic Site"`
- Appears on **both** state-parks and state-historic explorer layers

Pure historic sites (e.g. Fort Leaton) remain `category: "historic_site"` only.
