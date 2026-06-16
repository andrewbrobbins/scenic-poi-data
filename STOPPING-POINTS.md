# Stopping points (legacy camping seeds)

Legacy build for corridor-adjacent **camping** seeds used before the full US camping explorer embed.

**Corridor city / “hotel town” lists were removed** — those were not hotels, just confusing city-center pins.

| File | Role |
|------|------|
| `stopping-points-source.json` | Manual USFS/BLM camping seeds |
| `stopping-points-cache.json` | Per-route camping lists with distance to corridor polyline |
| `stopping-points-embed.js` | Flat `STOPPING_POINTS.camping` (legacy; route tools use `camping-us-explorer-embed.js`) |

Rebuild: `node tools/build-stopping-points-cache.mjs`

For trip planning, use **route-editor** map layers (camping/gas/NPS) or **Find fun stops along this day** (Google Places online).
