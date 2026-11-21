import { featureCollection } from '@turf/helpers';
import { intersect } from '@turf/intersect';

export const DATASETS = {
  campus: {
    label: 'USF Tampa campus boundary',
    url: '/gis/campus/0/query',
    type: 'boundary',
  },
  buildings: {
    label: 'USF building footprints',
    url: '/gis/buildings/1/query',
    type: 'polygon',
    objectIdField: 'OBJECTID',
  },
  parking: {
    label: 'USF surface parking lots',
    url: '/gis/parking/1/query',
    type: 'polygon',
    objectIdField: 'OBJECTID_12',
  },
  canopy: {
    label: 'Tampa tree canopy polygons (2021)',
    url: '/gis/canopy/9/query',
    type: 'polygon',
    objectIdField: 'OBJECTID',
  },
  // USF University Facilities Community Maps layers (plan: layer 11 paths, layer 18 green space)
  paths: {
    label: 'USF sidewalks / footpaths',
    url: '/gis/usfmaps/11/query',
    type: 'line',
    objectIdField: 'OBJECTID',
    sourceId: 'src-paths',
  },
  greenspace: {
    label: 'USF campus green space',
    url: '/gis/usfmaps/18/query',
    type: 'polygon',
    objectIdField: 'OBJECTID',
    sourceId: 'src-green',
  },
};

// Base prefix for same-origin GIS proxy URLs. Empty in the browser; the snapshot script
// points it at a local server instance.
let gisBase = '';
export function setGisBase(base) { gisBase = base || ''; }
const withBase = (url) => `${gisBase}${url}`;

const objectIdCache = new Map();
/** Read layer metadata (plan: metadata first) to learn the real OID field name and page size. */
export async function readLayerMeta(datasetKey, signal) {
  if (objectIdCache.has(datasetKey)) return objectIdCache.get(datasetKey);
  const dataset = DATASETS[datasetKey];
  const fallback = { objectIdField: dataset.objectIdField || 'OBJECTID', maxRecordCount: 1000, name: dataset.label, wkid: null };
  try {
    const json = await getJson(dataset.url.replace(/\/query$/, ''), { f: 'pjson' }, signal);
    const oid = (json.fields || []).find((f) => f.type === 'esriFieldTypeOID');
    const meta = {
      objectIdField: oid?.name || fallback.objectIdField,
      maxRecordCount: Number(json.maxRecordCount) || fallback.maxRecordCount,
      name: json.name || fallback.name,
      wkid: json.extent?.spatialReference?.latestWkid || json.extent?.spatialReference?.wkid || null,
    };
    objectIdCache.set(datasetKey, meta);
    return meta;
  } catch {
    return fallback; // not cached: retry next time
  }
}

const emptyCollection = () => ({ type: 'FeatureCollection', features: [] });

function geometryToEsriJson(geometry) {
  if (!geometry) throw new Error('Campus boundary geometry is missing.');
  let polygonGroups;
  if (geometry.type === 'Polygon') polygonGroups = [geometry.coordinates];
  else if (geometry.type === 'MultiPolygon') polygonGroups = geometry.coordinates;
  else throw new Error(`Unsupported campus boundary geometry: ${geometry.type}`);

  // Esri JSON uses clockwise exterior rings and counter-clockwise holes.
  const rings = [];
  for (const polygon of polygonGroups) {
    polygon.forEach((ring, index) => {
      const signedArea = ring.reduce((sum, point, i) => {
        const next = ring[(i + 1) % ring.length];
        return sum + point[0] * next[1] - next[0] * point[1];
      }, 0) / 2;
      const shouldBeClockwise = index === 0;
      const isClockwise = signedArea < 0;
      rings.push(shouldBeClockwise === isClockwise ? ring : [...ring].reverse());
    });
  }
  return { rings, spatialReference: { wkid: 4326 } };
}

