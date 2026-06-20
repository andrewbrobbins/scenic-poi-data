# scenic-poi-data — backlog

Use this file to track fixes and feature requests. When you ask for something new, say **“add to the todo list: …”** and describe it in your own words. I will:

1. Capture your request verbatim (or lightly cleaned up) under **Your request**
2. Expand it with scope, acceptance criteria, affected files, and dependencies under **Full description**
3. Assign a status and priority

**Statuses:** `backlog` · `ready` · `in_progress` · `blocked` · `done` · `cancelled`

---

## How to read each item

| Field | Meaning |
|-------|---------|
| **ID** | Stable reference (e.g. `VC-001`) |
| **Your request** | What you asked for, in your words |
| **Full description** | Expanded scope, details, and done-when criteria |
| **Priority** | `high` · `medium` · `low` |
| **Status** | Current state |
| **Notes** | Blockers, links, or follow-ups |

---

## Backlog

### VC-001 — NPS visitor center operating hours (API ingest)

- **Priority:** high
- **Status:** done (2026-06-20)

**Your request**

> Visitor centers need accurate operating hours and seasons. The pipeline exists but hours are empty without an API key.

**Full description**

Run the NPS Developer API ingest step so each visitor center record gets `operatingHours`, `hoursSummary`, and seasonal exception blocks from the official API—not just ArcGIS coordinates.

**Scope**

- Set `NPS_API_KEY` in `.env` (see `.env.example`)
- Run `node build-nps-visitor-centers-all.mjs --require-api` (full pipeline with validation)
- Verify merge: API coords preferred over ArcGIS; flag coord mismatches >200 m
- Expect most `NO_HOURS` review flags to clear; QA report `withHours` should jump from 0 toward ~500+

**Affected files**

- `build-nps-visitor-centers-ingest-api.mjs`
- `build-nps-visitor-centers-master.mjs`
- `build-nps-visitor-centers-all.mjs`
- `validate-nps-visitor-centers.mjs`
- `nps-visitor-centers-us-master.json`
- `nps-visitor-centers-qa.json`
- `nps-visitor-centers-us-explorer-embed.js`

**Done when**

- [x] API ingest completes without rate-limit failure (retries already implemented)
- [x] `nps-visitor-centers-qa.json` shows `withHours` > 500+ (680 total; 680/710 API-sourced = 96%)
- [x] Sample parks (e.g. Yellowstone, Acadia) show standard + seasonal hours in POI explorer detail panel
- [x] Remaining `needsReview` items are documented in QA sample, not silent failures

**Notes**

- `.full-run.sh` / `.resume-run.sh` auto-use `--require-api` when `NPS_API_KEY` is set in `.env`
- `NPS_API_KEY` set in local `.env` and GitHub repo secret (2026-06-20)
- Total `withHours` is 65% (680/1043) because 333 ArcGIS-only records lack API match — follow-up merge/dedup if we want >90% overall
- DEMO_KEY rate-limits around ~600 records; production key required

---

### VC-002 — Ship visitor centers to scenic-router

- **Priority:** high
- **Status:** done (2026-06-20)

**Your request**

> Store visitor centers like other POIs and make them available to the app, not just the local POI explorer.

**Full description**

Wire the new `NPS_VISITOR_CENTERS_US` embed into scenic-router’s sync script so the scenic routing app can load visitor centers from `public/legacy-data/` alongside camping, fuel, and scenic layers.

**Scope**

- Add sync entry in scenic-router `scripts/sync-poi-data.mjs` for:
  - `nps-visitor-centers-us-explorer-embed.js` → global `NPS_VISITOR_CENTERS_US`
  - Optionally `nps-visitor-centers-us-master.json` if the app needs full hours JSON
- Document embed contract in `SCENIC-ROUTER-INGEST.md` (already started)
- Implement map layer / detail UI in scenic-router (separate repo task—link here when filed)

**Affected files (this repo)**

- `nps-visitor-centers-us-explorer-embed.js`
- `SCENIC-ROUTER-INGEST.md`

**Affected files (scenic-router)**

- `scripts/sync-poi-data.mjs`
- App code that registers POI layers

**Done when**

- [x] Sync copies embed to scenic-router legacy-data
- [x] App loads layer without console errors
- [x] Tapping a visitor center shows parent park, category, and hours summary

**Notes**

- scenic-router: `loadNpsVisitorCenterRecords`, map layer toggle `npsVisitorCenters`, square blue markers, popup with parent + hours
- Sync: `POI_DATA_SOURCE=/path/to/scenic-poi-data node scripts/sync-poi-data.mjs`

