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
};

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
  const response = await fetch(`${url}?${query.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });
  return parseJsonResponse(response, url);
}

async function postJson(url, params, signal) {
  const body = new URLSearchParams(params);
  const response = await fetch(url, {
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
  const esriGeometry = JSON.stringify(geometryToEsriJson(campusFeature.geometry));
  const recordCount = datasetKey === 'canopy' ? 1500 : 900;
  const allFeatures = [];
  let offset = 0;
  let pages = 0;

  while (pages < 12) {
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
      orderByFields: `${dataset.objectIdField} ASC`,
      f: 'geojson',
    }, signal);

    const features = json.features || [];
    allFeatures.push(...features);
    pages += 1;
    if (onPage) onPage(allFeatures.length);
    if (features.length < recordCount) break;
    offset += features.length;
  }

  return { type: 'FeatureCollection', features: allFeatures };
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
      : layerKey === 'canopy'
        ? ['LandCover', 'LandCoverSimple', 'PotentialPlanting_YN', 'Value', 'Shape_Area']
        : ['CAMPUS', 'CAMPUS_ACREAGE', 'PROPERTY_TYPE', 'LABEL'];
  return preferred.filter((key) => p[key] !== undefined && p[key] !== null && p[key] !== '')
    .map((key) => [key.replaceAll('_', ' '), p[key]]);
}

export function toFeatureCollection(features = []) {
  return features.length ? { type: 'FeatureCollection', features } : emptyCollection();
}
