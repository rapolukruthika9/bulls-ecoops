# BULLS ECOOPS — MapLibre Thematic Layers Build

## What this build adds
- MapLibre satellite-first 2D campus map.
- Existing Tampa 2021 tree-canopy overlay using MapServer layer 9 filtered to `LandCover = 'Tree Canopy'`.
- Potential planting-zone overlay using Tampa 2021 Tree Canopy MapServer layer 10.
- Historical average land-surface-temperature overlay using MapServer layer 15.
- Thematic overlays render as transparent raster exports directly on the map, independently of the FeatureServer identify/query pipeline.
- Campus boundary, USF building footprints and surface parking lots remain separate vector query/selection layers.
- Data load is started directly from the MapLibre `load` event and no longer returns early based on `isStyleLoaded()` while raster basemap tiles are still loading.
- Vite proxy routes now rewrite to explicit full remote paths.

## Important data limitations
- The tree canopy, potential planting and LST layers are from the Tampa 2021 study. They are not live measurements.
- Layer 15 is average land-surface temperature context, not air temperature or a live heat sensor.
- Layer 10 is study-designated potential planting polygons, not an engineering or field approval.
- The raster overlays are map visuals; measurements and candidate rankings must continue to come from source feature geometry and documented formulas.

## Run
```powershell
npm install
npm run dev
```

## Verification status
- JavaScript module syntax and JSX structure checked.
- ZIP structure checked.
- Live browser rendering against remote ArcGIS services still needs verification on the user's machine.
