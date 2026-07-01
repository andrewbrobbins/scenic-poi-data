# State park amenities — US progress tracker

Per-state status for **state park amenity** ingest (parking, restrooms, campgrounds, visitor centers). NPS amenities are separate — see [PARK-AMENITIES.md](PARK-AMENITIES.md).

Related docs: [PARK-AMENITIES-STATE-SOURCES.md](PARK-AMENITIES-STATE-SOURCES.md) (layer details), [STATE-PARKS-SOURCES.md](STATE-PARKS-SOURCES.md) (SP-001 boundaries).

**Last updated:** 2026-07-01

Master artifacts are **sharded** on `main` (`park-amenities-us-nps-master.json` + `park-amenities-us-state-master/{ST}.json` + manifest) — see [PARK-AMENITIES.md](PARK-AMENITIES.md).

## Progress table

| State | Catalog (SP-001) | Boundaries GIS | Amenity ArcGIS | OSM fallback | Ingest wired | Notes |
|-------|------------------|----------------|----------------|--------------|--------------|-------|
| **CA** | Yes Tier A | Yes ParkEntryPoints + ParkBoundaries | Yes 6 layers (~12.6k features) | Yes PBF | **Yes** | Reference state — all amenity kinds wired in `park-amenities-state-sources.json` |
| **TX** | Yes Tier A (116) | Yes Texas_State_Parks_Boundaries | Probed — HQ/access (129), public areas (123), TWDB campgrounds (6093) | Yes PBF | No | TWDB campground layer is statewide (includes private/KOA); needs Source filter or spatial join. No dedicated restroom/parking lot layers found on TPWD hub |
| **FL** | Yes Tier A (179) | Yes PARKS_BOUNDARIES (DEP) | None found | Yes PBF | No | Hub search returned no FL park amenity layers; DEP OpenData folder has boundaries only |
| **WA** | Yes Tier A (207) | Yes ParkBoundaries | Probed — Campsites/78 (6124), ParkingAreas (622), Park_Entrances (203), FacilityInventory restrooms (287), visitor/ranger (17) | Yes PBF | No | Richest non-CA lead; Campsites uses layer **78** not 0; FacilityInventory TYPE codes need domain map |
| **WY** | Yes (boundaries) | Yes | Probed Parking_Areas (206 polygons) | Yes PBF | No | Hub parking layer has `Facility` park name field — field map TBD |
| **CO** | Blocked (SP-001) | No | Probed CPWAdminData (5520 mixed facilities) | Yes PBF | No | Quick win for amenity research; filter PROP_TYPE to state parks; catalog blocked in matrix |
| **OR** | Yes Tier A (63) | Yes Oregon_State_Parks | Not searched on agency server yet | Yes PBF | No | Hub search hit scenic waterways only — probe OPRD server next |
| **NY** | Yes Tier A (858) | Yes NYS_Park_Polygons | Not found | Yes PBF | No | Large boundary catalog; amenity GIS TBD |
| **MN** | Yes Tier A (75) | Yes bdry_dnr_managed_areas | Hub = trails/boundaries only | Yes PBF | No | DNR trails layer (27k) is not amenities |
| **Other (49 verified)** | Yes per matrix | Yes per matrix | Generally none | Yes PBF | No | Boundaries in SP-001; amenity gap — OSM fills today |

## Discovery artifacts (2026-06-29)

| Artifact | Path |
|----------|------|
| Boundary hub search | `state-parks-ingest/00-research/hub-search-us.json` |
| Amenity hub search | `park-amenities-us-ingest/00-research/amenity-hub-search.json` |
| Layer probes | `park-amenities-us-ingest/00-research/state-amenity-discovery.json` |
| Seeds | `park-amenities-state-seeds.json` |
| Tier-A ingest config | `park-amenities-state-sources.json` |

## Hub discovery — TX, FL, WA (2026-06-29)

### Texas (TPWD)

