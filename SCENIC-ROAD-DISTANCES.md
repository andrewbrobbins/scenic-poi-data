# Scenic overlook road-distance cache

**Read this before changing scenic viewpoint road-access code.**

## Purpose

Scenic overlooks (`tourism=viewpoint`) are filtered by **drivable road access**. OSM viewpoint tags are not trusted for access — trail pull-offs far from highways are excluded.

## Required tooling

**`osmium-tool` is mandatory.** There is no legacy/fallback PBF scan path.

```bash
node build-scenic-install-osmium.mjs   # bundled micromamba install (Linux/macOS/Windows)
# or: apt install osmium-tool / conda install -c conda-forge osmium-tool
```

All scenic road scripts call `requireOsmium()` and exit with install instructions if missing.

## Pipeline (single path)

1. `build-scenic-highways-extract.mjs` — lean highways PBF per region
2. `build-scenic-paths-parking-extract.mjs` — paths/parking for access heuristics
3. `build-scenic-road-distances.mjs` — osmium bbox clips → `road-distances.json` (`features` + `distances`)
4. `build-scenic-filter-road-access.mjs` — apply inclusion threshold (`--max-m`, default **120 m**)
5. `build-poi-osm-master.mjs` / `build-poi-osm-explorer-embed.mjs` — publish bundles

Or run the orchestrator:

```bash
node build-scenic-road-access-all.mjs --region=ca --refresh
```

## Critical rules (do not regress)

### 1. Only scenic overlooks need road distance

This scan is **only** for `viewpoint` POIs. Playgrounds, historic, fuel, camping, etc. do **not** use this cache.

### 2. Two distance thresholds — do not confuse them

| Constant | Default | Role |
|----------|---------|------|
| `DEFAULT_SCENIC_MEASURE_MAX_M` | **250 m** | How far to **search** when measuring. Beyond this → cache `"far"`. |
| `DEFAULT_ROAD_MAX_DISTANCE_M` | **120 m** | **Inclusion** threshold in `build-scenic-filter-road-access.mjs`. |

Measuring out to 250 m lets us retune the 120 m filter without rescanning PBF.

### 3. 250 m search cap — performance requirement

When measuring overlook → road distance:

- **Only search roads within ~250 m** of the viewpoint (bbox clips padded by `maxMeasureM`).
- If the nearest drivable road is **> 250 m**, store `"far"` — do **not** scan farther roads.
- If **no road** exists within the search envelope, store `null`.
- Find the **true nearest** road inside the envelope. **Never early-exit** on the first segment found — that caused wrong distances (see `scenic-road-access-benchmark.json`, Seton case).

Implementation: `classifyScenicRoadDistance` in `poi-road-network.mjs`, osmium bbox clips in `scenic-road-osmium-scan.mjs`.

### 4. Cache shape

Mode is always `osmium-features-v3`. Each viewpoint has:

- `features`: `{ dLean, dPath, dParking, ... }` for path-parking-v2 filter
- `distances`: classified value (`number` ≤ 250 m, `"far"`, or `null`)

**Do not add a distance-only / batched-PBF fallback.** It was removed because it was slow, error-prone, and incompatible with the filter.

## Commands

```bash
node build-scenic-install-osmium.mjs

# Rebuild distance cache
node build-scenic-road-distances.mjs --region=us --refresh

# Re-filter only (instant — no PBF rescan)
node build-scenic-filter-road-access.mjs --region=us --max-m=120

# Full scenic road-access pipeline
node build-scenic-road-access-all.mjs --region=ca --refresh
```

## Key files

| File | Role |
|------|------|
| `build-scenic-install-osmium.mjs` | Install osmium-tool |
| `scenic-osmium-lib.mjs` | Osmium CLI + `requireOsmium()` |
| `build-scenic-road-distances.mjs` | Distance cache orchestrator |
| `scenic-road-osmium-scan.mjs` | Per-tile bbox clip scan |
| `build-scenic-filter-road-access.mjs` | Apply 120 m inclusion |
| `scenic-*-ingest/01-osm/road-distances.json` | Cache (gitignored ingest) |

## Benchmark

Regression cases: `scenic-road-access-benchmark.json`. Visualize on map: `node build-poi-explorer-data.mjs` → `poi-explorer.html` (Benchmark layer).
