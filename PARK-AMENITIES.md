# Park amenities (campgrounds, picnic, restrooms)

Point-level amenities linked to NPS park units (and eventually state/provincial parks). Campgrounds are split into **developed**, **backcountry**, and **primitive** tiers.

## Build

```bash
node build-park-amenities-us-all.mjs
```

Fast path after ArcGIS cache exists:

```bash
node build-park-amenities-us-master.mjs
node build-park-amenities-rollup.mjs
node build-park-amenities-us-explorer-embed.mjs
node validate-park-amenities-us.mjs
node build-poi-explorer-data.mjs
```

## Schema

Each master record:

| Field | Description |
|-------|-------------|
| `kind` | `campground`, `picnic_area`, or `restroom` |
| `campTier` | For campgrounds only: `developed`, `backcountry`, or `primitive` |
| `subtype` | Finer type (e.g. `vault_toilet`, `shelter`, `rv`) |
| `parentUnit` | `{ system, parkCode, name, designation, category }` |
| `parkCode` | NPS unit code |

**Campground tiers (NPS ArcGIS `POITYPE`):**

| Tier | POITYPE examples |
|------|------------------|
| **developed** | Campground, RV Campground, Cabin Campground |
| **backcountry** | Backcountry Campsite, Campsite, Backcountry Cabin |
| **primitive** | Primitive Campground, Primitive Camping, Primitive Campsite |
| **inferred** | `Camping` (ambiguous — flagged `CAMP_TIER_GUESS`) |

Mapping config: `park-amenities-nps-poi-types.json`.

## Artifacts

| File | Role |
|------|------|
| `park-amenities-us-master.json` | Canonical amenity POIs (committed) |
| `park-amenities-us-rollup.json` | Per-park counts by kind/tier |
| `park-amenities-us-qa.json` | Coverage + dedupe stats |
| `park-amenities-us-explorer-embed.js` | Browser bundle `PARK_AMENITIES_US` |

Ingest cache (gitignored): `park-amenities-us-ingest/01-nps-arcgis/amenities.json`.

## Rollup shape

Per parent park (`park-amenities-us-rollup.json` → `byParentId`):

```json
{
  "campground": {
    "developed": { "has": true, "count": 3 },
    "backcountry": { "has": true, "count": 120 },
    "primitive": { "has": false, "count": 0 },
    "any": true,
    "total": 123
  },
  "picnic_area": { "has": true, "count": 8 },
  "restroom": { "has": true, "count": 42 }
}
```

## POI explorer

Category **Park amenities** with sub-layers by campground tier plus picnic and restroom.

## Roadmap

| Phase | Scope |
|-------|--------|
| **1 (done)** | NPS ArcGIS ingest, master, rollup, explorer |
| 2 | NPS OSM PBF supplement (local PBF only — see [POI-OSM-PBF.md](POI-OSM-PBF.md)) |
| 3 | State park ArcGIS (CA Campgrounds / PicnicGrounds first) |
| 4 | State park OSM + boundary parent-link |
| 5 | Parks Canada facilities |

## Related

- Camping trip layer (fees, road distance): [CAMPING-US.md](CAMPING-US.md) — separate from this amenity catalog
- NPS visitor centers: [NPS-VISITOR-CENTERS.md](NPS-VISITOR-CENTERS.md) — same ArcGIS POI source, different POITYPE filter
