# scenic-router ingest contract

This repo **produces** static bundles; [scenic-router](https://github.com/andrewbrobbins/scenic-router) **consumes** them via `scripts/sync-poi-data.mjs` into `public/legacy-data/`.

**Do not change ingest artifact names, global variable names, or embed shapes** without updating scenic-router. Pipeline edits must keep rebuilding these files — never hand-edit committed bundles.

## Sync command

From the scenic-router repo:

```bash
POI_DATA_SOURCE=/path/to/scenic-poi-data node scripts/sync-poi-data.mjs
```

Or clone this repo as a sibling folder named `tools/` (auto-discovered).

## Published artifacts (synced to scenic-router)

| Global / file | Build script | Purpose |
|---------------|--------------|---------|
| `FUEL_US` → `fuel-us-explorer-embed.js` | `build-fuel-us-explorer-embed.mjs` | Branded US fuel |
| `FUEL_CA` → `fuel-ca-explorer-embed.js` | `build-fuel-ca-explorer-embed.mjs` | Branded CA fuel |
| `FUEL_GENERIC_US` → `fuel-generic-us-explorer-embed.js` | `build-fuel-generic-explorer-embed.mjs` | Non-catalog US fuel |
| `FUEL_GENERIC_CA` → `fuel-generic-ca-explorer-embed.js` | `build-fuel-generic-explorer-embed.mjs` | Non-catalog CA fuel |
| `CAMPING_US_EXPLORER` → `camping-us-explorer-embed.js` | `build-camping-us-explorer-embed.mjs` | Filtered US camping |
| `CAMPING_CA_EXPLORER` → `camping-ca-explorer-embed.js` | `build-camping-ca-explorer-embed.mjs` | CA camping |
| `PLAYGROUNDS_US` / `PLAYGROUNDS_CA` | `build-poi-osm-explorer-embed.mjs` | Playgrounds |
| `SCENIC_US` / `SCENIC_CA` | `build-poi-osm-explorer-embed.mjs` | Scenic overlooks (road-filtered) |
| `HISTORIC_US` / `HISTORIC_CA` | `build-poi-osm-explorer-embed.mjs` | Historic POIs |
| `nps-us-geo.json` | `build-nps-us-cache.mjs` | NPS unit points |
| `NPS_VISITOR_CENTERS_US` → `nps-visitor-centers-us-explorer-embed.js` | `build-nps-visitor-centers-explorer-embed.mjs` | NPS visitor centers |
| `park-boundaries.geojson` + embed | `build-park-boundaries.mjs` | Park boundary polygons |

Canonical full records live in `*-master.json` (same IDs as embeds; embeds are slim map rows).

### Embed row shape (POI OSM layers)

Built by `toEmbedRow()` in `poi-osm-lib.mjs`:

```json
{ "id", "name", "lat", "lon", "state", "url", "subtype?", "parkName?" }
```

Embed wrapper:

```json
{ "generated", "kind", "region", "count", "records": [ ... ] }
```

Global name: `{EMBED_VAR}_{REGION}` e.g. `SCENIC_US`, `PLAYGROUNDS_CA`.

### Fuel embed shape

```json
{ "generated", "count", "brands"?, "records": [{ "id", "name", "brand", "brandId", "lat", "lon", "state", "type", "diesel", "url", "highway" }] }
```

### Camping embed shape

```json
{ "generated", "filterEnabled", "count", "records": [{ "id", "name", "lat", "lon", "landManager", "state", "cost", "url", "parent" }] }
```

### NPS visitor centers embed shape

Built by `build-nps-visitor-centers-explorer-embed.mjs`. Full records in `nps-visitor-centers-us-master.json`.

```json
{
  "generated", "kind", "region", "count", "withHours", "needsReviewCount",
  "records": [{
    "id", "name", "lat", "lon", "state", "parkCode",
    "parentName", "parentCategory", "parentDesignation",
    "hoursSummary": { "hasHours", "summary", "seasonalNote" },
    "seasonal": { "isSeasonal", "description" },
    "url", "coordConfidence", "needsReview"
  }]
}
```

Global: `NPS_VISITOR_CENTERS_US`.

Build: `node build-nps-visitor-centers-all.mjs` (set `NPS_API_KEY` in `.env` for operating hours).

## Dev-only (NOT synced)

These are for local QA and must **not** replace ingest artifacts:

| Path | Purpose |
|------|---------|
| `fuel-explorer.html` + `fuel-explorer-data.js` | Fuel catalog map QA |
| `poi-explorer.html` + `poi-explorer-data/` | **All-layer map explorer** (this repo) |
| `*-ingest/` | Intermediate caches |
| `osm-pbf/` | Geofabrik downloads |
| `scenic-road-access-benchmark.json` | Regression fixtures (not app data) |

Run `node build-poi-explorer-data.mjs` then open `poi-explorer.html` — explorer bundles are derived from masters/embeds and never overwrite them.

## Rules for agents

1. **Rebuild** ingest files via pipeline scripts; do not edit `*-explorer-embed.js` or `*-master.json` by hand unless explicitly fixing encoding.
2. **New layers** need a sync entry in scenic-router's `sync-poi-data.mjs` before the app can load them.
3. **Explorer / HTML / dev JSON** — safe to extend for visualization; keep separate from ingest outputs.
4. **Scenic road filter** changes: rebuild `build-scenic-road-distances.mjs` → filter → master → embed (see [SCENIC-ROAD-DISTANCES.md](SCENIC-ROAD-DISTANCES.md)).
