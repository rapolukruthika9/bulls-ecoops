import { describe, it, expect } from 'vitest';
import { area, destination, point } from '@turf/turf';
import { createEngine, validateCollection, rankAll, DEFAULTS } from '../src/lib/gis.js';

const ORIGIN = [-82.4118, 28.0587];
const east = (from, m) => destination(point(from), m / 1000, 90, { units: 'kilometers' }).geometry.coordinates;
const north = (from, m) => destination(point(from), m / 1000, 0, { units: 'kilometers' }).geometry.coordinates;

const feat = (geometry, props = {}) => ({ type: 'Feature', properties: props, geometry });
const fc = (features) => ({ type: 'FeatureCollection', features });
const rect = (sw, wM, hM) => {
  const se = east(sw, wM); const nw = north(sw, hM); const ne = east(nw, wM);
  return { type: 'Polygon', coordinates: [[sw, se, ne, nw, sw]] };
};
const stamp = (features) => validateCollection(fc(features), { kind: features[0]?.geometry?.type?.includes('Line') ? 'line' : 'polygon' }).collection;

// A 100 m east–west path starting at ORIGIN.
const pathEnd = east(ORIGIN, 100);
const pathFeature = feat({ type: 'LineString', coordinates: [ORIGIN, pathEnd] }, { OBJECTID: 7, NAME: 'Test Walk' });
const paths = stamp([pathFeature]);

// Generous canopy rectangles (200 m × 200 m) positioned relative to the path.
const bigSW = (dx, dy) => north(east(ORIGIN, dx), dy);

describe('validateCollection', () => {
  it('drops null/invalid/duplicate geometry and counts every issue', () => {
    const { collection, issues } = validateCollection(fc([
      feat(null, { OBJECTID: 1 }),
      feat({ type: 'Point', coordinates: [0, 0] }, { OBJECTID: 2 }),
      feat({ type: 'LineString', coordinates: [[200, 0], [201, 1]] }, { OBJECTID: 3 }),
      feat({ type: 'LineString', coordinates: [ORIGIN, pathEnd] }, { OBJECTID: 4 }),
      feat({ type: 'LineString', coordinates: [ORIGIN, pathEnd] }, { OBJECTID: 4 }),
    ]), { kind: 'line' });
    expect(collection.features).toHaveLength(1);
    expect(issues).toMatchObject({ total: 5, nullGeometry: 1, wrongType: 1, badCoordinates: 1, duplicates: 1 });
    expect(collection.features[0].properties.__oid).toBe('4');
  });
});

describe('green corridor analysis', () => {
  it('matches the hand-computed buffer area and length', () => {
    const engine = createEngine({ paths, canopy: fc([]) });
    const c = engine.analyzePath(paths.features[0], { bufferM: 10 });
    expect(c.raw.pathLengthM).toBeCloseTo(100, 0);
    // 100 m × 20 m rectangle + 10 m-radius round ends ≈ 2000 + π·10² = 2314 m²
    expect(c.raw.bufferAreaM2).toBeGreaterThan(2314 * 0.99);
    expect(c.raw.bufferAreaM2).toBeLessThan(2314 * 1.01);
    expect(c.id).toBe('path-7');
    expect(c.name).toBe('Test Walk');
  });

  it('handles empty intersection: 0% canopy, 100% exposure proxy', () => {
    const farCanopy = stamp([feat(rect(bigSW(0, 500), 200, 200), { OBJECTID: 1 })]);
    const c = createEngine({ paths, canopy: farCanopy }).analyzePath(paths.features[0]);
    expect(c.raw.canopyOverlapM2).toBe(0);
    expect(c.raw.canopyPct).toBe(0);
    expect(c.raw.lowCanopyPct).toBe(100);
  });

  it('full canopy cover → 100%; half cover → ≈50%', () => {
    const full = stamp([feat(rect(bigSW(-50, -50), 300, 300), { OBJECTID: 1 })]);
    expect(createEngine({ paths, canopy: full }).analyzePath(paths.features[0]).raw.canopyPct).toBeCloseTo(100, 1);

    // Canopy covers everything east of the path midpoint → half of the symmetric buffer.
    const half = stamp([feat(rect(bigSW(50, -100), 300, 300), { OBJECTID: 1 })]);
    const c = createEngine({ paths, canopy: half }).analyzePath(paths.features[0]);
    expect(c.raw.canopyPct).toBeGreaterThan(49);
    expect(c.raw.canopyPct).toBeLessThan(51);
    expect(c.raw.canopyPct + c.raw.lowCanopyPct).toBeCloseTo(100, 6);
  });

  it('does not double count overlapping canopy polygons (dissolves before summing)', () => {
    const a = feat(rect(bigSW(-50, -50), 300, 300), { OBJECTID: 1 });
    const b = feat(rect(bigSW(-20, -20), 250, 250), { OBJECTID: 2 }); // overlaps a entirely over the buffer
    const c = createEngine({ paths, canopy: stamp([a, b]) }).analyzePath(paths.features[0]);
    expect(c.raw.canopyPct).toBeCloseTo(100, 1);
    expect(c.raw.canopyOverlapM2).toBeLessThanOrEqual(c.raw.bufferAreaM2);
    expect(c.approximate).toBe(false);
  });

  it('handles multipart path features and skips zero-length paths', () => {
    const multi = feat({ type: 'MultiLineString', coordinates: [[ORIGIN, pathEnd], [north(ORIGIN, 50), north(pathEnd, 50)]] }, { OBJECTID: 9 });
    const zero = feat({ type: 'LineString', coordinates: [ORIGIN, ORIGIN] }, { OBJECTID: 10 });
    const eng = createEngine({ paths: stamp([multi]), canopy: fc([]) });
    expect(eng.analyzePath(stamp([multi]).features[0]).raw.pathLengthM).toBeCloseTo(200, 0);
    expect(eng.analyzePath(stamp([zero]).features[0])).toBeNull();
  });
});

