# Agent guidelines (scenic-poi-data)

This repo builds **static map bundles** from OpenStreetMap. Many outputs are committed JSON/JS files that the scenic-router app loads directly.

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
| `fuel-us-ingest/00-all-fuel/fuel-all-us.json` | Cached extract of all US fuel POIs (**committed**) |
| `fuel-us-ingest/01-osm/fuel-merged.json` | Filtered catalog matches (**committed**) |
| `fuel-us-master.json` | Canonical records (committed) |
| `fuel-us-explorer-embed.js` | Browser bundle `FUEL_US` (committed) |

### Encoding

Fuel JSON may be stored as UTF-16 when synced via Google Drive. `readJson` in `fuel-us-lib.mjs` / `fuel-ca-lib.mjs` handles both. Do not re-save committed JSON as UTF-16.

## Other pipelines

Camping, playgrounds, scenic, and historic POIs follow similar build patterns. See [README.md](README.md) and layer-specific `*.md` docs.
