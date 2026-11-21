import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import {
  DATASETS,
  getFeatureFacts,
  getFeatureTitle,
  clipFeatureCollectionToCampus,
  loadCampusBoundary,
  queryCampusFeatures,
  toFeatureCollection,
} from '../lib/data.js';

const START_CENTER = [-82.414, 28.058];
const EMPTY = { type: 'FeatureCollection', features: [] };
const TREE_CANOPY_LAYER_DEFS = encodeURIComponent(JSON.stringify({ 9: "LandCover = 'Tree Canopy'" }));
const CANOPY_TILE_URL = `/gis/canopy/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image&layers=show:9&layerDefs=${TREE_CANOPY_LAYER_DEFS}`;
const PLANTING_TILE_URL = '/gis/canopy/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image&layers=show:10';

const LAYER_DEFS = [
  {
    id: 'canopy-fill', source: 'canopy', type: 'fill',
    paint: { 'fill-color': '#3a9a57', 'fill-opacity': 0.55, 'fill-outline-color': '#174f2c' },
  },
  {
    id: 'buildings-fill', source: 'buildings', type: 'fill',
    paint: { 'fill-color': '#d8e0e2', 'fill-opacity': 0.83, 'fill-outline-color': '#293b47' },
  },
  {
    id: 'parking-fill', source: 'parking', type: 'fill',
    paint: { 'fill-color': '#e5a64d', 'fill-opacity': 0.62, 'fill-outline-color': '#764b18' },
  },
  {
    id: 'campus-fill', source: 'campus', type: 'fill',
    paint: { 'fill-color': '#9ecb91', 'fill-opacity': 0.035 },
  },
  {
    id: 'campus-line', source: 'campus', type: 'line',
    paint: { 'line-color': '#d8f0b6', 'line-width': 3, 'line-opacity': 0.96 },
  },
  {
    id: 'buildings-line', source: 'buildings', type: 'line',
    paint: { 'line-color': '#364b57', 'line-width': 1.1, 'line-opacity': 0.9 },
  },
  {
    id: 'parking-line', source: 'parking', type: 'line',
    paint: { 'line-color': '#f5cc82', 'line-width': 1.15, 'line-opacity': 1 },
  },
];

const VISIBILITY_LAYERS = {
  canopy: ['tree-canopy-raster', 'canopy-fill'],
  planting: ['potential-planting-raster'],
  buildings: ['buildings-fill', 'buildings-line'],
  parking: ['parking-fill', 'parking-line'],
  campus: ['campus-fill', 'campus-line'],
  heat: ['historical-lst'],
};

function calculateBounds(feature) {
  const result = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (coords) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      result[0] = Math.min(result[0], coords[0]);
      result[1] = Math.min(result[1], coords[1]);
      result[2] = Math.max(result[2], coords[0]);
      result[3] = Math.max(result[3], coords[1]);
      return;
    }
    coords.forEach(walk);
  };
  walk(feature?.geometry?.coordinates);
  if (!Number.isFinite(result[0])) throw new Error('Campus boundary coordinates could not be read.');
  return result;
}

function addGeoJsonSource(map, id) {
  if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY, promoteId: 'OBJECTID' });
}

function setLayerVisibility(map, key, visible) {
  (VISIBILITY_LAYERS[key] || []).forEach((id) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  });
}

