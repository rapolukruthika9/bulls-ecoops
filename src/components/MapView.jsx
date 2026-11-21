import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
// MapLibre 6 loads a separate worker module. Resolving it through Vite makes the URL explicit
// and stable in both `vite dev` and the production build.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import {
  DATASETS, getFeatureFacts, getFeatureTitle, loadCampusBoundary, loadDataset, toFeatureCollection,
} from '../lib/data.js';
import { validateCollection, featureObjectId } from '../lib/gis.js';

maplibregl.setWorkerUrl(workerUrl);

const START_CENTER = [-82.414, 28.058];
const EMPTY = { type: 'FeatureCollection', features: [] };
const TREE_CANOPY_LAYER_DEFS = encodeURIComponent(JSON.stringify({ 9: "LandCover = 'Tree Canopy'" }));
const CANOPY_TILE_URL = `/gis/canopy/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image&layers=show:9&layerDefs=${TREE_CANOPY_LAYER_DEFS}`;
const PLANTING_TILE_URL = '/gis/canopy/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image&layers=show:10';
const LST_TILE_URL = '/gis/lst/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image&layers=show:15';

const GEOJSON_SOURCES = ['campus', 'buildings', 'parking', 'canopy', 'paths', 'greenspace', 'priority-points', 'priority-shapes', 'selected', 'proposed'];
const VECTOR_KEYS = ['buildings', 'parking', 'canopy', 'paths', 'greenspace'];

// Score ramp (0–100): blue → green → yellow → red, matching a heat-map reading.
const SCORE_COLOR = ['interpolate', ['linear'], ['coalesce', ['get', 'score'], 0],
  0, '#3b6fb6', 25, '#3a9a57', 50, '#e6d84a', 75, '#e8892b', 100, '#c8281e'];

const LAYER_DEFS = [
  { id: 'greenspace-fill', source: 'greenspace', type: 'fill', paint: { 'fill-color': '#7cc47f', 'fill-opacity': 0.32, 'fill-outline-color': '#2d6a3e' } },
  { id: 'canopy-fill', source: 'canopy', type: 'fill', paint: { 'fill-color': '#3a9a57', 'fill-opacity': 0.5, 'fill-outline-color': '#174f2c' } },
  { id: 'buildings-fill', source: 'buildings', type: 'fill', paint: { 'fill-color': '#d8e0e2', 'fill-opacity': 0.83, 'fill-outline-color': '#293b47' } },
  { id: 'parking-fill', source: 'parking', type: 'fill', paint: { 'fill-color': '#e5a64d', 'fill-opacity': 0.62, 'fill-outline-color': '#764b18' } },
  { id: 'campus-fill', source: 'campus', type: 'fill', paint: { 'fill-color': '#9ecb91', 'fill-opacity': 0.035 } },
  { id: 'campus-line', source: 'campus', type: 'line', paint: { 'line-color': '#d8f0b6', 'line-width': 3, 'line-opacity': 0.96 } },
  { id: 'buildings-line', source: 'buildings', type: 'line', paint: { 'line-color': '#364b57', 'line-width': 1.1, 'line-opacity': 0.9 } },
  { id: 'parking-line', source: 'parking', type: 'line', paint: { 'line-color': '#f5cc82', 'line-width': 1.15, 'line-opacity': 1 } },
  { id: 'paths-line', source: 'paths', type: 'line', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#f2f2f2', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1, 18, 3], 'line-opacity': 0.9 } },
  // Priority surface for the active mission (heat-map style) + exact scored shapes.
  {
    id: 'priority-heat', source: 'priority-points', type: 'heatmap', maxzoom: 19,
    paint: {
      'heatmap-weight': ['interpolate', ['linear'], ['coalesce', ['get', 'score'], 0], 0, 0, 100, 1],
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 13, 0.8, 18, 1.8],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 13, 22, 16, 48, 19, 110],
      'heatmap-opacity': 0.72,
      'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
        0, 'rgba(59,111,182,0)', 0.15, 'rgba(59,111,182,.55)', 0.35, 'rgba(58,154,87,.7)',
        0.55, 'rgba(230,216,74,.8)', 0.78, 'rgba(232,137,43,.88)', 1, 'rgba(200,40,30,.92)'],
    },
  },
  { id: 'priority-fill', source: 'priority-shapes', type: 'fill', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': SCORE_COLOR, 'fill-opacity': 0.5 } },
  { id: 'priority-outline', source: 'priority-shapes', type: 'line', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'line-color': SCORE_COLOR, 'line-width': 2 } },
  { id: 'priority-line', source: 'priority-shapes', type: 'line', filter: ['!=', ['geometry-type'], 'Polygon'], layout: { 'line-cap': 'round' }, paint: { 'line-color': SCORE_COLOR, 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 2.5, 18, 7], 'line-opacity': 0.95 } },
  { id: 'proposed-line', source: 'proposed', type: 'line', paint: { 'line-color': '#006747', 'line-width': 3, 'line-dasharray': [2, 1.5] } },
  { id: 'selected-line', source: 'selected', type: 'line', paint: { 'line-color': '#00ff88', 'line-width': 4.5, 'line-opacity': 1 } },
];