---

### VC-003 — OSM verification pass for visitor centers

- **Priority:** medium
- **Status:** done (2026-06-20)

**Your request**

> Hours and locations must be very accurate; verify against OSM where possible.

**Full description**

Run the optional OSM verification step built into the master builder. For each visitor center, find nearby `tourism=information`, `information=visitor_centre`, and `amenity=ranger_station` within ~350 m using **local Geofabrik PBF** (not Overpass).

**Scope**

- Run `node build-nps-visitor-centers-master.mjs --verify-osm` or full `build-nps-visitor-centers-all.mjs --verify-osm`
- Review `nps-visitor-centers-qa.json` for `NO_OSM` and `OSM_FAR` flags
- Manually spot-check flagged records in POI explorer; adjust coords or add review exceptions where OSM is wrong/incomplete

**Affected files**

- `nps-visitor-centers-osm-verify.mjs` (local PBF scan + spatial index)
- `build-nps-visitor-centers-master.mjs`
- `nps-visitor-centers-qa.json`
- [NPS-VISITOR-CENTERS.md](NPS-VISITOR-CENTERS.md)

**Done when**

- [x] Verification run completes for all records (local PBF — ~14 min first run, cached thereafter)
- [x] QA report includes `osmChecked` / `osmMatched` stats (1032 checked, 765 matched)
- [ ] High-confidence false `NO_OSM` cases investigated (remote parks often lack OSM VC tags)

**Notes**

- **Never use Overpass** for this layer — see NPS-VISITOR-CENTERS.md and AGENTS.md
- One PBF scan (~minutes) + in-memory nearest match; cache at `nps-vc-us-ingest/03-osm-pbf/`
- OSM is supplementary; NPS API + ArcGIS remain primary

---

### VC-004 — Update NPS unit catalog visitor-center counts

- **Priority:** low
- **Status:** done (2026-06-20)

**Your request**

> NPS unit metadata should reflect how many visitor centers each park has.

**Full description**

After the visitor center master is built, update `nps-us-geo.json` (or rebuild via `build-nps-us-cache.mjs`) so each unit’s `visitorCenterCount` matches the master—not the old stub that picks one VC per park for centroid coords only.

**Scope**

- Aggregate `nps-visitor-centers-us-master.json` by `parkCode`
- Write counts into `nps-us-geo.json` units
- Ensure POI explorer NPS unit layers can optionally show count (future UI)

**Affected files**

- `build-nps-us-cache-core.mjs`
- `nps-us-geo.json`

**Done when**

- [x] Every unit with VCs shows correct count (e.g. Yellowstone 12, Acadia 9)
- [x] Units with zero VCs show `visitorCenterCount: 0` (42 units)

**Depends on**

- VC-001 optional but recommended before publish

---

### VC-005 — Resolve missing state on visitor centers

- **Priority:** low
- **Status:** done (2026-06-20)

**Your request**

> Fix data quality issues flagged in the visitor center QA report.

**Full description**

Current ArcGIS-only build flags 17 records with `NO_STATE`. Infer state from parent unit in `nps-us-geo.json`, NPS API addresses after VC-001, or manual review for territories/edge cases.

**Scope**

- Inspect `needsReviewSample` in `nps-visitor-centers-qa.json` for `missing-state`
- Improve state inference in ingest/master merge
- Rebuild and confirm `NO_STATE` count → 0

**Done when**

- [x] QA `mapFlagCounts.NO_STATE` is 0 or each remainder documented

**Notes**

- `resolveVisitorCenterState()` + coord centroid fallback in `nps-visitor-centers-lib.mjs`; applied in ArcGIS ingest and master merge

---

### PB-001 — Expand NPS park boundaries to additional unit types

- **Priority:** medium
- **Status:** backlog

**Your request**

> Add park boundaries for other NPS sites (not just the units that currently have polygons).

**Full description**

Extend `build-park-boundaries.mjs` so `park-boundaries.geojson` and `park-boundaries-embed.js` cover more NPS and Parks Canada units. Today the US pipeline primarily pulls ArcGIS polygons for **National Park, National Monument, National Memorial, National Preserve, and Other Designation**, and only supplements missing codes for units whose `category` is `park`, `monument`, `memorial`, or `preserve`. That leaves most **historic parks/sites, recreation areas, affiliated areas, and other designations** without boundary polygons even though they exist in the NPS catalog. Canada currently includes only **National Park, National Park Reserve, and National Historic Site** from Parks Canada ArcGIS — expand that path in parallel with US.

