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

## v3 changes
- Failing optional layers (canopy polygons, walkways, green space) are off by default; set `VITE_ENABLE_EXTRA_LAYERS=true` to re-enable.
- Report opens with a headline + stat cards + takeaways (numbers come from computed metrics).
- Priority filter: All / Parking / Buildings + "High priority only" (top 10/25/50%).
- EcoPlan holds up to 6 sites with combined portfolio totals and a combined report.
- Map pop-up with *Add to EcoPlan* on the selected site.
- Ideas tab: Gemini brainstorm (verified; general ideas must contain no numbers) with rule-based fallback.

## v4 changes
- Left panel: MISSIONS (Solar, Water, Green planting) and a separate DATA sub-heading (Green zones, Heat areas).
- Green planting mission = unbuilt open space (campus − buildings − parking − stadium/athletic buildings, min size/width filters). Appears only after a scan finds open space. Roads/ponds/athletic fields have no layer → field verification needed.
- Heat areas colour scale read from the MapServer legend (`/gis/lst/legend`), with a clearly labelled relative fallback.
- Priority filter bar can be closed/reopened; hidden outside the priority views.
- Ranked candidates show a confidence dot (green/amber/red) instead of the word.
- Report/PDF is US Letter (`@page size: letter`, ½-inch margins); PDF file name is set from the site ID.

## v5 changes
- Server-built PDF (`POST /api/report-pdf`, pdfkit): Letter or A4, vector text, headline banner, tables, footer page numbers. Replaces reliance on browser print scaling.
- Scoring weights: Solar now has a second real factor that works without walkway data (distance to nearest building, a load-proximity proxy). When only one factor has data the sliders lock and say why; "Reset" only appears after a change.
- (Demo data mode was added and then removed again: it made the map messy.)
- Not verified: live USF data, real Gemini output, real PVWatts (no network/keys in the build sandbox).
