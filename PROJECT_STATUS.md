# Status

## Done (verified by tests)
- Scenario math, scoring, evidence pack, proposal verifier + fallback (`tests/shared.test.js`)
- Turf EcoScan engine incl. empty/overlapping/multipart/invalid-geometry cases (`tests/gis.test.js`)
- Express API: health, PVWatts, Gemini proposal w/ guardrails, rate limit, GIS proxy allow-list (`tests/server.test.js`)
- UI smoke-tested headless against a synthetic campus: layers → scan → ranking → planner → report

## NOT yet verified (needs a machine with network / keys)
- Live USF/ArcGIS responses (layer 11/18 field names, record counts, CRS) — run `npm run snapshot` and the GO/NO-GO check
- Real Gemini output (needs `GEMINI_API_KEY`; model default `gemini-2.5-flash`, override with `GEMINI_MODEL`)
- Real PVWatts (needs `NLR_API_KEY`; endpoint default developer.nlr.gov, override `PVWATTS_URL`)
- Deployment (Render) — `npm run build && npm start` serves everything from one service

## Next
Cached demo proposal, Judge Mode, bottom ranked bar, before/after overlay, fixture-savings calculator.
