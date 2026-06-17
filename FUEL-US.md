# US fuel stops (tier A brand catalog)

Static list of **8 brand groups** from OpenStreetMap — high-quality travel/convenience stops, not every branded gas station.

**Buc-ee's** uses `strict` matching (brand/operator/`nameContains` only) because OSM has many false `name=Buc-ee's` pins without a brand tag.

| brandId | Name |
|---------|------|
| bucees | Buc-ee's |
| quiktrip | QuikTrip (QT) |
| racetrac | RaceTrac |
| wawa | Wawa |
| sheetz | Sheetz |
| loves | Love's |
| pilot | Pilot |
| flyingj | Flying J (merged with Pilot when co-located) |

Generic (non-catalog) US fuel is a **separate layer**: `FUEL_GENERIC_US` via `build-fuel-generic-explorer-embed.mjs`.

## Local setup (any clone)

See **[FUEL-LOCAL-DEV.md](FUEL-LOCAL-DEV.md)**. Summary:

```bash
node ensure-fuel-cache.mjs --region=us   # once: download PBF + build cache
node build-fuel-us-filter-brands.mjs       # fast: re-apply catalog
```

## Local OSM source (use this)

**Do not use Overpass** for routine US branded-fuel builds. The full US extract is on disk:

- `osm-pbf/geofabrik/us-latest.osm.pbf` (~11 GB, from Geofabrik)

See `POI-OSM-PBF.md` for download instructions.

## Interactive explorer

Open **`fuel-explorer.html`** in a browser (after `node build-fuel-explorer-data.mjs`).

- **Matched** — catalog stations in `fuel-us-master.json` (color by brand)
- **Suppressed** — deduped near-duplicates (after master build writes `fuel-us-suppressed.json`)
- **Unmatched** — load a cache slice JSON to see OSM fuel that did *not* match the catalog

Rebuild explorer data after filter changes:

```bash
node build-fuel-us-filter-brands.mjs && node build-fuel-us-master.mjs && node build-fuel-explorer-data.mjs
```

Export unmatched POIs for a state (requires fuel cache on disk):

```bash
node build-fuel-explorer-cache-slice.mjs --region=us --state=PA
```

Then load `fuel-explorer-cache/us-PA-unmatched.json` in the explorer sidebar.

## Build (recommended)

Two-phase pipeline (same pattern as Canada — fast catalog iteration):

```bash
node build-fuel-us-all.mjs
```

Or step by step:

```bash
node build-fuel-us-extract-all-pbf.mjs    # phase 1: cache ALL fuel POIs (slow; skip if cache exists)
node build-fuel-us-filter-brands.mjs      # phase 2: apply catalog (fast)
node build-fuel-us-master.mjs
node build-fuel-us-explorer-embed.mjs
node validate-fuel-us.mjs
```

After tweaking `fuel-us-brand-catalog.json`, re-run **only** filter + master + embed (seconds):

```bash
node build-fuel-us-filter-brands.mjs && node build-fuel-us-master.mjs && node build-fuel-us-explorer-embed.mjs
```

Rescan the PBF when Geofabrik updates the extract:

```bash
node build-fuel-us-all.mjs --refresh
```

## Debug / iterate on matches

Search the cached extract without rescanning:

```bash
node search-fuel-us-cache.mjs "loves travel" [--limit=50]
```

## Overpass (legacy / fallback only)

Only if the local PBF is missing:

```bash
node build-fuel-us-ingest-osm.mjs
node build-fuel-us-ingest-osm.mjs --state=TX
```

`build-fuel-us-ingest-pbf.mjs` is deprecated — it now runs the fast filter step only (requires extract cache).

## Outputs

| File | Purpose |
|------|---------|
| `fuel-us-brand-catalog.json` | Brand matching rules |
| `fuel-us-ingest/00-all-fuel/fuel-all-us.json` | All US fuel POIs from PBF (cache) |
| `fuel-us-ingest/01-osm/fuel-merged.json` | Catalog-filtered matches |
| `fuel-us-master.json` | Canonical records |
| `fuel-us-qa-report.json` | Counts by brand/state |
| `fuel-us-explorer-embed.js` | `var FUEL_US` for browsers |

## Browser

```html
<script src="fuel-us-explorer-embed.js"></script>
```

`FUEL_US.records` — array of `{ id, name, brand, brandId, lat, lon, state, type, diesel, url, highway }`.

## Agent note

**Do not hand-edit** `fuel-us-master.json` or `fuel-us-explorer-embed.js`. See [AGENTS.md](AGENTS.md).

## OSM

Data © OpenStreetMap contributors (ODbL).
