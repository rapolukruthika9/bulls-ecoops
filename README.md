# BULLS ECOOPS — USF Campus Environmental Intelligence & Action Center

Independent student prototype (not an official USF recommendation). Public campus GIS →
Turf.js screening → evidence pack → Gemini explanation → printable proposal.

```
USF/ArcGIS layers → GIS proxy → Turf.js EcoScan → ranked candidates (visible weights)
      → EcoPlan scenario math → Evidence pack (metric IDs + sources) → Gemini JSON → verifier → report
```

## Run
```bash
npm install
cp .env.example .env        # add GEMINI_API_KEY (and NLR_API_KEY for PVWatts). Keys stay server-side.
npm run dev:all             # Vite on :5173 + Express API on :3001
npm test                    # shared math, GIS engine, server/guardrail tests
npm run build && npm start  # production: Express serves dist + API + GIS proxy on :3001
npm run snapshot            # (needs network) cache public GeoJSON into public/data as a labelled fallback
```

## What it does
- **Layer toggles** — Green (canopy, planting, green space), Water, Parking & solar, Heat (2021 LST study), each individually toggleable.
- **EcoScan** (`src/lib/gis.js`) — *ANALYZE CAMPUS* buffers every walkway, intersects with dissolved canopy, and screens parking/roof polygons for area, walkway adjacency and green-space adjacency. Results render as a **priority heat-map + scored outlines** and a ranked list.
- **EcoPrioritize** (`shared/scoring.js`) — min-max normalised, adjustable weights, formula and raw inputs shown. Scores are never comparable across missions.
- **EcoPlan** (`shared/scenarios.js`, `shared/evidence.js`) — solar capacity (+ optional PVWatts V8), rainwater capture, rain garden, planting count. Everything is labelled SCENARIO ESTIMATE and echoes its assumptions.
- **Gemini** (`server/services/gemini.js`, `shared/proposal.js`) — receives only computed metrics. Output is Zod-validated; every metric ID, source ID, URL and number is checked against the evidence. Any failure → deterministic fallback report.

## Real vs estimated
| Real (computed from source geometry) | Scenario / model | Not claimed |
|---|---|---|
| Path length, buffer area, canopy overlap, polygon areas, distances | Usable area, kWdc, PVWatts kWh (if key), rainwater m³, tree count | Temperature reduction, verified solar feasibility, actual savings, flood reduction, drainage/infiltration, cost |

## Data sources
Canopy: Tampa UTC 2021 layer 9 (USF Water Institute). Walkways/green space: USF Community Maps layers 11/18.
Buildings/parking/boundary: USF ArcGIS FeatureServers. See `shared/sources.js` (the only URLs Gemini may cite).
> Note: the plan names USF canopy layer 5; the base map uses Tampa 2021 layer 9. Swap in `src/lib/data.js` if layer 5 is preferred.

## Limits
Geodesic WGS84 screening metrics, not surveyed. No hydrological model, structural/electrical review, shade-hour simulation.
AI disclosure: Claude Code assisted development; Gemini writes proposal prose from supplied metrics only.

## Layout
`shared/` pure logic used by browser + server · `server/` Express (Gemini, PVWatts, GIS proxy, security) · `src/` React + MapLibre · `tests/` Vitest.
