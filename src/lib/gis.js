// EcoScan GIS engine. All measurements come from Turf operating on validated GeoJSON in
// WGS84 (EPSG:4326). Gemini never sees raw geometry and never computes any of this.
//
// Screening metrics only — geodesic area/length on WGS84, not surveyed measurements.

import {
  area, bbox, buffer, centroid, difference, featureCollection, intersect, length, lineString, polygon,
  pointOnFeature, polygonToLine, pointToLineDistance, booleanPointInPolygon, union,
} from '@turf/turf';
import { sanitizeText } from '../../shared/proposal.js';
import { rankMission, DEFAULT_WEIGHTS, FORMULAS, evidenceConfidence } from '../../shared/scoring.js';

export const SITE_PREFIX = { paths: 'path', parking: 'parking', buildings: 'building', openspace: 'openspace' };
export const DEFAULTS = {
  bufferM: 10,
  usableFractionPct: 60,
  minSolarAreaM2: 150,
  minWaterAreaM2: 100,
  nearbyDeg: 0.003, // ≈ 300 m prefilter for proximity searches
  // Green-planting open-space screening: campus − buildings − parking − stadium/athletic buildings
  buildingBufferM: 8,
  parkingBufferM: 5,
  athleticBufferM: 40,
  minOpenAreaM2: 500,
  minOpenWidthM: 10, // a space must survive a (width/2) inward buffer, which drops roadside slivers
  maxOpenSpaces: 150,
};
// Buildings whose names suggest stadiums / arenas / sports facilities get a wider exclusion buffer.
export const ATHLETIC_RE = /stadium|arena|\bfield\b|court|track|\bgym|athletic|recreation|\brec\b|aquatic|\bpool\b|golf|tennis|softball|baseball|soccer|football|yuengling|sun ?dome/i;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// ---------------------------------------------------------------------------
// Validation / normalisation
// ---------------------------------------------------------------------------

export function featureObjectId(feature, fallback) {
  const p = feature?.properties || {};
  return String(p.__oid ?? feature?.id ?? p.OBJECTID ?? p.OBJECTID_12 ?? p.FID ?? fallback ?? '');
}

function coordsOk(value) {
  if (!Array.isArray(value)) return false;
  if (typeof value[0] === 'number') return Number.isFinite(value[0]) && Number.isFinite(value[1])
    && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
  return value.length > 0 && value.every(coordsOk);
}

/**
 * Validate a GeoJSON collection: parse check, geometry type, null geometry, coordinate
 * bounds, duplicate IDs. Stamps a stable `__oid` property used across map, scan and evidence.
 * Returns { collection, issues } — nothing is silently repaired or invented.
 */
