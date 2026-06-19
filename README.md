# Scenic POI Data

Build pipelines and pre-built map bundles for [scenic-router](https://github.com/andrewbrobbins/scenic-router).

Sources are **OpenStreetMap** (Geofabrik PBF), plus NPS/park-boundary caches where noted. Outputs are static `*-explorer-embed.js` files and JSON the app loads from `public/legacy-data/`.

## Quick start

Fuel catalog work on a new clone: **[FUEL-LOCAL-DEV.md](FUEL-LOCAL-DEV.md)** (`ensure-fuel-cache.mjs` downloads PBF locally, caches extract, enables fast re-filter).

```powershell
# 1. Install Node deps (osm-pbf-parser)
node build-poi-osm-install-deps.mjs

# 2. Download OSM extracts (~17 GB US + Canada — one-time)
node build-poi-osm-download.mjs

# Or fuel-only bootstrap (download + cache + filter):
node ensure-fuel-cache.mjs --region=us

# 3. Build a layer (examples)
node build-fuel-us-all.mjs
node build-poi-osm-all.mjs --proof   # Texas proof run (~350 MB)
```

## Sync into the app

From the scenic-router repo:

```powershell
$env:POI_DATA_SOURCE = "C:\path\to\scenic-poi-data"
node scripts/sync-poi-data.mjs
```

Or clone this repo as a sibling folder named `tools/` — the sync script finds it automatically.

**Ingest contract:** bundle file names and global variable shapes are fixed for scenic-router — see **[SCENIC-ROUTER-INGEST.md](SCENIC-ROUTER-INGEST.md)**. Dev map explorers below are **not** synced.

## Map explorers (dev-only)

Visual QA in a browser after pipeline runs:

```bash
node build-fuel-explorer-data.mjs   # fuel-explorer.html
node build-poi-explorer-data.mjs    # poi-explorer.html — all layers + scenic benchmark cases
```

Open the HTML from the repo root. Large layers load on demand from `poi-explorer-data/` slices.

## Pipelines

| Layer | Build | Output | Docs |
|-------|-------|--------|------|
| Branded fuel (US) | `build-fuel-us-all.mjs` | `fuel-us-explorer-embed.js` | [FUEL-US.md](FUEL-US.md) |
| Branded fuel (CA) | `build-fuel-ca-all.mjs` | `fuel-ca-explorer-embed.js` | [FUEL-CA.md](FUEL-CA.md) |
| **Fuel filter explorer** | `build-fuel-explorer-data.mjs` | `fuel-explorer.html` | [FUEL-US.md](FUEL-US.md) |
| **All-layer POI explorer** | `build-poi-explorer-data.mjs` | `poi-explorer.html` | [SCENIC-ROUTER-INGEST.md](SCENIC-ROUTER-INGEST.md) |
| Generic fuel | `build-fuel-generic-explorer-embed.mjs` | `fuel-generic-*-explorer-embed.js` | [POI-OSM-PBF.md](POI-OSM-PBF.md) |
| Camping | `build-camping-us-all.mjs` | `camping-*-explorer-embed.js` | [CAMPING-US.md](CAMPING-US.md) |
| Playgrounds / scenic / historic | `build-poi-osm-all.mjs` | `playgrounds-*`, `scenic-*`, `historic-*` | [POI-OSM-PBF.md](POI-OSM-PBF.md) |
| NPS units | `build-nps-us-cache.mjs` | `nps-us-geo.json` | — |
| Park boundaries | `build-park-boundaries.mjs` | `park-boundaries.*` | — |

Brand matching rules live in `fuel-us-brand-catalog.json` and `fuel-ca-brand-catalog.json`.

**Agents:** see [AGENTS.md](AGENTS.md) before editing fuel data.

## What is not in git

| Path | Why |
|------|-----|
| `osm-pbf/` | Geofabrik `.osm.pbf` files (download locally) |
| `*-ingest/` | Intermediate per-state JSON caches |
| `node_modules/`, `vendor/` | Installed dependencies |
| `.env` | API keys |

Committed artifacts (`*-explorer-embed.js`, `*-master.json`, QA reports) are the **published** bundles. Rebuild anytime from OSM.

## Attribution

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL).