function addOperationalLayers(map) {
  addGeoJsonSource(map, 'campus');
  addGeoJsonSource(map, 'buildings');
  addGeoJsonSource(map, 'parking');
  addGeoJsonSource(map, 'canopy');

  // These MapServer export overlays provide visible thematic zones directly on
  // the map canvas. They do not depend on the FeatureServer identify/query calls.
  // Layer 9 is the Tampa 2021 land-cover polygon layer filtered to Tree Canopy.
  map.addSource('tree-canopy-raster-source', {
    type: 'raster',
    tiles: [CANOPY_TILE_URL],
    tileSize: 256,
    attribution: 'USF Water Institute · Tampa Urban Tree Canopy 2021',
  });
  map.addLayer({
    id: 'tree-canopy-raster',
    type: 'raster',
    source: 'tree-canopy-raster-source',
    layout: { visibility: 'visible' },
    paint: { 'raster-opacity': 0.62, 'raster-fade-duration': 100 },
  });

  // Layer 10 is the study's potential planting polygon layer. Treat it as a
  // screening/context layer, not a field-verified planting recommendation.
  map.addSource('potential-planting-source', {
    type: 'raster',
    tiles: [PLANTING_TILE_URL],
    tileSize: 256,
    attribution: 'USF Water Institute · Tampa Urban Tree Canopy 2021 potential planting',
  });
  map.addLayer({
    id: 'potential-planting-raster',
    type: 'raster',
    source: 'potential-planting-source',
    layout: { visibility: 'none' },
    paint: { 'raster-opacity': 0.58, 'raster-fade-duration': 100 },
  });

  // Historical temperature raster is inserted below every operational vector overlay.
  map.addSource('historical-lst-source', {
    type: 'raster',
    tiles: [
      '/gis/lst/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image&layers=show:15',
    ],
    tileSize: 256,
    attribution: 'USF Water Institute · City of Tampa UTC 2021 (historical study)',
  });
  map.addLayer({
    id: 'historical-lst',
    type: 'raster',
    source: 'historical-lst-source',
    layout: { visibility: 'none' },
    paint: { 'raster-opacity': 0.62, 'raster-fade-duration': 150 },
  });

  LAYER_DEFS.forEach((layer) => {
    if (!map.getLayer(layer.id)) map.addLayer(layer);
  });



}

