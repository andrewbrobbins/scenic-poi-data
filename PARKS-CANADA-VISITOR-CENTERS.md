# Parks Canada visitor centres (VC-CA-001)

Mirror of the US NPS visitor center pipeline for Parks Canada units.

## Prerequisites

```bash
node build-parks-canada-cache.mjs   # PC-001 parent catalog
```

## Source

- **Primary:** Parks Canada Facilities ArcGIS (`vw_Facilities_Installations_Point_V2_FGP`)
  - `Facility_Type_Installation` matching visitor centre / interpretation facility
- **OSM verify (optional):** local `canada-latest.osm.pbf` only — never Overpass
- **Hours:** no NPS-style API; records flag `NO_HOURS` until a trustworthy hours source is added

## Artifacts

| File | Role |
|------|------|
| `parks-canada-visitor-centers-ca-master.json` | Canonical records (committed) |
| `parks-canada-visitor-centers-qa.json` | QA report |
| `parks-canada-visitor-centers-ca-explorer-embed.js` | Explorer embed |

## Pipeline

```bash
node build-parks-canada-visitor-centers-all.mjs
node build-parks-canada-visitor-centers-all.mjs --verify-osm [--refresh-osm]
```

Stages: ArcGIS ingest → master merge → explorer embed → `build-poi-explorer-data.mjs` → validate.

## Validation

```bash
node validate-parks-canada-visitor-centers.mjs
```

## Do not

- Fold into US `nps-visitor-centers-*` files — separate region pipeline
- Use Overpass for OSM verification when Canada PBF is on disk
