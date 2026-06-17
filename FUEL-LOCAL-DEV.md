# Fuel local development (any repo clone)

This document describes how to work with branded fuel filtering on **any copy** of this repository without committing multi-GB PBF files to GitHub.

## Design

```
Geofabrik PBF (local only, gitignored)
        │
        ▼  slow — once per PBF, or when PBF updates
fuel-*-ingest/00-all-fuel/fuel-all-*.json   ← raw fuel POI cache
fuel-*-ingest/00-all-fuel/manifest.json     ← links cache to PBF fingerprint
        │
        ▼  fast — seconds, repeat freely
fuel-*-ingest/01-osm/fuel-merged.json       ← catalog filter output
        │
        ▼
fuel-*-master.json → fuel-explorer-data.js → fuel-explorer.html
```

| Artifact | In git? | Purpose |
|----------|---------|---------|
| `osm-pbf/geofabrik/*.osm.pbf` | **No** | Source OSM extract (~6–11 GB) |
| `fuel-*-ingest/` | **No** | Rebuildable caches |
| `fuel-*-master.json`, embeds, explorer data | **Yes** | Published bundles for the app |

## First-time setup (new clone)

```bash
node build-poi-osm-install-deps.mjs    # osm-pbf-parser
node ensure-fuel-cache.mjs --region=us   # download PBF + extract cache
node ensure-fuel-cache.mjs --region=ca   # optional: Canada
```

Or full US pipeline (bootstrap + filter + master + explorer):

```bash
node build-fuel-us-all.mjs
```

### Smaller US dev download (Texas proof ~350 MB)

```bash
node ensure-fuel-cache.mjs --region=us --proof
```

Uses `texas-latest.osm.pbf` instead of full US. Good for testing scripts; not for production US counts.

## Daily workflow (catalog tuning)

**No PBF parse.** Edit `fuel-us-brand-catalog.json`, then:

```bash
node build-fuel-us-filter-brands.mjs
node build-fuel-us-master.mjs
node build-fuel-explorer-data.mjs
# refresh fuel-explorer.html
```

## Check what you have locally

```bash
node fuel-cache-status.mjs --region=both
```

Reports PBF presence, cache size, whether cache is stale vs current PBF.

## When to re-extract (slow)

Re-run extract only when:

- Geofabrik PBF was re-downloaded (`node build-poi-osm-download.mjs --force`)
- `fuel-cache-status` reports **stale**
- You pass `--force-extract` or `--refresh`

```bash
node ensure-fuel-cache.mjs --region=us --force-extract
# or
node build-fuel-us-all.mjs --refresh
```

## Evaluate filter quality

1. `node build-fuel-explorer-data.mjs`
2. Open `fuel-explorer.html`
3. Optional false-negative probe (per state, needs cache):

```bash
node build-fuel-explorer-cache-slice.mjs --region=us --state=PA
# load fuel-explorer-cache/us-PA-unmatched.json in the explorer UI
```

## Sharing caches between machines (optional)

Caches are gitignored. To avoid re-downloading/re-parsing on another machine:

- Copy `fuel-us-ingest/00-all-fuel/` (cache + manifest), or
- Copy both `osm-pbf/` and `fuel-us-ingest/`

Do **not** commit these to GitHub.

## Related scripts

| Script | Role |
|--------|------|
| `build-poi-osm-download.mjs` | Download PBF from Geofabrik |
| `ensure-fuel-cache.mjs` | Bootstrap: deps → download → extract |
| `fuel-cache-status.mjs` | Doctor / status report |
| `build-fuel-us-filter-brands.mjs` | Fast catalog filter (needs cache) |
| `build-fuel-explorer-data.mjs` | Map explorer bundle |
| `validate-fuel-us.mjs` | Sanity-check published outputs |

See also [FUEL-US.md](FUEL-US.md), [FUEL-CA.md](FUEL-CA.md), [AGENTS.md](AGENTS.md).