**Agreed scope**

| Include | Exclude |
|---------|---------|
| National parks, monuments, preserves | **Trails / parkways** (`parkway_trail`, linear scenic/historic trails) |
| Historic parks and historic sites | **Memorials** (`memorial` category — often point/ plaza features without land boundaries) |
| Recreation areas (seashores, lakeshores, rivers, NRAs) | |
| Affiliated areas and “Other Designation” where ArcGIS has polygons (accept fuzzy/overlap) | |

**Scope**

- Audit coverage: compare `nps-us-geo.json` units vs `park-boundaries.geojson` by `parkCode` and `category`; document gaps (missing polygon, wrong category, subsidiary preserve codes)
- Widen **US** ArcGIS fetch: query NPS Boundaries FeatureServer for additional `UNIT_TYPE` values (National Historical Park, National Historic Site, National Recreation Area, National Seashore/Lakeshore, National Battlefield, etc.) — **not** parkways/trails or memorial-only units per table above
- Widen **Canada** ArcGIS fetch: extend `fetchCaBoundaries()` beyond the current three `PLACE_TYPE_E` values to cover additional Parks Canada unit types that have polygon boundaries (research available types in the APCA FeatureServer)
- Fetch-by-code fallback: for any in-scope unit in `nps-us-geo.json` still missing after type-based fetch, batch-query by `UNIT_CODE`
- Reuse existing merge logic: subsidiary preserve consolidation, ring simplification, secondary-ring caps, category mapping from `nps-us-geo.json`
- Evaluate OSM fallback only where ArcGIS has no polygon (see `scripts/audit-nps-osm.mjs`); do not replace ArcGIS as primary source
- Rebuild embed + update POI explorer / scenic-router ingest docs if contract changes
- Log in-scope units that legitimately have no mappable boundary (documented exclusions, not silent drops)

**Affected files**

- `build-park-boundaries.mjs`
- `park-boundaries.geojson`
- `park-boundaries-embed.js`
- `nps-us-geo.json` (read-only reference for US unit list)
- `SCENIC-ROUTER-INGEST.md`
- `scripts/audit-nps-osm.mjs` (optional verification)

**Done when**

- [ ] Coverage report: % of **in-scope** `nps-us-geo.json` units with a boundary polygon, broken down by `category`
- [ ] Canada coverage report: count of Parks Canada polygons by unit type vs target types
- [ ] All in-scope US + CA units have polygons or are explicitly documented as boundary-less
- [ ] `node build-park-boundaries.mjs` completes without error; embed size acceptable for app load
- [ ] POI explorer / app map renders new boundary categories correctly (no regressions on existing parks/monuments)
- [ ] Remaining gaps listed in build output or a small QA artifact

**Notes**

- Affiliated / Other Designation: include when a polygon exists; overlapping boundaries are acceptable
- Memorials and trails excluded by product decision — do not backfill those categories
- Current build warns on missing National Park / National Monument codes — keep as QA signal for in-scope types

---

### SP-001 — State parks unit catalog (NPS-style database)

- **Priority:** medium
- **Status:** backlog

**Your request**

> Create a database of state parks like the NPS database. This will require multiple data sources.

**Full description**

Build a canonical **state and provincial park unit catalog** for the **US and Canada**, analogous to `nps-us-geo.json` — replacing the corridor-limited camping seed approach in `state-parks-camping-source.json`. Each record identifies a managed park unit with stable id, name, administering state/province, coordinates, designation/type, and URLs where available. Downstream uses may include map layers, parent linking for POIs, boundary polygons (future), and scenic-router sync — but this item focuses on the **catalog + ingest pipeline**, not full app UI.

**Agreed scope**

| Include | Exclude (for now) |
|---------|-------------------|
| **US:** state parks, state historic sites | State forests, state recreation areas (non-historic), national forests |
| **Canada:** provincial parks, provincial historic sites | Provincial forests, national forests |
| **Nationwide** coverage — all states and provinces with available data | Corridor-filtered subsets (retire “Tyler–Vancouver corridor” framing for this layer) |

**Scope**

