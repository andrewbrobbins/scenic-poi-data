# Provincial park amenities (Canada)

Research and ingest config for **provincial** campgrounds, picnic areas, and restrooms outside Parks Canada.

## Discovery

Probe all provinces:

```bash
node build-park-amenities-discover-provincial.mjs
node build-park-amenities-discover-provincial.mjs --province=AB,BC,ON,QC
```

Seeds: `park-amenities-provincial-seeds.json`  
Output: `park-amenities-ca-ingest/00-research/provincial-discovery.json` (gitignored)

Tier-A ingest config (verified layers only): `park-amenities-state-sources.json` → `ca` block.

## Tier A — verified ArcGIS

| Province | Layer | Count | Amenity types | Notes |
|----------|-------|------:|---------------|-------|
| **AB** | [Park Facility Points](https://geospatial.alberta.ca/arcgis/rest/services/Hosted/Park_Facility_Points/FeatureServer/1869) | ~835 | Campground, group camp, comfort camping, day use | **Ingest wired.** One point per facility. Parent via spatial match to `state-parks-ca-master.json` (catalog thin for AB). |
| **BC** | [Protected Lands Facilities](https://delivery.maps.gov.bc.ca/arcgis/rest/services/mpcm/bcgwpub/MapServer/741) | ~1025 | Park-level facility points | One pin per protected area, **not** individual campsites. |
| **BC** | [Coastal BC Campsites](https://delivery.maps.gov.bc.ca/arcgis/rest/services/mpcm/bcgwpub/MapServer/684) | ~711 | Marine/coastal camps | Sparse naming; hard to link to park catalog. |
| **ON** | [Provincial Park Regulated](https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open03/MapServer/4) | 347 | Park boundaries only | `PROTECTED_SITE_IDENT` useful for future parent codes. |

## Tier B — known but blocked / non-ArcGIS

| Province | Source | Issue |
|----------|--------|-------|
| **ON** | [PARK_INFRASTRUCTURE_POINT_FT](https://www.lioapplications.lrc.gov.on.ca/Geocortex/Essentials/essentials414/REST/sites/AFFES_Mapper/map/mapservices/204/layers/71) | Geocortex REST rejects standard `/query`. Has campground, picnic, washroom, **individual campsite** fields. Best ON target once a FeatureServer mirror is found. |
| **QC** | [TerrAPI lieux.sepaq.camping](https://geoegl.msp.gouv.qc.ca/apis/terrapi/lieux/sepaq/camping) | Requires `baseTerritoire`; not ArcGIS. Fields: `nom`, `secteur`, `parc`, `parcCode`. |
| **SK** | [ParksAsLegislated](https://gis.saskatchewan.ca/arcgis/rest/services/ParksAsLegislated/FeatureServer) | Boundaries only; camps on [parks.saskatchewan.ca](https://parks.saskatchewan.ca/camping) reservation API. |
| **MB, NS, NB, NL, PE, YT, NT, NU** | — | No public amenity FeatureServer found yet; reservation / park-list websites only (see seeds file). |

## Online lists (reservation / catalog)

Useful for manual seeding or future scrapers — **not** ingested automatically:

| Province | URLs |
|----------|------|
| AB | [albertaparks.ca camping](https://www.albertaparks.ca/albertaparksca/camping/camping-in-alberta/) |
| BC | [camping.bcparks.ca](https://camping.bcparks.ca/) |
| ON | [reservations.ontarioparks.ca](https://reservations.ontarioparks.ca/) |
| QC | [sepaq.com camping](https://www.sepaq.com/activites/camping) |
| SK | [parks.saskatchewan.ca/camping](https://parks.saskatchewan.ca/camping) |
| NS | [camping.novascotia.ca](https://camping.novascotia.ca/) |

## Build

```bash
node build-park-amenities-ingest-state-arcgis.mjs --region=ca
node build-park-amenities-ca-master.mjs
```

Full CA pipeline: `node build-park-amenities-ca-all.mjs`

## Next steps

1. **Ontario infrastructure** — `PARKPNT` on [data.ontario.ca](https://data.ontario.ca) has metadata only (no download URL). Geocortex layer still rejects `/query`. Park **boundaries** with `PROTECTED_SITE_IDENT` are now in SP-001 official ingest.
2. **Quebec** — TerrAPI `lieux.sepaq.camping` requires a valid `baseTerritoire` token (undocumented); use **provincial OSM PBF** ingest for QC coverage until TerrAPI is resolved.
3. **BC** — No dedicated campground FeatureServer found; **provincial OSM PBF** + Coastal Campsites (711, sparse metadata) documented.
4. **OSM PBF** — `node build-park-amenities-ingest-provincial-osm.mjs` (wired in `build-park-amenities-ca-all.mjs`).
5. **SP-001 catalog** — ON + AB official boundaries verified in `state-parks-source-matrix.json`; run `node build-state-parks-ingest-official.mjs --region=ca --state=ON,AB` then `node build-state-parks-master.mjs`.

See also [PARK-AMENITIES.md](PARK-AMENITIES.md), [STATE-PARKS-SOURCES.md](STATE-PARKS-SOURCES.md).
