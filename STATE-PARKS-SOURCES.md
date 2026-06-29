# State parks source matrix (SP-001)

Per-state and per-province data source research for the state/provincial parks catalog. Machine-readable matrix: `state-parks-source-matrix.json`.

## Research workflow

Listing-backed catalog (Texas reference → all Tier-A): **[STATE-PARKS-LISTINGS.md](STATE-PARKS-LISTINGS.md)**.

```bash
# Probe seeded URLs + ArcGIS Hub search + merge overrides → matrix
node build-state-parks-research-all.mjs

# Probe seed URLs only (fast)
node build-state-parks-discover-sources.mjs --region=us

# ArcGIS Hub search (improved ranking, excludes PAD-US / national layers)
node build-state-parks-search-arcgis-hub.mjs --state=PA,WI

# Apply manual overrides from state-parks-source-overrides.json
node build-state-parks-apply-matrix-overrides.mjs
```

Raw probe output (gitignored): `state-parks-ingest/00-research/discovery-us.json`, `hub-search-us.json`.

## Source tiers

| Tier | Type | Ingest |
|------|------|--------|
| A | ArcGIS FeatureServer / MapServer (open query) | `build-state-parks-ingest-official.mjs` |
| B | Open-data portal download (GeoJSON/CSV/shp) | Future |
| C | Documented REST/JSON API | Future |
| D | Scrape official HTML listing | Future |
| E | PAD-US (USGS) | Cross-check only — not primary |
| F | OSM PBF | `build-state-parks-extract-pbf.mjs` (always secondary) |

## Verified US sources (Tier A)

