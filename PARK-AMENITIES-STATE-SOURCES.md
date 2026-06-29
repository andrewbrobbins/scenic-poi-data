# State park amenities (US)

Research and ingest for **state park** point amenities — parking, restrooms, campsites/campgrounds, and visitor centers — plus boundary/polygon sources.

NPS amenities are already in the main pipeline via NPS Public POIs ArcGIS. This doc covers **state/provincial** parks only.

## Amenity kinds

| User goal | Schema `kind` | Notes |
|-----------|---------------|-------|
| Campsites / campgrounds | `campground` | Developed / backcountry / primitive tiers; individual numbered sites ingested as campground records |
| Bathrooms | `restroom` | Vault/flush/pit subtypes when source provides them |
| Parking | `parking` | Lot or trailhead parking points |
| Visitor centers | `visitor_center` | Ranger stations, museums, interpretive centers |

OSM fallback tags (local PBF only — see [POI-OSM-PBF.md](POI-OSM-PBF.md)):

| Kind | OSM tags |
|------|----------|
| Campground | `tourism=camp_site`, `camp_site=*` |
| Restroom | `amenity=toilets`, `building=toilets` |
| Parking | `amenity=parking`, `parking=yes` |
| Visitor center | `tourism=information` + `information=visitor` / `amenity=ranger_station` / `tourism=museum` |

Parent linking uses `state-parks-*-master.json` (SP-001):

- **ArcGIS `UNITNBR` / `officialCode`** when present (California campgrounds, parking, …)
- **Park unit name** when layers use labels like `Park_Unit: "Montana de Oro SP"` (California restrooms, visitor centers)
- **Spatial fallback** — nearest catalog point within 3–5 km

## Discovery

Probe seeded ArcGIS layers per state:

```bash
node build-park-amenities-discover-state.mjs
node build-park-amenities-discover-state.mjs --state=CA,WY
```

Seeds: `park-amenities-state-seeds.json`  
Output: `park-amenities-us-ingest/00-research/state-amenity-discovery.json` (gitignored)

Tier-A ingest config (verified layers only): `park-amenities-state-sources.json` → `us` block.

## Tier A — California (reference state)

California State Parks publishes a rich FeatureServer on `services2.arcgis.com/AhxrK3F6WM8ECvDi`:

| Amenity | Layer | Count (2026-06) | Parent link | Ingest |
|---------|-------|----------------:|-------------|--------|
| Campgrounds | [Campgrounds](https://services2.arcgis.com/AhxrK3F6WM8ECvDi/ArcGIS/rest/services/Campgrounds/FeatureServer/0) | ~531 | `UNITNBR` | **wired** |
| Individual campsites | [CSP_Campsite_Locations](https://services2.arcgis.com/AhxrK3F6WM8ECvDi/ArcGIS/rest/services/CSP_Campsite_Locations/FeatureServer/0) | ~8251 | `Unit_Num` | **wired** |
| Picnic | [PicnicGrounds](https://services2.arcgis.com/AhxrK3F6WM8ECvDi/ArcGIS/rest/services/PicnicGrounds/FeatureServer/0) | — | `UNITNBR` | **wired** |
| Restrooms | [Restrooms](https://services2.arcgis.com/AhxrK3F6WM8ECvDi/ArcGIS/rest/services/Restrooms/FeatureServer/0) | ~47 | `Park_Unit` name | **wired** |
| Parking | [ParkingPoints](https://services2.arcgis.com/AhxrK3F6WM8ECvDi/ArcGIS/rest/services/ParkingPoints/FeatureServer/0) | ~2342 | `UNITNBR` | **wired** |
| Visitor centers | [Facility_level](https://services2.arcgis.com/AhxrK3F6WM8ECvDi/ArcGIS/rest/services/Facility_level/FeatureServer/0) | ~20 | `Park_Unit` name | **wired** |

Also available but not yet wired: [Parking_Areas](https://services2.arcgis.com/AhxrK3F6WM8ECvDi/ArcGIS/rest/services/Parking_Areas/FeatureServer/0) (161 lot polygons — centroid ingest candidate).

## Other US states

Most states have **boundary** GIS in SP-001 (`state-parks-source-matrix.json`, 49 verified) but **not** amenity FeatureServers. Next steps per state:

1. Search the state's ArcGIS Hub (same workflow as `build-state-parks-search-arcgis-hub.mjs`) for `campground`, `parking`, `restroom`, `visitor center`.
2. Add promising layers to `park-amenities-state-seeds.json`, probe, then promote to `park-amenities-state-sources.json`.
3. Fall back to **OSM PBF** (`build-park-amenities-ingest-state-osm.mjs`) for states without open amenity GIS.

Known leads:

| ST | Lead | Status |
|----|------|--------|
| WY | [Parking_Areas Hub layer](https://services1.arcgis.com/WOPmQY9FJsLgGOzw/arcgis/rest/services/Parking_Areas/FeatureServer/0) | In cross-check; field map TBD |
| FL | Boundaries only in SP-001 | Amenity layers TBD |
| ON (CA) | See [PARK-AMENITIES-PROVINCIAL-SOURCES.md](PARK-AMENITIES-PROVINCIAL-SOURCES.md) | Geocortex infrastructure blocked |

## Boundaries / polygons

Two related tracks:

### SP-001 catalog (centroids today)

Official park **boundary** layers feed the state/provincial park **unit catalog** — representative points only:

```bash
node build-state-parks-ingest-official.mjs --region=us
node build-state-parks-master.mjs
```

Verified boundary sources: [STATE-PARKS-SOURCES.md](STATE-PARKS-SOURCES.md) (AK, CA, FL, MN, MO, NC, NY, …).

California also has [ParkBoundaries](https://services2.arcgis.com/AhxrK3F6WM8ECvDi/ArcGIS/rest/services/ParkBoundaries/FeatureServer/0) (~462 polygons, `UNITNBR` + `UNITNAME`) on the same server as amenities. SP-001 currently uses [ParkEntryPoints](https://services2.arcgis.com/AhxrK3F6WM8ECvDi/ArcGIS/rest/services/ParkEntryPoints/FeatureServer/2) for CA catalog centroids.

### Full polygon geometry (future)

NPS and Parks Canada boundaries live in `build-park-boundaries.mjs` → map embed. **State park polygons are not yet in that pipeline.** To add them:

1. Reuse verified polygon layers from `state-parks-source-matrix.json` (or CA `ParkBoundaries`).
2. Simplify rings like NPS (see `build-park-boundaries.mjs`).
3. Store in a new `state-park-boundaries-*.json` artifact keyed by SP-001 `id`.

Boundaries help **spatial parent linking** for OSM amenities (point-in-polygon) and map shading — separate from point amenity ingest.

## Build

State ArcGIS + OSM amenity ingest:

```bash
node build-park-amenities-ingest-state-arcgis.mjs --region=us
node build-park-amenities-ingest-state-osm.mjs
node build-park-amenities-us-master.mjs
node build-park-amenities-rollup.mjs
node validate-park-amenities-us.mjs
```

Full US pipeline (NPS + state):

```bash
node build-park-amenities-us-all.mjs
```

## Related

- [PARK-AMENITIES.md](PARK-AMENITIES.md) — schema, NPS ingest, explorer layers
- [PARK-AMENITIES-PROVINCIAL-SOURCES.md](PARK-AMENITIES-PROVINCIAL-SOURCES.md) — Canada provincial amenities
- [STATE-PARKS.md](STATE-PARKS.md) — SP-001 unit catalog and four-source completion