function featureBounds(feature) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = (value) => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
      bounds[0] = Math.min(bounds[0], value[0]);
      bounds[1] = Math.min(bounds[1], value[1]);
      bounds[2] = Math.max(bounds[2], value[0]);
      bounds[3] = Math.max(bounds[3], value[1]);
      return;
    }
    value.forEach(visit);
  };
  visit(feature?.geometry?.coordinates);
  return bounds;
}

function boundsArea(feature) {
  const b = featureBounds(feature);
  return Number.isFinite(b[0]) ? Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]) : 0;
}

async function parseJsonResponse(response, url) {
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  const json = await response.json();
  if (json.error) {
    const detail = json.error.details?.filter(Boolean).join('; ');
    throw new Error(`${json.error.message || 'ArcGIS query failed'}${detail ? `: ${detail}` : ''}`);
  }
  return json;
}

async function getJson(url, params, signal) {
  const query = new URLSearchParams(params);
  const response = await fetch(`${withBase(url)}?${query.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });
  return parseJsonResponse(response, url);
}

async function postJson(url, params, signal) {
  const body = new URLSearchParams(params);
  const response = await fetch(withBase(url), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body: body.toString(),
    signal,
  });
  return parseJsonResponse(response, url);
}

export async function loadCampusBoundary(signal) {
  const json = await getJson(DATASETS.campus.url, {
    where: "CAMPUS LIKE '%Tampa%'",
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson',
  }, signal);
  if (!json.features?.length) throw new Error('The USF boundary service returned no Tampa campus features.');

  const candidates = json.features.filter((feature) => {
    const attrs = feature.properties || {};
    return String(attrs.CAMPUS || attrs.LABEL || '').toLowerCase().includes('tampa');
  });
  const pool = candidates.length ? candidates : json.features;
  pool.sort((a, b) => boundsArea(b) - boundsArea(a));
  const campus = pool[0];
  if (!campus.geometry) throw new Error('The selected Tampa campus boundary has no geometry.');
  return { campus, featureCollection: { type: 'FeatureCollection', features: [campus] } };
}

export async function queryCampusFeatures(datasetKey, campusFeature, signal, onPage) {
  const dataset = DATASETS[datasetKey];
  const meta = await readLayerMeta(datasetKey, signal);
  const esriGeometry = JSON.stringify(geometryToEsriJson(campusFeature.geometry));
  const wanted = datasetKey === 'canopy' ? 1500 : 900;
  const recordCount = Math.max(100, Math.min(wanted, meta.maxRecordCount));
  const allFeatures = [];
  let offset = 0;
  let pages = 0;

  while (pages < 20) {
    const json = await postJson(dataset.url, {
      where: datasetKey === 'canopy' ? "LandCover = 'Tree Canopy'" : '1=1',
      geometry: esriGeometry,
      geometryType: 'esriGeometryPolygon',
      spatialRel: 'esriSpatialRelIntersects',
      inSR: '4326',
      outSR: '4326',
      outFields: '*',
      returnGeometry: 'true',
      returnZ: 'false',
      returnM: 'false',
      resultOffset: String(offset),
      resultRecordCount: String(recordCount),
      orderByFields: `${meta.objectIdField} ASC`,
      f: 'geojson',
    }, signal);

    const features = json.features || [];
    allFeatures.push(...features);
    pages += 1;
    if (onPage) onPage(allFeatures.length);
    // Servers may cap a page below what we asked for (exceededTransferLimit), so only an
    // empty page, or a short page without that flag, ends pagination.
    const more = json.exceededTransferLimit || json.properties?.exceededTransferLimit;
    if (features.length === 0 || (features.length < recordCount && !more)) break;
    offset += features.length;
  }

  return { type: 'FeatureCollection', features: allFeatures };
}

/**
 * Load one dataset for the campus. Live query first; if the service is unreachable fall back
 * to a cached public snapshot in /data (written by `npm run snapshot`) and say so.
 * Returns { collection, origin: 'live'|'snapshot', retrievedAt, count }.
 */
export async function loadDataset(datasetKey, campusFeature, signal, onPage) {
  const dataset = DATASETS[datasetKey];
  try {
    const queried = await queryCampusFeatures(datasetKey, campusFeature, signal, onPage);
    const collection = dataset.type === 'polygon' ? clipFeatureCollectionToCampus(queried, campusFeature) : queried;
    if (!collection.features.length) throw new Error('No features intersect the official USF Tampa boundary.');
    return { collection, origin: 'live', retrievedAt: new Date().toISOString(), count: collection.features.length };
  } catch (liveError) {
    if (signal?.aborted) throw liveError;
    try {
      const response = await fetch(withBase(`/data/${datasetKey}.geojson`), { signal });
      const type = response.headers.get('content-type') || '';
      if (!response.ok || /text\/html/i.test(type)) throw new Error('no snapshot');
      const snapshot = await response.json();
      if (!snapshot?.features?.length) throw new Error('empty snapshot');
      return {
        collection: { type: 'FeatureCollection', features: snapshot.features },
        origin: 'snapshot',
        retrievedAt: snapshot.bullsMeta?.retrievedAt || null,
        count: snapshot.features.length,
        liveError: liveError instanceof Error ? liveError.message : String(liveError),
      };
    } catch {
      throw liveError;
    }
  }
}

export function clipFeatureCollectionToCampus(collection, campusFeature) {
  const clippedFeatures = [];
  for (const feature of (collection?.features || [])) {
    const geometryType = feature?.geometry?.type;
    if (geometryType !== 'Polygon' && geometryType !== 'MultiPolygon') continue;
    try {
      const clipped = intersect(featureCollection([feature, campusFeature]), {
        properties: feature.properties || {},
      });
      if (clipped?.geometry) clippedFeatures.push(clipped);
    } catch (error) {
      // Keep the map honest: skip malformed polygon geometry rather than draw it
      // outside the campus boundary or silently substitute a rectangle.
      console.warn('Skipped a polygon that could not be clipped to the campus boundary.', error);
    }
  }
  return { type: 'FeatureCollection', features: clippedFeatures };
}

export function getFeatureTitle(feature, layerKey) {
  const p = feature?.properties || {};
  if (layerKey === 'paths') return p.NAME || p.PATH_NAME || p.FULLNAME || p.LABEL || 'USF walkway';
  if (layerKey === 'greenspace') return p.NAME || p.LABEL || 'USF green space';
  if (layerKey === 'buildings') return p.LONGNAME || p.SHORTNAME || p.BUILDINGID || 'USF building';
  if (layerKey === 'parking') return p.LOT_NUMBER ? `Parking lot ${p.LOT_NUMBER}` : (p.LOT_ID || 'Surface parking lot');
  if (layerKey === 'canopy') return p.LandCover || 'Tree canopy polygon';
  return p.CAMPUS || p.LABEL || 'USF Tampa campus';
}

export function getFeatureFacts(feature, layerKey) {
  const p = feature?.properties || {};
  const preferred = layerKey === 'buildings'
    ? ['BUILDINGID', 'SHORTNAME', 'LONGNAME', 'BLDGTYPE', 'BLDGHEIGHT', 'FLOORCOUNT', 'GSF', 'BUILDING_STATUS']
    : layerKey === 'parking'
      ? ['LOT_NUMBER', 'LOT_ID', 'LOT_SPACES', 'PERMITS', 'ADA_SPOTS', 'SQUARE_FT', 'BUILDING_NAME']
      : layerKey === 'paths' || layerKey === 'greenspace'
        ? ['NAME', 'LABEL', 'TYPE', 'SURFACE', 'Shape__Length', 'Shape__Area']
      : layerKey === 'canopy'
        ? ['LandCover', 'LandCoverSimple', 'PotentialPlanting_YN', 'Value', 'Shape_Area']
        : ['CAMPUS', 'CAMPUS_ACREAGE', 'PROPERTY_TYPE', 'LABEL'];
  return preferred.filter((key) => p[key] !== undefined && p[key] !== null && p[key] !== '')
    .map((key) => [key.replaceAll('_', ' '), p[key]]);
}

export function toFeatureCollection(features = []) {
  return features.length ? { type: 'FeatureCollection', features } : emptyCollection();
}