- **Retire corridor framing** — remove corridor-centric language and `corridors` fields from state-park-related sources and docs as the nationwide catalog lands (e.g. `state-parks-camping-source.json` note/fields, references in camping/stopping-point scripts); do not scope ingest to route corridors
- **Research & source matrix** — per-state and per-province data availability (open data portals, state/provincial DNR APIs, Recreation.gov, OSM protected areas with state/provincial operators, PAD-US for US, etc.); document license, refresh cadence, and field mapping
- **Schema design** — mirror NPS patterns where sensible:
  - Required v1: `id`, `country`, `state`/`province`, `name`, `designation`, `category` (`park` | `historic_site`), `lat`, `lon`, `source`, `needsReview`
  - Optional v1 (capture when source provides, not blocking): `url`, `osmId`, official state/provincial park code
  - **Open:** finalize optional vs required fields during source-matrix phase (no decision yet on official codes)
  - Do **not** carry over camping-specific `corridors` / `cost` fields from seed files
- **Ingest pipeline** — staged like other POI layers:
  - raw source caches per region (gitignored)
  - merge/dedupe across sources (name + state/province + proximity; flag conflicts)
  - master JSON (committed) + optional explorer embed (`STATE_PARKS` or split `STATE_PARKS_US` / `STATE_PARKS_CA`)
  - validation script (counts per state/province, duplicate ids, missing coords)
- **Nationwide bootstrap** — build for all US states + Canadian provinces; phased implementation by data quality is OK, but **no geographic subset** as the product goal
- **Integration hooks** — document in `SCENIC-ROUTER-INGEST.md`; link camping ingest to catalog ids in a follow-up item
- **Do not** hand-edit master JSON — rebuild via pipeline

**Affected files (new / expected)**

- `build-state-parks-cache.mjs` (orchestrator — US + CA)
- `build-state-parks-cache-core.mjs`
- `state-parks-us-master.json` / `state-parks-ca-master.json` (or unified `state-parks-master.json`)
- `state-parks-explorer-embed.js` (optional)
- `validate-state-parks.mjs`
- `STATE-PARKS.md` (pipeline doc)
- `state-parks-camping-source.json` (deprecate or shrink as nationwide catalog replaces corridor seeds)
- `build-stopping-points-cache.mjs`, camping docs (corridor language cleanup)

**Done when**

- [ ] Written source matrix covering US states + CA provinces with prioritized ingest sources and known gaps
- [ ] Schema documented with example US and CA records; optional-field policy decided during research
- [ ] Pipeline produces nationwide master JSON with per-state/province counts (no corridor filter)
- [ ] Dedupe/conflict rules tested on overlapping sources
- [ ] Validation script passes; QA report flags unresolved merges
- [ ] Corridor references removed from state-park catalog path and related seed file notes/fields
- [ ] POI explorer layer stub or manifest entry (optional but recommended for visual QA)

**Depends on**

- None strictly; boundary polygons (`SP-002`?) and camping parent-linking benefit from this catalog

**Notes**

- Forests explicitly out of scope — national forests not in repo yet either; do not conflate with this item
- Parks Canada **national** sites stay in NPS/Parks Canada pipelines; this catalog is **state/provincial** land managers only
- Existing `state-parks-camping-source.json` (~80 hand-curated pins) — overlap-check only until catalog subsumes it

---

## In progress

_(none)_

---

## Done

### VC-DONE-001 — NPS visitor centers pipeline (initial)

- **Status:** done (2026-06-20, commit `9163c15`)

**Your request**

> Identify visitor centers for NPS sites, store them like other POIs with parent park/site, designation category, operating hours/seasons, accurate location; pipeline similar to other POI layers with ArcGIS/OSM verification options.

**What shipped**

- ArcGIS ingest (568 centers), NPS API ingest + merge, master JSON, explorer embed, POI explorer layer (square markers, hours in detail panel), ingest docs, full-run hook (`--skip-api` until key set)

---

## Template (copy for new items)

```markdown
### XX-000 — Short title

- **Priority:** medium
- **Status:** backlog

**Your request**

> _(paste your words here)_

**Full description**

_(Expanded scope, technical approach, edge cases)_

**Scope**

- bullet list of concrete work

**Affected files**

- `path/to/file`

**Done when**

- [ ] measurable acceptance criterion

**Depends on**

- other IDs if any

**Notes**

- optional
```

---

## Quick commands

| Task | Command |
|------|---------|
| Full VC rebuild (needs API key for hours) | `node build-nps-visitor-centers-all.mjs --require-api` |
| ArcGIS-only rebuild | `node build-nps-visitor-centers-all.mjs --skip-api` |
| Validate VC outputs | `node validate-nps-visitor-centers.mjs [--expect-api]` |
| OSM verify | `node build-nps-visitor-centers-all.mjs --verify-osm` |
| Refresh POI explorer manifest | `node build-poi-explorer-data.mjs` |