const VISIBILITY_LAYERS = {
  canopy: ['tree-canopy-raster', 'canopy-fill'],
  planting: ['potential-planting-raster'],
  buildings: ['buildings-fill', 'buildings-line'],
  parking: ['parking-fill', 'parking-line'],
  campus: ['campus-fill', 'campus-line'],
  heat: ['historical-lst'],
  paths: ['paths-line'],
  greenspace: ['greenspace-fill'],
  priority: ['priority-heat', 'priority-fill', 'priority-outline', 'priority-line'],
};
const CLICKABLE = ['priority-fill', 'priority-line', 'parking-fill', 'buildings-fill', 'paths-line', 'canopy-fill', 'greenspace-fill', 'campus-fill'];
const LAYER_TO_KEY = {
  'priority-fill': null, 'priority-line': null, 'parking-fill': 'parking', 'buildings-fill': 'buildings',
  'paths-line': 'paths', 'canopy-fill': 'canopy', 'greenspace-fill': 'greenspace', 'campus-fill': 'campus',
};

function calculateBounds(feature) {
  const result = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (coords) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      result[0] = Math.min(result[0], coords[0]); result[1] = Math.min(result[1], coords[1]);
      result[2] = Math.max(result[2], coords[0]); result[3] = Math.max(result[3], coords[1]);
      return;
    }
    coords.forEach(walk);
  };
  walk(feature?.geometry?.coordinates);
  if (!Number.isFinite(result[0])) throw new Error('Campus boundary coordinates could not be read.');
  return result;
}

function setLayerVisibility(map, key, visible) {
  (VISIBILITY_LAYERS[key] || []).forEach((id) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  });
}

function addRasterOverlay(map, id, url, attribution, opacity, visible) {
  map.addSource(`${id}-source`, { type: 'raster', tiles: [url], tileSize: 256, attribution });
  map.addLayer({ id, type: 'raster', source: `${id}-source`, layout: { visibility: visible ? 'visible' : 'none' }, paint: { 'raster-opacity': opacity, 'raster-fade-duration': 100 } });
}

function addOperationalLayers(map) {
  GEOJSON_SOURCES.forEach((id) => { if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY }); });
  addRasterOverlay(map, 'historical-lst', LST_TILE_URL, 'USF Water Institute · City of Tampa UTC 2021 (historical study)', 0.62, false);
  addRasterOverlay(map, 'potential-planting-raster', PLANTING_TILE_URL, 'USF Water Institute · Tampa UTC 2021 potential planting', 0.58, false);
  addRasterOverlay(map, 'tree-canopy-raster', CANOPY_TILE_URL, 'USF Water Institute · Tampa Urban Tree Canopy 2021', 0.62, true);
  LAYER_DEFS.forEach((layer) => { if (!map.getLayer(layer.id)) map.addLayer(layer); });
}

