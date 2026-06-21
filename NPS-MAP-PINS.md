# NPS map pin placement

Park catalog pins (`nps-us-geo.json`) use **boundary geometry**, not visitor centers or headquarters.

## Policy

| Case | Pin placement |
|------|----------------|
| Single boundary (or nearby sections) | Bbox centroid of the boundary polygon |
| Distant sections (≥ **18 km** apart) | One pin per cluster — area-weighted centroid |
| Units missing from boundary data | Manual pin in `nps-park-pin-overrides.json` |

Visitor centers remain in `nps-visitor-centers-us-master.json` as a separate layer; `visitorCenter` on catalog units is informational only.

## Artifacts

| File | Role |
|------|------|
| `park-boundary-pins.mjs` | Shared pin computation |
| `nps-us-park-pins.json` | Full pin catalog for all US units with boundaries (committed) |
| `nps-park-pin-overrides.json` | Manual labels + extra pins (e.g. Elkhorn Ranch at `thro`) |
| `nps-us-geo.json` | Each unit: `coordSource: "boundary_centroid"`, `pinStrategy`, `mapPins[]` |

## Rebuild

```bash
node build-park-boundaries.mjs   # if boundaries changed
node build-nps-us-cache.mjs
node build-poi-explorer-data.mjs
```

POI explorer expands `mapPins` into multiple markers per park when `pinStrategy === "multi_pin"`.

## Overrides

Example (`thro` — three distinct visit areas):

```json
{
  "thro": {
    "pinLabels": { "0": "South Unit", "1": "North Unit" },
    "extraPins": [
      {
        "id": "thro-elkhorn-ranch",
        "label": "Elkhorn Ranch Unit",
        "lat": 46.9334,
        "lon": -103.9951,
        "source": "manual_override"
      }
    ]
  }
}
```

Add overrides when NPS boundaries omit a staffed/distinct unit polygon (e.g. `klgo` Seattle Unit — separate park code `klse` with no boundary polygon).

Park-list-only units (missing from ArcGIS) are added from `nps-parks-cache.json` when they are discrete sites — trails and affiliated areas are skipped.

## Parks Canada

Same clustering logic in `build-parks-canada-cache-core.mjs` via `park-boundary-pins.mjs` (no overrides file yet).
