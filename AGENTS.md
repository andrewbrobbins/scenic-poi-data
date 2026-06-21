# Agent guidelines (scenic-poi-data)

This repo builds **static map bundles** from OpenStreetMap. Many outputs are committed JSON/JS files that the scenic-router app loads directly.

## OSM source — PBF, not Overpass

When `osm-pbf/geofabrik/us-latest.osm.pbf` and/or `canada-latest.osm.pbf` exist locally (**normal for this project**), **never use the Overpass API** for OSM ingest or spatial queries. Use the on-disk PBF instead.

Full policy: **[POI-OSM-PBF.md](POI-OSM-PBF.md)** (rule + layer mapping). Legacy `*-ingest-osm.mjs` Overpass scripts are for PBF-missing bootstrap only, not routine rebuilds.

Check PBF: `node fuel-cache-status.mjs` or `ls osm-pbf/geofabrik/`.

## Fuel data — read this before editing

Gas stations are split into two layers per country:

| Layer | US global | CA global | Meaning |
|-------|-----------|-----------|---------|
| **Branded** (tier A catalog) | `FUEL_US` | `FUEL_CA` | A small set of high-quality travel/convenience brands — **not** all branded chains |
| **Generic** | `FUEL_GENERIC_US` | `FUEL_GENERIC_CA` | All other `amenity=fuel` / `shop=fuel` POIs |

**Canada (`fuel-ca-*`) is the reference implementation.** The US pipeline was brought in line with the same extract-cache → filter → master → embed pattern. Do not revert US to a single-pass PBF scan or Overpass ingest unless explicitly asked.

### Do NOT

