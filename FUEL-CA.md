# Canada fuel / highway stops

High-volume corporate highway stops with consistent facilities. Catalog: `fuel-ca-brand-catalog.json`.

## Brands (tier A)

| brandId | Include | Exclude |
|---------|---------|---------|
| `pilot` / `flyingj` | Pilot Travel Center, Flying J (same matchers as US) | — |
| `irving_bigstop` | Irving **Big Stop** only | Plain Irving stations |
| `onroute` | ONroute highway service centres (ON) | — |
| `petro_pass` | **Petro-Pass** travel plazas | Plain Petro-Canada retail |
| `husky_travel` | **Husky Travel Center** | Ordinary Husky gas bars |

## Local OSM source (use this)

**Do not use Overpass** for routine builds. Canada extract is on disk:

- `tools/osm-pbf/geofabrik/canada-latest.osm.pbf` (~6 GB)

Scans `amenity=fuel`, `shop=fuel`, and `highway=services` / `rest_area` (for ONroute and travel centers).

## Interactive explorer

Same map UI as US: open `fuel-explorer.html` after `node build-fuel-explorer-data.mjs`. Switch region to Canada in the sidebar.

## Build

```bash
node build-fuel-ca-all.mjs
```

Or step by step:

```bash
node build-fuel-ca-extract-all-pbf.mjs
node build-fuel-ca-filter-brands.mjs
node build-fuel-ca-master.mjs
node build-fuel-ca-explorer-embed.mjs
```

## Second-pass supplements (optional)

Add confirmed locations from Google Maps, operator sites, or manual QA to `fuel-ca-supplements.json`. They merge in `build-fuel-ca-master.mjs` with flag `SUPPLEMENT`.

## Output

- `fuel-ca-ingest/01-osm/fuel-merged.json` — PBF scan results
- `fuel-ca-master.json`
- `fuel-ca-qa-report.json` — counts by brand/province
- `fuel-ca-explorer-embed.js` → `FUEL_CA` (route editor map layer)

Province codes reuse the `state` field (AB, BC, ON, …).

## Legacy Overpass scripts (fallback only)

```bash
node build-fuel-ca-ingest-osm.mjs --provinces=BC,AB,ON
node build-fuel-ca-ingest-onroute.mjs
```

Use only if the local PBF is missing.
