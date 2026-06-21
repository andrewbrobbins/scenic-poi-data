# Parks Canada unit catalog (PC-001)

Federal Parks Canada national sites — analogous to `nps-us-geo.json` for the US NPS catalog.

## Source

- **Primary:** APCA ArcGIS `vw_Places_Public_lieux_public_APCA` (same layer as `build-park-boundaries.mjs` CA polygons)
- Place types: National Park, National Park Reserve, National Historic Site, National Marine Conservation Area (+ Reserve)
- Centroids computed from boundary polygon geometry

## Artifacts

| File | Role |
|------|------|
| `parks-canada-geo.json` | Canonical unit catalog (committed) |
| `parks-canada-explorer-embed.js` | Browser bundle `PARKS_CANADA` |
| `parks-canada-arcgis-cache.json` | Raw ArcGIS fetch (gitignored) |

## Pipeline

```bash
node build-parks-canada-cache.mjs          # use cache if present
node build-parks-canada-cache.mjs --refresh # re-download ArcGIS
```

Rebuilds `parks-canada-geo.json`, embed, and `poi-explorer-data.js`.

## POI explorer

Layers under **Parks Canada** category (`group: pc`, `region: ca`):

- `pc_park_ca`, `pc_historic_site_ca`, `pc_marine_ca`, …
- Visible when region filter is **Canada** or **Both**

## Do not

- Hand-edit `parks-canada-geo.json` — rebuild via pipeline
- Confuse with **SP-001** state/provincial parks (`state-parks-*`)

## Related

- **PB-001** — boundary polygon coverage in `park-boundaries.geojson`
- **VC-CA-001** — visitor centres linked via `parentUnit` in `parks-canada-visitor-centers-ca-master.json`
