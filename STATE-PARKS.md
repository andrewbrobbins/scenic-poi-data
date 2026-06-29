# State and provincial parks catalog (SP-001)

Nationwide **state / provincial park unit catalog** for the US and Canada — analogous to `nps-us-geo.json`. Used for map layers, parent linking, and future boundary work.

## Scope

| Include | Exclude |
|---------|---------|
| US state parks, state historic sites | State forests, state recreation areas (non-historic), national forests |
| CA provincial parks, provincial historic sites | Provincial forests, national forests, Parks Canada national sites |

## Schema (v1)

Required fields on each master record:

| Field | Description |
|-------|-------------|
| `id` | Stable id, e.g. `sp-us-tx-palo-duro-canyon-state-park-relation123` |
| `country` | `US` or `CA` |
| `state` | US state / DC code or CA province code |
| `name` | Display name |
| `designation` | e.g. `State Park`, `Provincial Historic Site` |
| `category` | `park` or `historic_site` |
| `lat`, `lon` | Representative point (OSM center) |
| `source` | Primary ingest source (`osm`) |
| `needsReview` | QA flag |

Optional (when source provides):

| Field | Description |
|-------|-------------|
| `url` | Official park page |
| `osmId` | e.g. `relation/12345` |
| `officialCode` | State/provincial park code from OSM `ref` tags |

Example US record:

```json
{
  "id": "sp-us-tx-palo-duro-canyon-state-park-relation1234567",
  "country": "US",
  "state": "TX",
  "name": "Palo Duro Canyon State Park",
  "designation": "State Park",
  "category": "park",
  "lat": 34.9378,
  "lon": -101.6678,
  "source": "osm",
  "needsReview": false,
  "url": "https://tpwd.texas.gov/state-parks/palo-duro-canyon",
  "osmId": "relation/1234567"
}
```

Example CA record:

```json
{
  "id": "sp-ca-bc-joffre-lakes-provincial-park-relation987654",
  "country": "CA",
  "state": "BC",
  "name": "Joffre Lakes Provincial Park",
  "designation": "Provincial Park",
  "category": "park",
  "lat": 50.358,
  "lon": -122.475,
  "source": "osm",
  "needsReview": true,
  "reviewReasons": ["missing-url"],
  "osmId": "relation/987654"
}
```

## Source matrix

**Primary ingest is now official state GIS where verified**, merged with OSM PBF as secondary. Full research docs: **[STATE-PARKS-SOURCES.md](STATE-PARKS-SOURCES.md)**.

### Four-source completion goal

Each US state should have **four independent verification sources** before the catalog is considered done:

| # | Source | What counts as “present” | Ingest / cross-check |
|---|--------|--------------------------|----------------------|
| 1 | **GIS** | Verified ArcGIS boundary layer in `state-parks-source-matrix.json` | `build-state-parks-ingest-official.mjs` |
| 2 | **OSM** | At least one candidate in local PBF extract | `build-state-parks-extract-pbf.mjs` |
| 3 | **Official website** | Agency park finder allowlist in listing cache | `build-state-parks-ingest-listings.mjs` |
| 4 | **Wikipedia** | Parsed count from en.wikipedia list page (wikitable rows + location map) | `node build-state-parks-wiki-counts.mjs` → `state-parks-wiki-counts-cache.json` |

**Completed** = all four present **and** GIS, website, Wikipedia, and **plotted master** counts agree within **1.35×** (raw OSM is not used for agreement — it is unfiltered and often over-counts).

Track status:

```bash
node build-state-parks-wiki-counts.mjs          # refresh Wikipedia list-page counts
node build-state-parks-four-source-status.mjs   # → state-parks-four-source-status.json + STATE-PARKS-COMPLETION.md
```

See **[STATE-PARKS-COMPLETION.md](STATE-PARKS-COMPLETION.md)** for the live completed / remaining tables.

| Artifact | Role |
|----------|------|
| `state-parks-source-matrix.json` | Per-state tier, status, endpoints, field maps (committed) |
| `state-parks-source-seeds.json` | Candidate URLs for discovery probes |
| `state-parks-source-overrides.json` | Manually verified sources (merged into matrix) |
| `state-parks-ingest/01-official/{st}.json` | Per-state official ingest cache (gitignored) |

