# US camping database

Nationwide campground-level dataset for trip planners and maps.

## Build (full pipeline)

```bash
cd tools
node build-camping-us-all.mjs
```

Optional flags on full build:

- `--skip-roads` — clustering/name filter only (no Overpass road fetch)
- `--fetch-roads` — refresh per-state highway caches (slow; needed for road-distance filter)

## Display filter (reversible)

After merge, `build-camping-us-enrich.mjs` adds fields to **every** master record (nothing deleted):

| Field | Meaning |
|-------|---------|
| `displayTier` | `default` (shown on route maps), `qa`, or `excluded` |
| `excludeReason` | Why excluded, if any |
| `roadDistanceM` | Meters to nearest OSM drivable highway (`0` = federal GIS assumed OK) |
| `clusterGroupId` / `clusterRole` | Micro-cluster collapse (80 m radius) |

Config: **`camping-us-filter-config.json`** — set `"enabled": false` to restore the old wide embed behavior.

### Revert if results look wrong

1. **Quick (keep master, widen maps)**  
   ```bash
   node build-camping-us-enrich.mjs --disable-filter --embed-only
   ```
   Or edit `camping-us-filter-config.json` → `"enabled": false`, then `--embed-only`.

2. **Full restore (master before enrichment)**  
   ```bash
   node build-camping-us-enrich.mjs --restore-backup
   node build-camping-us-enrich.mjs --embed-only
   ```
   Backup file: `camping-us-master.pre-filter-backup.json` (created once on first enrich).

3. **Compare**  
   - `camping-us-explorer-embed.js` — default filtered layer  
   - `camping-us-explorer-embed-full.js` — legacy include rules (no `displayTier`)  
   - `camping-us-filter-stats.json` — tier counts after enrich  

### Road distance caches

Per-state highway geometry: `camping-us-ingest/05-roads/osm-roads-{ST}.json`

```bash
node build-camping-us-enrich.mjs --fetch-roads
node build-camping-us-enrich.mjs
```

Re-run enrich without `--fetch-roads` to use existing caches (auto-fetches any missing state cache for states that have OSM campgrounds).

### UTF-8 on Google Drive

If `node build-camping-us-enrich.mjs` fails with `SyntaxError` on line 1, re-save scripts as UTF-8:

```bash
node fix-new-mjs-encoding.mjs camping-us-filter.mjs camping-us-road-enrich.mjs build-camping-us-enrich.mjs
```

## Interactive map

Open **`tools/camping-map.html`**. Uses full master via `camping-us-viewer.js`.

- **Default map layer only** — matches route editor embed  
- Toggle **QA** / show **excluded** for audit  
- Road distance shown in site detail when enriched  

## Ingest steps

| Step | Source | Output |
|------|--------|--------|
| 01 | NPS Public POIs ArcGIS | `01-nps-poi/campgrounds.json` |
| 02 | USFS EDW Recreation Sites | `02-usfs-recreation/campgrounds.json` |
| 03 | OpenStreetMap Overpass (per state) | `03-osm/osm-{ST}.json` |
| 04 | Recreation.gov RIDB (optional API key) | `04-ridb/campgrounds.json` |
| 05 | OSM highways (enrich) | `05-roads/osm-roads-{ST}.json` |

Merged output:

- `camping-us-master.json` — all records + enrichment fields  
- `camping-us-qa-report.json` — QA summary  
- `camping-us-explorer-embed.js` — default map layer  
- `camping-us-explorer-embed-full.js` — unfiltered comparison embed  

## Optional API key

```
RECREATION_GOV_API_KEY=your_ridb_key
```

## Filter rules (conservative)

- **Hard exclude:** placeholders, dispersed, `OSM node/way/relation` names, `NPS_NO_CG`  
- **Micro-cluster (80 m):** drop duplicate pitch pins when a better anchor exists in the same group  
- **Road:** OSM **vehicle highways only** (no `path` / `footway` / `track` / `cycleway`). Uses home-state cache when present; otherwise tries border-state caches (e.g. ID sites near MT highways). Named developed OSM/USFS sites without any cache stay **default** (`roadDefaultGoodNameNoCache`). Federal NPS without cache → **QA**. Exclude if >800 m when distance is known (QA up to 1200 m)  

## Rebuild one step

```bash
node build-camping-us-master.mjs
node build-camping-us-enrich.mjs
node build-camping-us-explorer-embed.mjs
```
