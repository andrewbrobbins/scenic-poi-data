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

**v1 ingest uses local Geofabrik PBF only** (`osm-pbf/geofabrik/us-latest.osm.pbf`, `canada-latest.osm.pbf`). No Overpass. Tags: `boundary=protected_area`, `leisure=nature_reserve`, filtered to state/provincial park units in code.

Progress logs emit every 10 seconds during PBF scans (byte % + OSM block counts). Use `--refresh` to rescan after a PBF update.

Download PBF if missing:

```bash
node build-poi-osm-download.mjs --source=us
node build-poi-osm-download.mjs --source=ca
```

Official open-data APIs below are documented for future enrichment merges.

### United States

| State | Primary source (v1) | Official open data | Notes |
|-------|---------------------|--------------------|-------|
| All states | **Local OSM PBF** | Varies by state | Per-state DNR GIS portals exist for most states; not wired in v1 |
| TX | **Local OSM PBF** | [TPWD GIS](https://tpwd.texas.gov/) | Strong OSM coverage for state parks |
| CA | **Local OSM PBF** | [California State Parks GIS](https://data.ca.gov/) | Large catalog; OSM + future state API merge |
| NY | **Local OSM PBF** | [NYS Parks GIS](https://data.ny.gov/) | |
| FL | **Local OSM PBF** | [Florida DEP](https://geodata.dep.state.fl.us/) | |
| WA, OR, CO, UT, AZ, NM | **Local OSM PBF** | State DNR portals | Well mapped in OSM |
| AK, HI | **Local OSM PBF** | State parks dept sites | Sparse OSM in remote units — expect gaps |
| PAD-US | — | [USGS PAD-US](https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-data-overview) | Future secondary source for boundaries + manager verification |

License: OSM ODbL. Do not mix proprietary state GIS without documenting license.

### Canada

| Province | Primary source (v1) | Official open data | Notes |
|----------|---------------------|--------------------|-------|
| All provinces | **Local OSM PBF** | Varies | Parks Canada **national** sites stay in NPS/Parks Canada pipelines |
| BC | **Local OSM PBF** | [BC Parks locations](https://catalogue.data.gov.bc.ca/) | Good OSM coverage |
| AB | **Local OSM PBF** | Alberta Parks | |
| ON | **Local OSM PBF** | Ontario Parks GIS | Large province |
| QC | **Local OSM PBF** | SEPAQ / Parcs Québec | French names common |
| Atlantic (NB, NS, PE, NL) | **Local OSM PBF** | Provincial parks sites | |
| North (YT, NT, NU) | **Local OSM PBF** | Territorial governments | Expect sparse coverage |

## Pipeline

Run from **repo root**:

```bash
# Full pipeline (local PBF → master → embed → validate)
node build-state-parks-all.mjs

# Rescan after PBF update
node build-state-parks-all.mjs --refresh

# Extract only (single country)
node build-state-parks-extract-pbf.mjs --source=us
node build-state-parks-master.mjs
```

### Stages

| Step | Script | Output |
|------|--------|--------|
| 1 | `build-state-parks-extract-pbf.mjs` | `state-parks-ingest/00-pbf/state-parks-{us\|ca}.json` (gitignored) |
| 2 | `build-state-parks-master.mjs` | `state-parks-us-master.json`, `state-parks-ca-master.json` |
| 3 | `build-state-parks-explorer-embed.mjs` | `state-parks-us-explorer-embed.js`, `state-parks-ca-explorer-embed.js` |
| 4 | `validate-state-parks.mjs` | exit 0/1; reads `state-parks-qa.json` |

### Dedupe rules

- Same normalized name + state/province within **500 m** → merge (keep higher rank: relation > way, has URL, has official code)
- Same name farther apart → keep both; logged in `state-parks-qa.json` as conflicts

## Key files

| File | Role |
|------|------|
| `state-parks-lib.mjs` | Schema helpers, OSM classification, dedupe |
| `build-state-parks-extract-pbf.mjs` | Local PBF scan (primary ingest) |
| `state-parks-us-master.json` | Committed US catalog |
| `state-parks-ca-master.json` | Committed CA catalog |
| `state-parks-qa.json` | Per-region counts + merge conflicts |
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