- Edit `fuel-us-master.json` or `fuel-us-explorer-embed.js` by hand — rebuild via the pipeline
- Run `build-fuel-us-ingest-osm.mjs` (legacy Overpass) for routine work
- Change `fuel-us-brand-catalog.json` without running filter + master + embed and `node validate-fuel-us.mjs`
- Copy Canada brand-matching logic into US wholesale — catalogs and exclusion rules differ
- Loosen brand matching (e.g. removing `strict` on Buc-ee's) without understanding false-positive risk
- Use `cd tools` — scripts run from the **repo root** (there is no `tools/` subdirectory in this clone)

### Do

- Read [FUEL-US.md](FUEL-US.md) and [FUEL-CA.md](FUEL-CA.md) before fuel changes
- Iterate on catalog rules with the **fast path** (no full PBF rescan):

  ```bash
  node build-fuel-us-filter-brands.mjs
  node build-fuel-us-master.mjs
  node build-fuel-us-explorer-embed.mjs
  node build-fuel-explorer-data.mjs
  node validate-fuel-us.mjs
  ```

- **Evaluate visually:** open `fuel-explorer.html` in a browser after `build-fuel-explorer-data.mjs`

- Search the US fuel cache when debugging matches:

  ```bash
  node search-fuel-us-cache.mjs "pilot travel"
  ```

- Bootstrap on a new clone: `node ensure-fuel-cache.mjs --region=us`
- Check local cache: `node fuel-cache-status.mjs`
- Full US rebuild (only when PBF updated or cache missing):

  ```bash
  node build-fuel-us-all.mjs          # uses cached extract if present
  node ensure-fuel-cache.mjs --region=us --force-extract
  # or: node build-fuel-us-all.mjs --refresh
  ```

### Key files (US branded)

| File | Role |
|------|------|
| `fuel-us-brand-catalog.json` | Brand matching rules — **primary knob** |
| `fuel-us-ingest/00-all-fuel/fuel-all-us.json` | Cached extract of all US fuel POIs (gitignored) |
| `fuel-us-ingest/01-osm/fuel-merged.json` | Filtered catalog matches (gitignored) |
| `fuel-us-master.json` | Canonical records (committed) |
| `fuel-us-explorer-embed.js` | Browser bundle `FUEL_US` (committed) |

### Encoding

Fuel JSON may be stored as UTF-16 when synced via Google Drive. `readJson` in `fuel-us-lib.mjs` / `fuel-ca-lib.mjs` handles both. Do not re-save committed JSON as UTF-16.

## Other pipelines

Camping, playgrounds, scenic, and historic POIs follow similar build patterns. See [README.md](README.md) and layer-specific `*.md` docs.

**scenic-router ingest:** [SCENIC-ROUTER-INGEST.md](SCENIC-ROUTER-INGEST.md) — never replace ingest artifacts with explorer output.

**Map explorer:** `node build-poi-explorer-data.mjs` → `poi-explorer.html` (scenic kept/excluded, benchmark cases, fuel, camping, playgrounds, historic, NPS).

## Scenic overlook road distances — read this before editing

Scenic viewpoints are filtered by drivable road access. **Read [SCENIC-ROAD-DISTANCES.md](SCENIC-ROAD-DISTANCES.md) first.**

### Do NOT

- Add or use a non-osmium fallback for scenic road distances (legacy batched PBF scan was removed)
- Early-exit distance search before finding the true nearest segment inside the 250 m envelope
- Scan roads beyond **250 m** when measuring overlook distance — store `"far"` instead
- Apply road-distance logic to non-viewpoint POI kinds
- Run scenic road steps without `node build-scenic-install-osmium.mjs` (or system osmium) first

### Do

- Use **osmium-tool only** — `requireOsmium()` guards all scenic road scripts
- Use `DEFAULT_SCENIC_MEASURE_MAX_M` (250 m) for search/measure; `DEFAULT_ROAD_MAX_DISTANCE_M` (120 m) for filter inclusion
- Full pipeline: `node build-scenic-road-access-all.mjs --region=us --refresh`
- Re-filter without rescan: `node build-scenic-filter-road-access.mjs --region=us --max-m=120`

## NPS visitor centers — read this before editing

See [NPS-VISITOR-CENTERS.md](NPS-VISITOR-CENTERS.md).

### Do NOT

- Use **Overpass** for visitor-center OSM verification — it rate-limits and takes hours
- Use **Overpass** for any OSM work when the relevant Geofabrik PBF is already on disk — see [POI-OSM-PBF.md](POI-OSM-PBF.md)
- Run `--verify-osm` without `osm-pbf/geofabrik/us-latest.osm.pbf` on disk

### Do

- Use **local Geofabrik PBF** only — `nps-visitor-centers-osm-verify.mjs` scans US PBF once, caches candidates
- OSM verify: `node build-nps-visitor-centers-master.mjs --verify-osm` (add `--refresh-osm` to rescan PBF)
- Full pipeline: `node build-nps-visitor-centers-all.mjs --require-api`

## Parks Canada — read this before editing

Unit catalog: [PARKS-CANADA.md](PARKS-CANADA.md). Visitor centres: [PARKS-CANADA-VISITOR-CENTERS.md](PARKS-CANADA-VISITOR-CENTERS.md).

### Do NOT

- Hand-edit `parks-canada-geo.json` or `parks-canada-visitor-centers-ca-master.json` — rebuild via pipeline
- Fold Canada visitor centres into US `nps-visitor-centers-*` files
- Use **Overpass** for PC visitor-center OSM verify when `canada-latest.osm.pbf` is on disk

### Do

- Build catalog first: `node build-parks-canada-cache.mjs` (PC-001)
- Visitor centres: `node build-parks-canada-visitor-centers-all.mjs` (requires PC-001)
- OSM verify: add `--verify-osm` (local Canada PBF only)
- Park boundaries: `node build-park-boundaries.mjs` (PB-001; reads `parks-canada-geo.json` for CA park codes)

## NPS map pins — read this before editing

See [NPS-MAP-PINS.md](NPS-MAP-PINS.md).

### Do NOT

- Use visitor center or headquarters coords for catalog `lat`/`lon` in `nps-us-geo.json`
- Hand-edit `nps-us-park-pins.json` — rebuild via `node build-nps-us-cache.mjs`

### Do

- Pin from boundary centroid (`coordSource: boundary_centroid`)
- Multi-pin distant units via `mapPins` (≥ 25 km cluster split); manual gaps in `nps-park-pin-overrides.json`