export default function MapView({
  visibility, mapBase, reloadToken, priority, selectedGeometry, proposedGeometry,
  onStatus, onSelected, onData, onControlsReady, onMapReady,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const loadRef = useRef(null);
  const campusBoundsRef = useRef(null);
  const readyRef = useRef(false);
  const visibilityRef = useRef(visibility);
  const mapBaseRef = useRef(mapBase);
  const dataRef = useRef({ priority, selectedGeometry, proposedGeometry });
  visibilityRef.current = visibility;
  mapBaseRef.current = mapBase;
  dataRef.current = { priority, selectedGeometry, proposedGeometry };

  useEffect(() => {
    if (!containerRef.current) return undefined;
    let disposed = false;
    let activeController = null;

    const map = new maplibregl.Map({
      container: containerRef.current,
      center: START_CENTER, zoom: 15.3, minZoom: 12, maxZoom: 20, maxPitch: 0, pitch: 0, bearing: 0,
      attributionControl: false, dragRotate: false,
      style: {
        version: 8,
        sources: {
          'esri-world-imagery': { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: 'Imagery: Esri, Vantor, Earthstar Geographics, and the GIS User Community' },
          'esri-world-street': { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: 'Street basemap: Esri' },
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

    const pushDynamicData = () => {
      const d = dataRef.current;
      map.getSource('priority-points')?.setData(d.priority?.points || EMPTY);
      map.getSource('priority-shapes')?.setData(d.priority?.shapes || EMPTY);
      map.getSource('selected')?.setData(d.selectedGeometry ? { type: 'Feature', properties: {}, geometry: d.selectedGeometry } : EMPTY);
      map.getSource('proposed')?.setData(d.proposedGeometry ? { type: 'Feature', properties: {}, geometry: d.proposedGeometry } : EMPTY);
    };

    map.on('load', () => {
      if (disposed) return;
      addOperationalLayers(map);
      readyRef.current = true;
      Object.entries(visibilityRef.current).forEach(([key, visible]) => setLayerVisibility(map, key, visible));
      map.setLayoutProperty('satellite-base', 'visibility', mapBaseRef.current === 'satellite' ? 'visible' : 'none');
      map.setLayoutProperty('street-base', 'visibility', mapBaseRef.current === 'street' ? 'visible' : 'none');
      pushDynamicData();

      map.on('click', (event) => {
        const found = map.queryRenderedFeatures(event.point, { layers: CLICKABLE.filter((id) => map.getLayer(id)) }).find((item) => item.properties);
        if (!found) { onSelected?.(null); return; }
        const props = found.properties || {};
        let layerKey = LAYER_TO_KEY[found.layer.id];
        if (layerKey === null) layerKey = props.layerKey; // priority shapes carry their source layer
        onSelected?.({
          layerKey,
          layerTitle: DATASETS[layerKey]?.label || 'USF Tampa campus boundary',
          title: getFeatureTitle(found, layerKey),
          objectId: props.__oid ?? props.OBJECTID ?? props.OBJECTID_12 ?? found.id ?? '—',
          facts: getFeatureFacts(found, layerKey),
        });
      });
      CLICKABLE.forEach((layerId) => {
        map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
      });
      onMapReady?.(true);
      void loadData();
    });

    map.on('error', (event) => {
      const message = event?.error?.message || 'Map source failed to load.';
      const sourceId = event?.sourceId || '';
      if (sourceId === 'historical-lst-source') onStatus?.('heat', 'error', message);
      else if (sourceId === 'potential-planting-raster-source') onStatus?.('planting', 'error', message);
      else if (sourceId === 'tree-canopy-raster-source') onStatus?.('canopyRaster', 'error', message);
    });

    async function loadData() {
      if (!map.getSource('campus')) return;
      activeController?.abort();
      activeController = new AbortController();
      const signal = activeController.signal;
      onSelected?.(null);
      onData?.(null); // reset
      ['campus', ...VECTOR_KEYS].forEach((key) => onStatus?.(key, 'loading', 'Connecting through the GIS proxy…'));

      try {
        const { campus, featureCollection } = await loadCampusBoundary(signal);
        if (disposed || signal.aborted) return;
        map.getSource('campus')?.setData(featureCollection);
        const bounds = calculateBounds(campus);
        campusBoundsRef.current = bounds;
        const label = campus.properties?.CAMPUS || campus.properties?.LABEL || 'USF Tampa';
        onStatus?.('campus', 'ready', `Official boundary loaded: ${label}`);
        map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: { top: 76, right: 72, bottom: 70, left: 72 }, maxZoom: 16.2, duration: 850 });

        const loaded = { campus, bounds };
        await Promise.all(VECTOR_KEYS.map(async (key) => {
          try {
            const result = await loadDataset(key, campus, signal, (count) => onStatus?.(key, 'loading', `${count.toLocaleString()} features downloaded so far…`));
            if (disposed || signal.aborted) return;
            const kind = DATASETS[key].type === 'line' ? 'line' : 'polygon';
            const { collection, issues } = validateCollection(result.collection, { kind, bounds: [bounds[0] - 0.01, bounds[1] - 0.01, bounds[2] + 0.01, bounds[3] + 0.01] });
            map.getSource(key)?.setData(toFeatureCollection(collection.features));
            loaded[key] = { collection, issues, origin: result.origin, retrievedAt: result.retrievedAt };
            const dropped = issues.total - collection.features.length;
            const where = result.origin === 'snapshot' ? `Cached public snapshot — retrieved ${result.retrievedAt ? new Date(result.retrievedAt).toLocaleDateString() : 'date unknown'}. ` : '';
            onStatus?.(key, result.origin === 'snapshot' ? 'cached' : 'ready',
              `${where}${collection.features.length.toLocaleString()} validated features${dropped ? ` (${dropped} dropped: ${Object.entries(issues).filter(([k, v]) => k !== 'total' && v).map(([k, v]) => `${v} ${k}`).join(', ')})` : ''}.`);
          } catch (error) {
            if (signal.aborted || disposed) return;
            onStatus?.(key, 'error', error instanceof Error ? error.message : 'The GIS query failed.');
          }
        }));
        if (!disposed && !signal.aborted) onData?.(loaded);
      } catch (error) {
        if (signal.aborted || disposed) return;
        onStatus?.('campus', 'error', error instanceof Error ? error.message : 'Unable to retrieve the official USF boundary.');
        map.flyTo({ center: START_CENTER, zoom: 15.3, duration: 650 });
      }
    }

    loadRef.current = loadData;
    onControlsReady?.({
      resetView: () => {
        const b = campusBoundsRef.current;
        if (b) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: { top: 76, right: 72, bottom: 70, left: 72 }, maxZoom: 16.2, duration: 700 });
        else map.flyTo({ center: START_CENTER, zoom: 15.3 });
      },
      flyToGeometry: (geometry) => {
        if (!geometry) return;
        const b = calculateBounds({ geometry });
        map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 160, maxZoom: 18.5, duration: 700 });
      },
      reload: () => loadRef.current?.(),
    });

    return () => {
      disposed = true;
      activeController?.abort();
      loadRef.current = null;
      readyRef.current = false;
      onMapReady?.(false);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    Object.entries(visibility).forEach(([key, visible]) => setLayerVisibility(map, key, visible));
  }, [visibility]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.setLayoutProperty('satellite-base', 'visibility', mapBase === 'satellite' ? 'visible' : 'none');
    map.setLayoutProperty('street-base', 'visibility', mapBase === 'street' ? 'visible' : 'none');
  }, [mapBase]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.getSource('priority-points')?.setData(priority?.points || EMPTY);
    map.getSource('priority-shapes')?.setData(priority?.shapes || EMPTY);
  }, [priority]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.getSource('selected')?.setData(selectedGeometry ? { type: 'Feature', properties: {}, geometry: selectedGeometry } : EMPTY);
  }, [selectedGeometry]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.getSource('proposed')?.setData(proposedGeometry ? { type: 'Feature', properties: {}, geometry: proposedGeometry } : EMPTY);
  }, [proposedGeometry]);

  useEffect(() => { if (reloadToken > 0) loadRef.current?.(); }, [reloadToken]);

  return <div className="maplibre-host" ref={containerRef} aria-label="Interactive USF Tampa campus satellite map" />;
}

export { featureObjectId };
