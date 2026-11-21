# BULLS ECOOPS — MapLibre campus map

A satellite-first campus GIS prototype for the University of South Florida Tampa campus.

## Run on Windows
1. Extract the ZIP.
2. Open the `BULLS_ECOOPS_MAPLIBRE_LAYERS` folder in VS Code (the folder containing `package.json`).
3. Open Terminal → New Terminal.
4. Run:

```powershell
npm install
npm run dev
```

5. Open the local URL printed by Vite, normally `http://127.0.0.1:5173/`. Keep the terminal open.

You can also double-click `RUN_ME_FIRST.bat`.

## Visual layers on the map
- **Existing tree canopy:** Tampa 2021 Tree Canopy MapServer layer 9, rendered as transparent map tiles and filtered to `LandCover = 'Tree Canopy'`.
- **Potential planting zones:** Tampa 2021 Tree Canopy MapServer layer 10. These are study polygons, not field-approved planting sites.
- **Historical heat zones:** Tampa 2021 MapServer layer 15 (`Tampa_avgLST_degF_SP`), an average land-surface-temperature raster. It is historical context, not live air temperature.
- **Buildings and surface parking:** independent USF FeatureServer vector queries, filtered spatially using the official Tampa campus boundary.

Use the quick buttons **Green zones**, **Campus assets**, and **Historical heat context** to switch thematic overlays. Or use the checkboxes to turn individual layers on and off.

## Data endpoints
- USF campus boundary: `USF_Campus_Boundaries/FeatureServer/0`
- USF building footprints: `USF_Building_Footprints/FeatureServer/1`
- USF surface parking lots: `Parking_Lots_Garages/FeatureServer/1`
- Tampa 2021 tree canopy and potential planting: `Tampa_2021_TreeCanopy/MapServer/9` and `/10`
- Tampa 2021 average land-surface temperature: `Tampa_2021_TreeCanopy/MapServer/15`

## Important
The satellite imagery is a backdrop only; analysis should use the independent GIS records. Regional 2021 study overlays may extend beyond campus at the map viewport edges. The vector asset queries use the campus boundary. The map is a prototype and does not yet calculate live temperature, energy production, stormwater behavior or structural solar suitability.