| ST | Agency | Records (ingest) | Endpoint |
|----|--------|------------------|----------|
| AK | Alaska DNR | ~137 | [Recreational_ParkBoundary/2](https://arcgis.dnr.alaska.gov/arcgis/rest/services/OpenData/Recreational_ParkBoundary/FeatureServer/2) |
| CA | California State Parks | ~285 | [ParkEntryPoints/2](https://services2.arcgis.com/AhxrK3F6WM8ECvDi/ArcGIS/rest/services/ParkEntryPoints/FeatureServer/2) |
| FL | Florida DEP | ~176 | [PARKS_BOUNDARIES/0](https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/PARKS_BOUNDARIES/MapServer/0) |
| MN | Minnesota DNR | ~73 | [bdry_dnr_managed_areas/2](https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_dnr/bdry_dnr_managed_areas/FeatureServer/2) |
| MO | Missouri DNR | ~89 | [Missouri_State_Parks_Boundaries/4](https://gis.dnr.mo.gov/server/rest/services/parks/Missouri_State_Parks_Boundaries/FeatureServer/4) |
| NC | NC State Parks | ~69 | [NC_State_Parks_System/0](https://services6.arcgis.com/nRIB86xC7kq6wavB/arcgis/rest/services/NC_State_Parks_System/FeatureServer/0) |
| NY | NYS OPRHP | ~206 | [NYS_Park_Polygons/0](https://services.arcgis.com/1xFZPtKn1wKC6POA/arcgis/rest/services/NYS_Park_Polygons/FeatureServer/0) |
| SC | SC State Parks | ~55 | [South_Carolina_State_Parks/0](https://services5.arcgis.com/bPacKTm9cauMXVfn/ArcGIS/rest/services/South_Carolina_State_Parks/FeatureServer/0) |
| TX | TPWD | ~108 | [Texas_State_Parks_Boundaries/0](https://services1.arcgis.com/1mtXwieMId59thmg/ArcGIS/rest/services/Texas_State_Parks_Boundaries/FeatureServer/0) |
| WA | WSPRC | ~204 | [ParkBoundaries/2](https://services5.arcgis.com/4LKAHwqnBooVDUlX/arcgis/rest/services/ParkBoundaries/FeatureServer/2) |
| TN | Tennessee State Parks | ~66 | [TN_State_Parks_Boundaries/0](https://services5.arcgis.com/bPacKTm9cauMXVfn/arcgis/rest/services/TN_State_Parks_Boundaries/FeatureServer/0) |
| NE | Nebraska Game and Parks | ~72 | [Nebraska_State_Parks/0](https://services6.arcgis.com/Sjtjj6zwMH9eAgbl/arcgis/rest/services/Nebraska_State_Parks_by_Jennifer_Nelson_/FeatureServer/0) |
| UT | Utah State Parks | ~55 | [Utah_State_Parks/0](https://services.arcgis.com/ZzrwjTRez6FJiOq4/arcgis/rest/services/Utah_State_Parks/FeatureServer/0) |
| ND | ND Parks and Recreation | ~15 | [NDGISHUB_State_Parks/0](https://services1.arcgis.com/GOcSXpzwBHyk2nog/arcgis/rest/services/NDGISHUB_State_Parks/FeatureServer/0) |
| PA | Pennsylvania DCNR | ~114 | [State_Parks/MapServer/9](https://www.gis.dcnr.pa.gov/agsprod/rest/services/Parks/State_Parks/MapServer/9) |
| IN | Indiana DNR | ~27 | [Sites_StateParks/8](https://gisdata.in.gov/server/rest/services/Hosted/Sites_StateParks/FeatureServer/8) |
| OR | Oregon OPRD | ~63 | [Oregon_State_Parks/0](https://maps.prd.state.or.us/arcgis/rest/services/Land_ownership/Oregon_State_Parks/FeatureServer/0) |

Manual overrides and field maps: `state-parks-source-overrides.json`.

## Blocked / gap states (need manual research)

These had **zero OSM coverage** or no viable Tier A source after automated search:

| ST | Status | Next step |
|----|--------|-----------|
| DC | `none` | No state park system — NPS/local only |
| DE | `verified` | [FirstMap ORPTP Open Space layer 10](https://enterprise.firstmaptest.delaware.gov/arcgis/rest/services/Environmental/DE_Protected_Natural_Resources/FeatureServer/10) — `AGENCY='Parks'` |
| NV | `verified` | [NDSL Nevada_State_Lands MapServer/17](https://arcgis.water.nv.gov/arcgis/rest/services/NDSL/Nevada_State_Lands/MapServer/17) Parks layer |
| RI | `verified` | [RIDEM Conserved_Land layer 3](https://risegis.ri.gov/hosting/rest/services/RIDEM/Conserved_Land_in_RI_v2/MapServer/3) — `PrimUse IN ('State Park','State Beach')` |
| SD | `verified` | [ArcGIS Online CDC mirror layer 18](https://services8.arcgis.com/3imH29cidUY8teIo/ArcGIS/rest/services/mtribble_cdcfors_South_Dakota_layers/FeatureServer/18) (gfpgis Parks folder empty) |
| VT | `verified` | [ANR OPENDATA_ANR_TOURISM_SP layer 0](https://anrmaps.vermont.gov/arcgis/rest/services/Open_Data/OPENDATA_ANR_TOURISM_SP_NOCACHE_v2/MapServer/0) |
| WV | `verified` | [WV_Public_Lands FeatureServer/3](https://services9.arcgis.com/SQbkdxLkuQJuLGtx/ArcGIS/rest/services/WV_Public_Lands/FeatureServer/3) |
| WI | `verified` | [DNR managed property layer 6](https://dnrmaps.wi.gov/arcgis/rest/services/LF_DML/LF_DNR_MGD_PROPERTY_WTM_Ext/MapServer/6) — `PROP_NAME LIKE '%STATE PARK%'` |
| PA | `verified` | **Ingested** — DCNR MapServer layer 9 |

Also blocked after bad Hub matches (rejected): IN, UT — do not use national “USA Parks” or unrelated layers.

**Previously blank — now filled:** DE, NV, RI, SD, VT, WV, WI. **DC** remains excluded (no state park system).

## Canada provinces

Provincial research pending. BC candidate: [BC Parks Established Protected Areas](https://services6.arcgis.com/ubm4tcTYICKBpist/ArcGIS/rest/services/BC_Parks_Established_Protected_Areas/FeatureServer). Run:

```bash
node build-state-parks-search-arcgis-hub.mjs --region=ca
```

## Adding a verified source

1. Confirm endpoint with `returnCountOnly=true` and sample attributes.
2. Add row to `state-parks-source-overrides.json` with `queryUrl`, `where`, `fieldMap`.
3. Run `node build-state-parks-apply-matrix-overrides.mjs`.
4. Ingest: `node build-state-parks-ingest-official.mjs --refresh --state=XX`.
5. Rebuild: `node build-state-parks-all.mjs` (skips network if caches present).

## License

Document `license` per row. OSM = ODbL. State GIS typically public domain or open government — verify before redistributing scraped data.

## QA signals

- `validate-state-parks.mjs` compares master per-state counts to matrix expectations and fails on catalog leakage (WMA/hatchery/operator guesses).
- `build-state-parks-cross-check.mjs` writes `state-parks-cross-check-report.json` — master vs Tier-A GIS vs public listing URLs.
- Cross-check source URLs (all states): `state-parks-cross-check-sources.json` (generate with `node build-state-parks-cross-check.mjs --write-sources`).
- Hub auto-verify rejects layers with >5,000 features or national-scope titles (PAD-US, USA Parks, etc.).
- Official ingest aborts if raw feature count >3,000 without a narrowed `where` clause.

### Cross-check tiers

| Tier | Source | Use |
|------|--------|-----|
| A | State GIS (matrix) | Primary ingest |
| Listing | Agency park finder / A–Z | Manual count spot-check — URLs in `state-parks-cross-check-sources.json` |
| Wiki | Wikipedia `List of {state} state parks` | Secondary count check |
| NASPD | [stateparks.org/locate-a-park](https://stateparks.org/locate-a-park/) | Agency directory |
| ASP | [americasstateparks.org](https://www.americasstateparks.org/state-park-agencies/) | Agency + park finder (third-party) |
| E | PAD-US (USGS) | National cross-check only — not primary |
| F | OSM PBF | Secondary; explicit naming required when Tier A exists |