export default function MapView({
  visibility,
  mapBase,
  reloadToken,
  onStatus,
  onSelected,
  onCounts,
  onControlsReady,
  onMapReady,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const loadRef = useRef(null);
  const campusBoundsRef = useRef(null);
  const selectedFeaturesRef = useRef({});
  const visibilityRef = useRef(visibility);
  const mapBaseRef = useRef(mapBase);
  visibilityRef.current = visibility;
  mapBaseRef.current = mapBase;

  useEffect(() => {
    if (!containerRef.current) return undefined;
    let disposed = false;
    let activeController = null;

    const map = new maplibregl.Map({
      container: containerRef.current,
      center: START_CENTER,
      zoom: 15.3,
      minZoom: 12,
      maxZoom: 20,
      maxPitch: 0,
      pitch: 0,
      bearing: 0,
      attributionControl: false,
      dragRotate: false,
      style: {
        version: 8,
        sources: {
          'esri-world-imagery': {
            type: 'raster',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            maxzoom: 19,
            attribution: 'Imagery: Esri, Vantor, Earthstar Geographics, and the GIS User Community',
          },
          'esri-world-street': {
            type: 'raster',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            maxzoom: 19,
            attribution: 'Street basemap: Esri',
          },
        },
        layers: [
          { id: 'satellite-base', type: 'raster', source: 'esri-world-imagery' },
          { id: 'street-base', type: 'raster', source: 'esri-world-street', layout: { visibility: 'none' } },
        ],
      },
    });
    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: true, visualizePitch: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: 'imperial' }), 'bottom-left');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    const updateMapReady = () => {
      if (!disposed) onMapReady?.(true);
    };
    map.on('load', () => {
      if (disposed) return;
      addOperationalLayers(map);
      Object.entries(visibilityRef.current).forEach(([key, visible]) => setLayerVisibility(map, key, visible));
      map.setLayoutProperty('satellite-base', 'visibility', mapBaseRef.current === 'satellite' ? 'visible' : 'none');
      map.setLayoutProperty('street-base', 'visibility', mapBaseRef.current === 'street' ? 'visible' : 'none');
      map.on('click', (event) => {
        const layers = ['parking-fill', 'buildings-fill', 'canopy-fill', 'campus-fill'];
        const found = map.queryRenderedFeatures(event.point, { layers }).find((item) => item.properties);
        if (!found) {
          onSelected?.(null);
          return;
        }
        const layerKey = found.layer.id.startsWith('parking') ? 'parking'
          : found.layer.id.startsWith('buildings') ? 'buildings'
            : found.layer.id.startsWith('canopy') ? 'canopy' : 'campus';
        onSelected?.({
          layerKey,
          layerTitle: DATASETS[layerKey]?.label || 'USF Tampa campus boundary',
          title: getFeatureTitle(found, layerKey),
          objectId: found.properties?.OBJECTID ?? found.properties?.OBJECTID_12 ?? found.id ?? '—',
          facts: getFeatureFacts(found, layerKey),
        });
      });
      ['parking-fill', 'buildings-fill', 'canopy-fill', 'campus-fill'].forEach((layerId) => {
        map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
      });
      updateMapReady();
      // Start data loading directly from the MapLibre load event. Do not gate it
      // on isStyleLoaded(): raster basemap tiles can still be loading at this point.
      void loadData();
    });
    map.on('error', (event) => {
      const message = event?.error?.message || 'Map source failed to load.';
      const sourceId = event?.sourceId || event?.source?.id || '';
      if (sourceId === 'historical-lst-source') onStatus?.('heat', 'error', message);
      else if (sourceId === 'potential-planting-source') onStatus?.('planting', 'error', message);
      else if (sourceId === 'tree-canopy-raster-source') onStatus?.('canopy', 'error', message);
      else if (/tile|raster/i.test(message)) onStatus?.('imagery', 'error', message);
    });

    async function loadData() {
      if (!map.getSource('campus')) return;
      activeController?.abort();
      activeController = new AbortController();
      const signal = activeController.signal;
      onSelected?.(null);
      onCounts?.({ campus: '—', buildings: 0, parking: 0, canopy: 0 });
      ['campus', 'buildings', 'parking', 'canopy'].forEach((key) => onStatus?.(key, 'loading', 'Connecting through the local GIS proxy…'));

      try {
        const { campus, featureCollection } = await loadCampusBoundary(signal);
        if (disposed || signal.aborted) return;
        map.getSource('campus')?.setData(featureCollection);
        const bounds = calculateBounds(campus);
        campusBoundsRef.current = bounds;
        const label = campus.properties?.CAMPUS || campus.properties?.LABEL || 'USF Tampa';
        onStatus?.('campus', 'ready', `Official boundary loaded: ${label}`);
        onCounts?.((previous) => ({ ...previous, campus: label }));
        map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], {
          padding: { top: 76, right: 72, bottom: 70, left: 72 },
          maxZoom: 16.2,
          duration: 850,
        });

        const keys = ['buildings', 'parking', 'canopy'];
        await Promise.all(keys.map(async (key) => {
          try {
            const queried = await queryCampusFeatures(key, campus, signal, (count) => {
              onStatus?.(key, 'loading', `${count.toLocaleString()} features downloaded so far…`);
            });
            if (disposed || signal.aborted) return;
            const collection = clipFeatureCollectionToCampus(queried, campus);
            map.getSource(key)?.setData(toFeatureCollection(collection.features));
            selectedFeaturesRef.current[key] = collection.features;
            const count = collection.features.length;
            if (count === 0) throw new Error('No features intersect the official USF Tampa boundary.');
            const message = `${count.toLocaleString()} campus-intersecting features loaded.`;
            onStatus?.(key, 'ready', message);
            onCounts?.((previous) => ({ ...previous, [key]: count }));
          } catch (error) {
            if (signal.aborted || disposed) return;
            onStatus?.(key, 'error', error instanceof Error ? error.message : 'The GIS query failed.');
          }
        }));
      } catch (error) {
        if (signal.aborted || disposed) return;
        const message = error instanceof Error ? error.message : 'Unable to retrieve the official USF boundary.';
        onStatus?.('campus', 'error', message);
        // Keep a useful satellite map available even if the boundary service is temporarily down.
        map.flyTo({ center: START_CENTER, zoom: 15.3, duration: 650 });
      }
    }

    loadRef.current = loadData;
    onControlsReady?.({
      resetView: () => {
        if (campusBoundsRef.current) {
          const b = campusBoundsRef.current;
          map.fitBounds([[b[0], b[1]], [b[2], b[3]]], {
            padding: { top: 76, right: 72, bottom: 70, left: 72 }, maxZoom: 16.2, duration: 700,
          });
        } else map.flyTo({ center: START_CENTER, zoom: 15.3 });
      },
      reload: () => loadRef.current?.(),
    });

    return () => {
      disposed = true;
      activeController?.abort();
      loadRef.current = null;
      onMapReady?.(false);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    Object.entries(visibility).forEach(([key, visible]) => setLayerVisibility(map, key, visible));
  }, [visibility]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    map.setLayoutProperty('satellite-base', 'visibility', mapBase === 'satellite' ? 'visible' : 'none');
    map.setLayoutProperty('street-base', 'visibility', mapBase === 'street' ? 'visible' : 'none');
  }, [mapBase]);

  useEffect(() => {
    if (reloadToken > 0) loadRef.current?.();
  }, [reloadToken]);

  return <div className="maplibre-host" ref={containerRef} aria-label="Interactive USF Tampa campus satellite map" />;
}