Research commands:

```bash
node build-state-parks-research-all.mjs          # Hub search + apply overrides
node build-state-parks-discover-sources.mjs      # Probe seed URLs
node build-state-parks-ingest-official.mjs --refresh --state=CA,TX
```

### United States (verified Tier A — see STATE-PARKS-SOURCES.md for full list)

| State | Agency | Ingest ~count |
|-------|--------|---------------|
| AK, CA, FL, MN, MO, NC, NY, SC, TX, WA | State DNR / parks dept | 1,400+ combined |
| Remaining states | OSM PBF + research in progress | varies |

PAD-US remains a future cross-check source (Tier E), not primary ingest.

### Canada

| Province | Primary source (v1) | Official open data | Notes |
|----------|---------------------|--------------------|-------|
| All provinces | **Local OSM PBF** + research | Varies | Provincial ArcGIS ingest pending |

## Pipeline

Run from **repo root**:

```bash
# Full pipeline (PBF + official → master → embed → validate)
node build-state-parks-all.mjs

# Rescan PBF after update
node build-state-parks-all.mjs --refresh

# Listing allowlists for all Tier-A states (see STATE-PARKS-LISTINGS.md)
node build-state-parks-ingest-listings.mjs --tier-a --refresh

# Official ingest only (network)
node build-state-parks-ingest-official.mjs --refresh --state=CA,TX,NY

# Source research (network)
node build-state-parks-research-all.mjs
```

### Stages

| Step | Script | Output |
|------|--------|--------|
| 0 | `build-state-parks-research-all.mjs` (optional) | Updates `state-parks-source-matrix.json` |
| 1 | `build-state-parks-extract-pbf.mjs` | `state-parks-ingest/00-pbf/state-parks-{us\|ca}.json` (gitignored) |
| 1b | `build-state-parks-ingest-official.mjs` | `state-parks-ingest/01-official/{st}.json` (gitignored) |
| 2 | `build-state-parks-master.mjs` | Merges official + OSM → `state-parks-*-master.json` |
| 3 | `build-state-parks-explorer-embed.mjs` | `state-parks-*-explorer-embed.js` |
| 4 | `validate-state-parks.mjs` | exit 0/1; reads `state-parks-qa.json` |
| 5 | `build-state-parks-four-source-status.mjs` | Four-source completion tracker |

### Dedupe rules

- Same normalized name + state/province within **500 m** → merge (prefer **official** source, then URL, official code, OSM relation rank)
- Same name farther apart → keep both; logged in `state-parks-qa.json` as conflicts

## Key files

| File | Role |
|------|------|
| `state-parks-lib.mjs` | Schema helpers, OSM classification, dedupe |
| `state-parks-source-matrix.json` | Committed source research matrix |
| `state-parks-official-lib.mjs` | Official ArcGIS ingest helpers |
| `build-state-parks-extract-pbf.mjs` | Local PBF scan (OSM secondary) |
| `build-state-parks-ingest-official.mjs` | Fetch verified Tier A sources |
| `state-parks-us-master.json` | Committed US catalog |
| `state-parks-ca-master.json` | Committed CA catalog |
| `state-parks-qa.json` | Per-region counts + merge conflicts |
| `state-parks-four-source-status.json` | Four-source completion tracker (generated) |
| `STATE-PARKS-COMPLETION.md` | Human-readable completion tables (generated) |
| `state-parks-camping-source.json` | **Deprecated** manual camping seeds — overlap-check only |

## Explorer / app

After building, refresh the dev map explorer:

```bash
node build-poi-explorer-data.mjs
# open poi-explorer.html — State parks layers (US + CA)
```

Embed globals: `STATE_PARKS_US`, `STATE_PARKS_CA` (not yet synced to scenic-router ingest — document-only in `SCENIC-ROUTER-INGEST.md`).

## Do NOT

- Hand-edit `state-parks-*-master.json` or embed JS — rebuild via pipeline
- Include national forests, state forests, or corridor-filtered subsets in this catalog
- Use Overpass for this layer — **local PBF only**
- Conflate Parks Canada national units with provincial parks