| Layer | Count | Amenity | Parent link fields |
|-------|------:|---------|-------------------|
| [Texas_State_Parks_Headquarters__Access_Points](https://services1.arcgis.com/1mtXwieMId59thmg/arcgis/rest/services/Texas_State_Parks_Headquarters__Access_Points/FeatureServer/0) | 129 | visitor_center / access | `LoCode`, `Name`, `Comments` (Park Headquarters) |
| [Texas_State_Parks_Public_Areas](https://services1.arcgis.com/1mtXwieMId59thmg/arcgis/rest/services/Texas_State_Parks_Public_Areas/FeatureServer/0) | 123 | parking (park-level) | `ParkName` |
| [Texas_Campgrounds (TWDB)](https://gis1.twdb.texas.gov/server/rest/services/WSC-FSCA-FM/Texas_Campgrounds/MapServer/0) | 6093 | campground | `Camp_Name`; filter `Source` / `Camp_Type` (many private) |

Boundary hub search (catalog-oriented) did not surface TPWD amenity layers — agency server crawl found the above on `services1.arcgis.com/1mtXwieMId59thmg`.

### Florida (DEP)

| Layer | Count | Notes |
|-------|------:|-------|
| [PARKS_BOUNDARIES](https://ca.dep.state.fl.us/arcgis/rest/services/OpenData/PARKS_BOUNDARIES/MapServer/0) | 179 | Boundaries only — SP-001 wired |
| — | — | No campground/parking/restroom/visitor FeatureServer on DEP OpenData folder |

Amenity hub search: no viable FL-specific amenity layers. **OSM PBF fallback** is the near-term path.

### Washington (WSPRC)

| Layer | Count | Amenity | Parent link fields |
|-------|------:|---------|-------------------|
| [Campsites / layer 78](https://services5.arcgis.com/4LKAHwqnBooVDUlX/arcgis/rest/services/Campsites/FeatureServer/78) | 6124 | campground | `ParkCode`, `ParkName`, site `Name` |
| [ParkingAreas](https://services5.arcgis.com/4LKAHwqnBooVDUlX/arcgis/rest/services/ParkingAreas/FeatureServer/0) | 622 | parking | `ParkName` (polygon, centroid ingest) |
| [Park_Entrances](https://services5.arcgis.com/4LKAHwqnBooVDUlX/arcgis/rest/services/Park_Entrances/FeatureServer/0) | 203 | parking / access | `ParkCode`, `ParkName` |
| [FacilityInventory](https://services5.arcgis.com/4LKAHwqnBooVDUlX/arcgis/rest/services/FacilityInventory/FeatureServer/0) (filtered) | 287 / 17 | restroom / visitor_center | `Park`, `PI` (park code), `Name`, `TYPE` |

Hub boundary search also surfaced ParkingAreas (622) under WA.

### Other quick wins (CO, OR, NY, MN)

| ST | Best amenity lead | Count | Notes |
|----|-------------------|------:|-------|
| CO | [CPWAdminData](https://services5.arcgis.com/ttNGmDvKQA7oeDQ3/arcgis/rest/services/CPWAdminData/FeatureServer/0) | 5520 | `PROP_TYPE`, `FAC_TYPE`, `FAC_NAME`, `PARK_ID` — mixed SWA/parks |
| OR | — | — | Hub: scenic waterways only; probe `maps.prd.state.or.us` OPRD server |
| NY | — | — | Hub: no amenity layers; NYS parks polygons only |
| MN | — | — | Hub: trails (27k) + boundaries; no amenity points |

## Todo checklist

### Done

- [x] Full US rebuild pipeline (`build-park-amenities-us-all.mjs`) — **108,235 master records** (2026-06-29)
- [x] Hub boundary search: TX, FL, WA, CO, OR, NY, MN
- [x] Amenity-focused ArcGIS search + TPWD/WSPRC server crawl
- [x] Seeds updated: TX, FL, WA, CO in `park-amenities-state-seeds.json`
- [x] Layer probes: CA, TX, FL, WA, WY, CO

### Next — WA (highest value)

- [ ] Map `FacilityInventory.TYPE` domain (508 = vault toilet, 900 = residence, …)
- [ ] Add WA layers to `park-amenities-state-sources.json` (Campsites/78, ParkingAreas, filtered FacilityInventory)
- [ ] Wire parent link via `ParkCode` / `PI` to SP-001 catalog
- [ ] Re-run `build-park-amenities-us-all.mjs` and validate counts

### Next — TX

- [ ] Promote HQ/Access Points as `visitor_center` (filter `Comments=Park Headquarters`)
- [ ] Evaluate TWDB campgrounds — spatial join to TPWD boundaries or filter `Source=TPWD`
- [ ] Check TPWD hub for campsite/reservation layers not indexed by Hub search

### Next — FL

- [ ] Confirm OSM amenity counts for FL state parks post-rebuild
- [ ] Manual search: Florida State Parks open data / FGDL for campground GIS
- [ ] Optional: scrape ReserveAmerica / park finder if no GIS emerges

### Next — other verified-boundary states (49 total)

- [ ] Batch amenity Hub search with queries: `{state} state parks campground FeatureServer`
- [ ] Prioritize MO, NC, NY, OR (Tier-A boundaries, large catalogs)
- [ ] WY: promote Parking_Areas after field map (`Facility` to parent name)

### Pipeline / infra

- [ ] Add amenity-specific Hub search script (extend `build-state-parks-search-arcgis-hub.mjs` queries)
- [ ] State polygon boundaries for spatial parent link on OSM amenities (future)

## Latest build (2026-06-29)

| Metric | Count |
|--------|------:|
| **Master total** | 108,235 |
| NPS ArcGIS ingest | 9,982 |
| State ArcGIS ingest (CA only) | 12,602 |
| State OSM PBF ingest (raw) | 131,860 |
| **State park amenities (master)** | 99,261 |
| State parks with any amenity | 2,034 / 2,786 catalog units |

**By kind:** campground 12,176 · restroom 12,012 · picnic_area 10,606 · parking 71,661 · visitor_center 1,780

Validation: `validate-park-amenities-us.mjs` passed (0 warnings).

## Build reference

```bash
node build-park-amenities-discover-state.mjs --state=CA,TX,FL,WA
node build-park-amenities-us-all.mjs
node validate-park-amenities-us.mjs
```