describe('solar / water site screening', () => {
  const lot = feat(rect(north(ORIGIN, 40), 60, 40), { OBJECTID: 12, LOT_NUMBER: '12' }); // 2,400 m² lot 40 m north of path
  const roof = feat(rect(north(east(ORIGIN, 200), 90), 20, 10), { OBJECTID: 3, LONGNAME: 'Tiny Shed' }); // 200 m²
  const park = stamp([lot]);
  const bldg = stamp([roof]);
  const green = stamp([feat(rect(north(ORIGIN, 85), 100, 30), { OBJECTID: 1 })]);

  it('measures mapped area, path distance and green adjacency from geometry', () => {
    const engine = createEngine({ paths, parking: park, buildings: bldg, greenspace: green, canopy: fc([]) });
    const s = engine.analyzeSite(park.features[0], 'parking');
    expect(s.raw.mappedAreaM2).toBeGreaterThan(2350);
    expect(s.raw.mappedAreaM2).toBeLessThan(2450);
    expect(s.raw.usableAreaM2).toBeCloseTo(s.raw.mappedAreaM2 * 0.6, 6);
    // lot centroid is 40 + 20 = 60 m north of the path
    expect(s.raw.pathDistanceM).toBeGreaterThan(57);
    expect(s.raw.pathDistanceM).toBeLessThan(63);
    // green space starts 85 m north; lot centroid at 60 m → ≈25 m
    expect(s.raw.greenDistanceM).toBeGreaterThan(22);
    expect(s.raw.greenDistanceM).toBeLessThan(28);
    expect(s.name).toBe('Parking lot 12');
    expect(s.raw.pavedAreaM2).toBe(s.raw.mappedAreaM2);
    expect(s.raw.catchmentAreaM2).toBe(0);
  });

  it('reports missing layers instead of inventing proximity', () => {
    const engine = createEngine({ parking: park, canopy: fc([]) });
    const s = engine.analyzeSite(park.features[0], 'parking');
    expect(s.raw.pathDistanceM).toBeNull();
    expect(s.raw.greenDistanceM).toBeNull();
    expect(s.missing).toEqual(['paths layer', 'green-space layer']);
  });

  it('scanCampus applies area thresholds and ranking stays mission-separate', async () => {
    const engine = createEngine({ paths, parking: park, buildings: bldg, greenspace: green, canopy: fc([]) });
    const scan = await engine.scanCampus({ minSolarAreaM2: 500, minWaterAreaM2: 100 });
    expect(scan.green).toHaveLength(1);
    expect(scan.solar.map((s) => s.id)).toEqual(['parking-12']); // 200 m² shed is below the solar threshold…
    expect(scan.water.map((s) => s.id).sort()).toEqual(['building-3', 'parking-12']); // …but above the water one
    expect(scan.solar[0].mission).toBe('solar');
    expect(scan.water[0].mission).toBe('water');
    expect(DEFAULTS.minSolarAreaM2).toBe(150);
  });

  it('ranks all three missions with transparent weights', async () => {
    const engine = createEngine({ paths, parking: park, buildings: bldg, greenspace: green, canopy: fc([]) });
    const scan = await engine.scanCampus({ minSolarAreaM2: 100 });
    const ranked = rankAll(scan);
    expect(ranked.green.ranked[0].rank).toBe(1);
    expect(ranked.solar.ranked[0].id).toBe('parking-12'); // larger area wins at default 60% area weight
    expect(Object.values(ranked.water.weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(ranked.solar.formula).toMatch(/solar_screen_score/);
  });
});

describe('sanity', () => {
  it('rect helper builds the expected 60 × 40 m polygon', () => {
    expect(area({ type: 'Feature', properties: {}, geometry: rect(ORIGIN, 60, 40) })).toBeGreaterThan(2350);
  });
});
