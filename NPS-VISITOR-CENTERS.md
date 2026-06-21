# NPS visitor centers (US)

Pipeline for NPS visitor center POIs: ArcGIS + NPS API → master → explorer embed.

## Build

```bash
node build-nps-visitor-centers-all.mjs --require-api   # full (needs NPS_API_KEY)
node build-nps-visitor-centers-all.mjs --skip-api      # ArcGIS coords only
node validate-nps-visitor-centers.mjs --expect-api
```

Fast path after catalog/API cache exists:

```bash
node build-nps-visitor-centers-master.mjs
node build-nps-visitor-centers-explorer-embed.mjs
node build-poi-explorer-data.mjs
```

## OSM verification — local PBF only

**Do not use Overpass** when `osm-pbf/geofabrik/us-latest.osm.pbf` is present. Repo-wide rule: **[POI-OSM-PBF.md](POI-OSM-PBF.md)**.

Overpass rate-limits and turns a ~15-minute local scan into a multi-hour job.

Use the built-in PBF pass instead:

```bash
node build-nps-visitor-centers-master.mjs --verify-osm
# or
node build-nps-visitor-centers-all.mjs --verify-osm
```

This scans `osm-pbf/geofabrik/us-latest.osm.pbf` once for:

- `tourism=information`
- `information=visitor_centre` / `visitor_center`
- `amenity=ranger_station`

Candidates are cached at `nps-vc-us-ingest/03-osm-pbf/osm-vc-candidates.json`. Re-scan with `--refresh-osm`.

Requires US PBF on disk (same as fuel/scenic pipelines):

```bash
node ensure-fuel-cache.mjs --region=us
# or: node build-poi-osm-download.mjs --region=us
```

Implementation: `nps-visitor-centers-osm-verify.mjs`.

## Key files

| File | Role |
|------|------|
| `build-nps-visitor-centers-ingest-arcgis.mjs` | ArcGIS POI layer |
| `build-nps-visitor-centers-ingest-api.mjs` | NPS Developer API (hours) |
| `build-nps-visitor-centers-master.mjs` | Merge + optional `--verify-osm` |
| `nps-visitor-centers-osm-verify.mjs` | **Local PBF** OSM nearest-match |
| `nps-visitor-centers-us-master.json` | Canonical records |
| `nps-visitor-centers-us-explorer-embed.js` | `NPS_VISITOR_CENTERS_US` embed |

See also [SCENIC-ROUTER-INGEST.md](SCENIC-ROUTER-INGEST.md) for the app sync contract.