export function validateCollection(collection, { kind, bounds = null }) {
  const allowed = kind === 'line' ? ['LineString', 'MultiLineString'] : ['Polygon', 'MultiPolygon'];
  const issues = { total: 0, nullGeometry: 0, wrongType: 0, badCoordinates: 0, outOfBounds: 0, duplicates: 0 };
  const seen = new Set();
  const out = [];
  const features = collection?.features || [];
  issues.total = features.length;
  features.forEach((feature, index) => {
    const g = feature?.geometry;
    if (!g) { issues.nullGeometry += 1; return; }
    if (!allowed.includes(g.type)) { issues.wrongType += 1; return; }
    if (!coordsOk(g.coordinates)) { issues.badCoordinates += 1; return; }
    if (bounds) {
      const [minX, minY, maxX, maxY] = bbox(feature);
      if (maxX < bounds[0] || minX > bounds[2] || maxY < bounds[1] || minY > bounds[3]) { issues.outOfBounds += 1; return; }
    }
    const id = featureObjectId(feature, index);
    if (seen.has(id)) { issues.duplicates += 1; return; }
    seen.add(id);
    out.push({ ...feature, properties: { ...(feature.properties || {}), __oid: id } });
  });
  return { collection: { type: 'FeatureCollection', features: out }, issues };
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

export function siteName(feature, kind, objectId) {
  const p = feature.properties || {};
  let name;
  if (kind === 'parking') name = p.LOT_NUMBER ? `Parking lot ${p.LOT_NUMBER}` : (p.LOT_ID || `Parking lot ${objectId}`);
  else if (kind === 'building') name = p.LONGNAME || p.SHORTNAME || p.BUILDINGID || `Building ${objectId}`;
  else name = p.NAME || p.PATH_NAME || p.FULLNAME || p.LABEL || `Walkway ${objectId}`;
  return sanitizeText(name) || `${kind} ${objectId}`;
}

// ---------------------------------------------------------------------------
// Spatial helpers
// ---------------------------------------------------------------------------

const bboxOverlap = (a, b) => !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
const expand = (b, d) => [b[0] - d, b[1] - d, b[2] + d, b[3] + d];

function polygonParts(feature) {
  const g = feature.geometry;
  return g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
}
function lineParts(feature) {
  const g = feature.geometry;
  return g.type === 'LineString' ? [g.coordinates] : g.coordinates;
}

function sumAreaDissolved(pieces) {
  // Union before summing so overlapping canopy polygons are not double-counted.
  if (!pieces.length) return { areaM2: 0, approximate: false };
  if (pieces.length === 1) return { areaM2: area(pieces[0]), approximate: false };
  try {
    const merged = union(featureCollection(pieces));
    return { areaM2: merged ? area(merged) : 0, approximate: false };
  } catch {
    // Flag rather than hide: summed overlap may double count.
    return { areaM2: pieces.reduce((s, p) => s + area(p), 0), approximate: true };
  }
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * @param {{paths?:object, canopy?:object, parking?:object, buildings?:object, greenspace?:object}} data
 *   validated FeatureCollections (null/undefined when a layer is unavailable)
 */
export function createEngine(data /* {campus, paths, canopy, parking, buildings, greenspace} */, expected = { paths: true, greenspace: true }, options = {}) {
  const isDemo = Boolean(options.demo); // synthetic demo geometry: carried on every candidate
  const available = {
    paths: Boolean(data.paths?.features?.length),
    canopy: Boolean(data.canopy?.features?.length),
    parking: Boolean(data.parking?.features?.length),
    buildings: Boolean(data.buildings?.features?.length),
    greenspace: Boolean(data.greenspace?.features?.length),
  };

  const canopyIndex = (data.canopy?.features || []).map((feature) => ({ feature, box: bbox(feature) }));

  const pathLines = [];
  for (const feature of data.paths?.features || []) {
    for (const coords of lineParts(feature)) {
      if (coords.length < 2) continue;
      const line = lineString(coords);
      pathLines.push({ line, box: bbox(line) });
    }
  }

  const greenRings = [];
  for (const feature of data.greenspace?.features || []) {
    for (const polygon of polygonParts(feature)) {
      const outer = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: polygon } };
      greenRings.push({
        polygon: outer,
        box: bbox(outer),
        rings: polygon.filter((r) => r.length >= 2).map((r) => lineString(r)),
      });
    }
  }

  // Building outlines for the load-proximity factor (distance from a lot to the nearest building).
  const buildingRings = [];
  for (const feature of data.buildings?.features || []) {
    for (const polygonCoords of polygonParts(feature)) {
      const outer = polygonCoords[0];
      if (!outer || outer.length < 3) continue;
      const line = lineString(outer);
      buildingRings.push({ line, box: bbox(line) });
    }
  }

  function nearestBuildingDistanceM(pt) {
    if (!buildingRings.length) return null;
    const [x, y] = pt.geometry.coordinates;
    const probe = [x, y, x, y];
    let best = Infinity;
    for (const b of buildingRings) {
      if (!bboxOverlap(expand(b.box, DEFAULTS.nearbyDeg), probe)) continue;
      const d = pointToLineDistance(pt, b.line, { units: 'meters' });
      if (d < best) best = d;
    }
    // Nothing within the ~300 m search window: report the window itself (a documented cap).
    return Number.isFinite(best) ? best : 300;
  }

  function canopyOverlap(buffered) {
    const box = bbox(buffered);
    const pieces = [];
    for (const c of canopyIndex) {
      if (!bboxOverlap(box, c.box)) continue;
      try {
        const piece = intersect(featureCollection([buffered, c.feature]));
        if (piece?.geometry) pieces.push(piece);
      } catch { /* malformed canopy polygon: skip, never invent overlap */ }
    }
    return sumAreaDissolved(pieces);
  }

  /** Green-corridor baseline for one path feature (EcoScan → Green mission). */
  function analyzePath(feature, { bufferM = DEFAULTS.bufferM } = {}) {
    const objectId = featureObjectId(feature);
    const pathLengthM = length(feature, { units: 'kilometers' }) * 1000;
    let buffered;
    try { buffered = buffer(feature, bufferM, { units: 'meters' }); } catch { return null; }
    if (!buffered?.geometry) return null;
    const bufferAreaM2 = area(buffered);
    if (!(bufferAreaM2 > 0) || !(pathLengthM > 0)) return null;
    const [lon, lat] = centroid(feature).geometry.coordinates;
    const { areaM2, approximate } = canopyOverlap(buffered);
    const canopyOverlapM2 = Math.min(areaM2, bufferAreaM2);
    const canopyPct = (canopyOverlapM2 / bufferAreaM2) * 100;
    return {
      id: `${SITE_PREFIX.paths}-${objectId}`,
      objectId,
      kind: 'path',
      demo: isDemo,
      mission: 'green',
      layerKey: 'paths',
      lon,
      lat,
      name: siteName(feature, 'path', objectId),
      geometry: feature.geometry,
      approximate,
      missing: available.canopy ? [] : ['tree canopy layer'],
      raw: {
        pathLengthM, bufferM, bufferAreaM2, canopyOverlapM2, canopyPct, lowCanopyPct: 100 - canopyPct,
      },
    };
  }

  function nearestPathDistanceM(pt) {
    if (!pathLines.length) return null;
    const [x, y] = pt.geometry.coordinates;
    const probe = [x, y, x, y];
    let best = Infinity;
    for (const p of pathLines) {
      if (!bboxOverlap(expand(p.box, DEFAULTS.nearbyDeg), probe)) continue;
      const d = pointToLineDistance(pt, p.line, { units: 'meters' });
      if (d < best) best = d;
    }
    return Number.isFinite(best) ? best : null;
  }

  function greenDistanceM(pt) {
    if (!greenRings.length) return null;
    const [x, y] = pt.geometry.coordinates;
    const probe = [x, y, x, y];
    let best = Infinity;
    for (const g of greenRings) {
      if (!bboxOverlap(expand(g.box, DEFAULTS.nearbyDeg), probe)) continue;
      if (booleanPointInPolygon(pt, g.polygon)) return 0;
      for (const ring of g.rings) {
        const d = pointToLineDistance(pt, ring, { units: 'meters' });
        if (d < best) best = d;
      }
    }
    return Number.isFinite(best) ? best : null;
  }

  /** Solar/water baseline for one parking or building polygon. */
  function analyzeSite(feature, layerKey, { usableFractionPct = DEFAULTS.usableFractionPct } = {}) {
    const kind = SITE_PREFIX[layerKey];
    const objectId = featureObjectId(feature);
    const mappedAreaM2 = area(feature);
    if (!(mappedAreaM2 > 0)) return null;
    const pt = centroid(feature);
    const pathDistanceM = nearestPathDistanceM(pt);
    const greenDist = greenDistanceM(pt);
    const missing = [];
    // Only layers the app actually expects count as "missing" (optional layers are off by default).
    if (expected.paths && !available.paths) missing.push('paths layer');
    if (expected.greenspace && !available.greenspace) missing.push('green-space layer');
    return {
      id: `${kind}-${objectId}`,
      objectId,
      kind,
      demo: isDemo,
      layerKey,
      lon: pt.geometry.coordinates[0],
      lat: pt.geometry.coordinates[1],
      name: siteName(feature, kind, objectId),
      geometry: feature.geometry,
      approximate: false,
      missing,
      raw: {
        mappedAreaM2,
        usableAreaM2: mappedAreaM2 * (usableFractionPct / 100),
        usableFractionPct,
        catchmentAreaM2: kind === 'building' ? mappedAreaM2 : 0,
        pavedAreaM2: kind === 'parking' ? mappedAreaM2 : 0,
        pathDistanceM,
        greenDistanceM: greenDist,
        // A building roof is itself the load; a parking lot is measured to the nearest building outline.
        loadDistanceM: kind === 'building' ? 0 : nearestBuildingDistanceM(pt),
      },
    };
  }

  /**
   * Unbuilt open space for green planting: campus boundary minus buffered buildings, parking and
   * stadium/athletic buildings (and existing canopy polygons when that layer is loaded).
   * Roads, ponds and athletic fields have no layer here, so results are screening candidates only.
   */
  async function findOpenSpaces(opts, { signal } = {}) {
    if (!data.campus?.geometry) return { spaces: [], error: 'Campus boundary unavailable.' };
    const sources = [
      ...(data.buildings?.features || []).map((f) => [f, 'buildings']),
      ...(data.parking?.features || []).map((f) => [f, 'parking']),
      ...(data.canopy?.features || []).map((f) => [f, 'canopy']),
    ];
    if (!sources.length) return { spaces: [], error: 'No building or parking layer loaded.' };

    const excl = [];
    for (let i = 0; i < sources.length; i += 1) {
      if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
      const [f, kind] = sources[i];
      const name = f.properties?.LONGNAME || f.properties?.SHORTNAME || '';
      const r = kind === 'parking' ? opts.parkingBufferM : kind === 'buildings' ? (ATHLETIC_RE.test(name) ? opts.athleticBufferM : opts.buildingBufferM) : 0;
      try {
        const b = r > 0 ? buffer(f, r, { units: 'meters' }) : f;
        if (b?.geometry) excl.push(b);
      } catch { /* a malformed footprint is skipped rather than guessed */ }
      if (i % 25 === 24) await tick();
    }
    if (!excl.length) return { spaces: [], error: 'No usable exclusion geometry.' };

    // Union in chunks (keeps boolean ops small and fast), then difference from the campus polygon.
    let merged;
    try {
      const chunks = [];
      for (let i = 0; i < excl.length; i += 40) {
        const part = excl.slice(i, i + 40);
        chunks.push(part.length === 1 ? part[0] : union(featureCollection(part)));
        await tick();
      }
      const valid = chunks.filter(Boolean);
      merged = valid.length === 1 ? valid[0] : union(featureCollection(valid));
    } catch (error) {
      return { spaces: [], error: `Could not merge exclusion zones (${error?.message || error}).` };
    }
    let free;
    try {
      free = difference(featureCollection([{ type: 'Feature', properties: {}, geometry: data.campus.geometry }, merged]));
    } catch (error) {
      return { spaces: [], error: `Could not compute open space (${error?.message || error}).` };
    }
    if (!free?.geometry) return { spaces: [] };

    const parts = free.geometry.type === 'Polygon' ? [free.geometry.coordinates] : free.geometry.coordinates;
    const buildingPoints = (data.buildings?.features || []).map((f) => ({
      c: centroid(f).geometry.coordinates,
      name: f.properties?.LONGNAME || f.properties?.SHORTNAME || '',
    })).filter((b) => b.name);

    const found = [];
    for (let i = 0; i < parts.length; i += 1) {
      if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
      const poly = polygon(parts[i]);
      const a = area(poly);
      if (a >= opts.minOpenAreaM2) {
        let core = null;
        try { core = buffer(poly, -opts.minOpenWidthM / 2, { units: 'meters' }); } catch { core = null; }
        if (core?.geometry) {
          const perimeterM = length(polygonToLine(poly), { units: 'meters' });
          const compactness = perimeterM > 0 ? Math.min(1, (4 * Math.PI * a) / (perimeterM * perimeterM)) : 0;
          found.push({ poly, a, compactness });
        }
      }
      if (i % 20 === 19) await tick();
    }
    found.sort((x, y) => y.a - x.a);
    const spaces = found.slice(0, opts.maxOpenSpaces).map(({ poly, a, compactness }, idx) => {
      const [lon, lat] = pointOnFeature(poly).geometry.coordinates;
      let near = null; let best = Infinity;
      for (const b of buildingPoints) {
        const dx = (b.c[0] - lon) * Math.cos((lat * Math.PI) / 180);
        const dy = b.c[1] - lat;
        const d = dx * dx + dy * dy;
        if (d < best) { best = d; near = b.name; }
      }
      const objectId = String(idx + 1);
      return {
        id: `openspace-${objectId}`,
        objectId,
        kind: 'openspace',
        demo: isDemo,
        mission: 'plant',
        layerKey: 'openspace',
        lon,
        lat,
        name: sanitizeText(near ? `Open space near ${near}` : `Open space ${objectId}`) || `Open space ${objectId}`,
        geometry: poly.geometry,
        approximate: false,
        missing: [],
        raw: {
          mappedAreaM2: a,
          compactness,
          exclusions: { buildingBufferM: opts.buildingBufferM, parkingBufferM: opts.parkingBufferM, athleticBufferM: opts.athleticBufferM },
          minWidthM: opts.minOpenWidthM,
        },
      };
    });
    return { spaces };
  }

  /**
   * Run the whole campus scan (chunked so the UI stays responsive).
   * Returns unranked candidate lists per mission; ranking happens in rankAll() so weight
   * sliders can re-rank instantly without recomputing geometry.
   */
  async function scanCampus(options = {}, { onProgress, signal } = {}) {
    const opts = { ...DEFAULTS, ...options };
    const started = performance.now();
    const green = [];
    const sites = [];
    const pathFeatures = data.paths?.features || [];
    const siteFeatures = [
      ...(data.parking?.features || []).map((f) => [f, 'parking']),
      ...(data.buildings?.features || []).map((f) => [f, 'buildings']),
    ];
    const total = pathFeatures.length + siteFeatures.length;
    let done = 0;
    let skipped = 0;
    const CHUNK = 12;

    for (let i = 0; i < pathFeatures.length; i += 1) {
      if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
      const c = analyzePath(pathFeatures[i], opts);
      if (c) green.push(c); else skipped += 1;
      done += 1;
      if (done % CHUNK === 0) { onProgress?.({ done, total, phase: 'Walkway canopy overlap' }); await tick(); }
    }
    for (let i = 0; i < siteFeatures.length; i += 1) {
      if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
      const [feature, layerKey] = siteFeatures[i];
      const s = analyzeSite(feature, layerKey, opts);
      if (s) sites.push(s); else skipped += 1;
      done += 1;
      if (done % CHUNK === 0) { onProgress?.({ done, total, phase: 'Parking & roof screening' }); await tick(); }
    }
    onProgress?.({ done: total, total: total + 1, phase: 'Finding unbuilt open space' });
    await tick();
    let plant = [];
    let openSpaceError = null;
    try {
      const open = await findOpenSpaces(opts, { signal });
      plant = open.spaces;
      openSpaceError = open.error || null;
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      openSpaceError = String(error?.message || error);
    }
    onProgress?.({ done: total + 1, total: total + 1, phase: 'Done' });

    const solar = sites.filter((s) => s.raw.mappedAreaM2 >= opts.minSolarAreaM2).map((s) => ({ ...s, mission: 'solar' }));
    const water = sites.filter((s) => s.raw.mappedAreaM2 >= opts.minWaterAreaM2).map((s) => ({ ...s, mission: 'water' }));
    return {
      green,
      solar,
      water,
      plant,
      meta: {
        openSpaceError,
        available,
        options: opts,
        skipped,
        total,
        durationMs: Math.round(performance.now() - started),
        counts: { paths: pathFeatures.length, canopy: canopyIndex.length, sites: siteFeatures.length },
      },
    };
  }

  return { available, analyzePath, analyzeSite, scanCampus };
}

// ---------------------------------------------------------------------------
// Ranking wrappers (instant; used by weight sliders)
// ---------------------------------------------------------------------------

export function rankAll(scan, weights = DEFAULT_WEIGHTS) {
  const result = {};
  for (const mission of ['green', 'solar', 'water', 'plant']) {
    const { ranked, weights: active, droppedTerms } = rankMission(mission, scan[mission], weights[mission]);
    result[mission] = {
      ranked: ranked.map((c) => ({ ...c, confidence: evidenceConfidence(c) })),
      weights: active,
      droppedTerms,
      formula: FORMULAS[mission],
    };
  }
  return result;
}
