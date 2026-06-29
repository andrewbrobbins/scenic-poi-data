# State parks — four-source completion (SP-001)

Generated: `2026-06-27T03:06:08.645Z` — refresh with `node build-state-parks-four-source-status.mjs`

See **[STATE-PARKS.md](STATE-PARKS.md#four-source-completion-goal)** for policy.

## Completed (11/50)

| ST | Plotted | GIS | Website | Wikipedia | OSM (raw PBF) |
|----|--------:|----:|--------:|----------:|--------------:|
| FL | 176 | 179 | 176 | 162 | 33 |
| IA | 54 | 65 | 54 | 67 | 80 |
| KY | 49 | 49 | 49 | 47 | 7 |
| MD | 52 | 67 | 52 | 58 | 389 |
| MI | 78 | 79 | 78 | 80 | 62 |
| MN | 73 | 75 | 73 | 73 | 52 |
| MT | 55 | 55 | 55 | 56 | 6 |
| PA | 114 | 124 | 114 | 125 | 10 |
| SC | 55 | 55 | 55 | 50 | 4 |
| TX | 91 | 116 | 92 | 93 | 50 |
| UT | 46 | 56 | 46 | 46 | 11 |

## Remaining (39/50)

| ST | Plotted | GIS | OSM raw | Website | Wiki | 4/4 | Counts agree | Missing |
|----|--------:|----:|--------:|--------:|-----:|:---:|:------------:|---------|
| AK | 137 | 157 | 12 | 21 | 77 | Y | N | — |
| AR | 10 | 78 | 12 | 5 | 53 | Y | N | — |
| AZ | 23 | 26 | 8 | 58 | 34 | Y | N | — |
| CA | 138 | 138 | 30 | 138 | 281 | Y | N | — |
| CT | 71 | 72 | 48 | 71 | 102 | Y | N | — |
| DE | 11 | 66 | 21 | 11 | 17 | Y | N | — |
| GA | 47 | 76 | 16 | 47 | 46 | Y | N | — |
| IN | 27 | 27 | 13 | 11 | 25 | Y | N | — |
| KS | 41 | 47 | 24 | 41 | 27 | Y | N | — |
| MO | 89 | 90 | 181 | 89 | 57 | Y | N | — |
| MS | 37 | 53 | 1 | 37 | 25 | Y | N | — |
| NC | 69 | 348 | 4 | 69 | 36 | Y | N | — |
| ND | 13 | 21 | 2 | 19 | 19 | Y | N | — |
| NE | 72 | 72 | 2 | 19 | 17 | Y | N | — |
| NH | 35 | 46 | 18 | 35 | 52 | Y | N | — |
| NY | 206 | 858 | 91 | 256 | 199 | Y | N | — |
| OK | 34 | 50 | 7 | 34 | 37 | Y | N | — |
| OR | 54 | 63 | 28 | 54 | 197 | Y | N | — |
| VA | 46 | 339 | 26 | 46 | 46 | Y | N | — |
| WA | 140 | 207 | 18 | 140 | 111 | Y | N | — |
| WY | 11 | 13 | 4 | 16 | 38 | Y | N | — |
| AL | 21 | — | 9 | 22 | 21 | N | Y | GIS |
| HI | 23 | 23 | 4 | — | 43 | N | N | website |
| ID | 28 | — | 3 | 28 | 24 | N | Y | GIS |
| IL | 37 | 1 | 121 | — | 47 | N | N | website |
| LA | 18 | — | 4 | 22 | 21 | N | Y | GIS |
| ME | 44 | 44 | 14 | — | 38 | N | Y | website |
| NM | 24 | 1 | 24 | — | 35 | N | N | website |
| NV | 29 | 30 | 0 | 29 | 25 | N | Y | OSM |
| RI | 28 | 35 | 0 | 28 | 27 | N | Y | OSM |
| SD | 49 | 53 | 0 | 49 | 43 | N | Y | OSM |
| TN | 66 | 66 | 6 | — | 34 | N | N | website |
| VT | 51 | 51 | 0 | 51 | 60 | N | Y | OSM |
| WI | 55 | 66 | 0 | 55 | 58 | N | Y | OSM |
| WV | 35 | 36 | 0 | 35 | 39 | N | Y | OSM |
| CO | 32 | — | 32 | — | 44 | N | N | GIS, website |
| MA | 50 | — | 181 | — | 59 | N | N | GIS, website |
| NJ | 14 | — | 23 | — | 53 | N | N | GIS, website |
| OH | 28 | — | 34 | — | 75 | N | N | GIS, website |

### Notes

- **GIS** — verified ArcGIS layer in `state-parks-source-matrix.json` (`featureCount`).
- **OSM raw** — unfiltered PBF extract (`state-parks-ingest/00-pbf/state-parks-us.json`); presence only for completion, not count agreement.
- **Website** — listing cache count from agency park finder (`state-parks-ingest/02-listings/{st}.json`).
- **Wikipedia** — parsed list-page link count (`state-parks-wiki-counts-cache.json` or listing fallback).
- **Counts agree** — GIS, website, Wikipedia, and plotted master counts within ratio 1.35× (excluding raw OSM).
- States with all four sources but no agreement usually have GIS polygons that include sub-units, SNAs, or stale Wikipedia/HTML allowlists.