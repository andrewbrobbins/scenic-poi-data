# Park amenities (campgrounds, picnic, restrooms, parking, visitor centers)

Point-level amenities linked to **NPS**, **US state parks**, **Parks Canada**, and **provincial parks**. Campgrounds split into **developed / backcountry / primitive** tiers, with **road vs trail access** on campgrounds.

State/provincial amenity source research: **[PARK-AMENITIES-STATE-SOURCES.md](PARK-AMENITIES-STATE-SOURCES.md)**.

## Build (full)

```bash
node build-park-amenities-all.mjs
```

US only (uses existing camping-us road caches when present):

```bash
node build-park-amenities-us-all.mjs
```

Canada only:

```bash
node build-park-amenities-ca-all.mjs
```

### Road / trail access enrichment

Campgrounds get `accessMode` (`road` | `trail` | `unknown`), `roadDistanceM`, `trailDistanceM`:

```bash
# Reuses camping-us-ingest/05-roads/osm-roads-{ST}.json when present
node build-park-amenities-enrich-access.mjs --region=us

# Build trail caches (Overpass) then re-enrich
node build-park-amenities-us-all.mjs --fetch-trails --state=CA,MT,WY,CO
```

Before first road-enriched run, optionally populate highway caches:

```bash
node build-camping-us-enrich.mjs --fetch-roads --state=CA,MT,WY
```

## Schema (v2)

| Field | Description |
|-------|-------------|
| `kind` | `campground`, `picnic_area`, `restroom`, `parking`, `visitor_center` |
| `campTier` | `developed`, `backcountry`, `primitive` (campgrounds only) |
| `accessMode` | `road`, `trail`, `unknown` (campgrounds) |
| `accessConfidence` | `high`, `medium`, `inferred`, `measured_far`, … |
| `roadDistanceM` / `trailDistanceM` | Nearest vehicle highway / hiking way (meters) |
| `parentUnit` | `{ system, parkCode/id, name, … }` |

**Access rules:** within **120 m** of a vehicle highway → `road`; within **120 m** of a hiking way (`path`/`footway`/`track`) → `trail`; if both, closer wins. Before measurement, tier heuristics apply (developed→road, backcountry/primitive→trail).

## Sources

| Region | Source | Parent link |
|--------|--------|-------------|
| US NPS | NPS Public POIs ArcGIS | `UNITCODE` |
| US state parks | CA Campgrounds / Picnic / Restrooms / Parking / Visitor centers ArcGIS + OSM PBF | `UNITNBR` or park unit name → catalog; OSM spatial |
| CA Parks Canada | Accommodation + Facilities ArcGIS | park code from URL / name |
| CA provincial | Alberta Park Facility Points (+ research in [PARK-AMENITIES-PROVINCIAL-SOURCES.md](PARK-AMENITIES-PROVINCIAL-SOURCES.md)) | spatial → provincial catalog |

US state parks without Tier-A ArcGIS layers are supplemented from **local US PBF** (`operator` / name heuristics).

Config: `park-amenities-nps-poi-types.json`, `park-amenities-state-sources.json`, `park-amenities-state-seeds.json`.

## Artifacts

| File | Role |
|------|------|
| `park-amenities-us-master-manifest.json` | US shard index (counts, paths) |
| `park-amenities-us-nps-master.json` | US NPS amenities |
| `park-amenities-us-state-master/{ST}.json` | US state-park amenities per state |
| `park-amenities-ca-master.json` | Parks Canada + provincial |
| `park-amenities-*-rollup.json` | Per-parent counts + road/trail camp breakdown |
| `park-amenities-*-explorer-embed.js` | `PARK_AMENITIES_US` / `PARK_AMENITIES_CA` |

Legacy `park-amenities-us-master.json` (monolithic) is gitignored — rebuild writes shards via `build-park-amenities-us-master.mjs`.

## POI explorer

Category **Park amenities** — sub-layers by camp tier, road/trail access, picnic, restroom (US + CA).

## Related

- [CAMPING-US.md](CAMPING-US.md) — trip-planning camping layer (fees, road filter)
- [STATE-PARKS.md](STATE-PARKS.md) — state/provincial park unit catalog
