import { describe, it, expect } from 'vitest';
import { destination, point } from '@turf/turf';
import { createEngine, validateCollection, rankAll } from '../src/lib/gis.js';
import { buildSiteEvidence } from '../shared/evidence.js';
import { plantingCountArea, DEFAULT_ASSUMPTIONS } from '../shared/scenarios.js';
import { SiteEvidenceSchema, verifyProposal, buildFallbackProposal } from '../shared/proposal.js';

const O = [-82.4118, 28.0587];
const east = (p, m) => destination(point(p), m / 1000, 90, { units: 'kilometers' }).geometry.coordinates;
const north = (p, m) => destination(point(p), m / 1000, 0, { units: 'kilometers' }).geometry.coordinates;
const rectCoords = (sw, w, h) => { const se = east(sw, w); const nw = north(sw, h); const ne = east(nw, w); return [sw, se, ne, nw, sw]; };
const feat = (geometry, props = {}) => ({ type: 'Feature', properties: props, geometry });
const stamp = (features, kind = 'polygon') => validateCollection({ type: 'FeatureCollection', features }, { kind }).collection;

const campus = feat({ type: 'Polygon', coordinates: [rectCoords(O, 300, 300)] }, { CAMPUS: 'Tampa' }); // 90,000 m²
const mid = (dx, dy, w, h) => rectCoords(north(east(O, dx), dy), w, h);

describe('open-space finder (green planting)', () => {
  it('campus minus buffered building matches the hand calculation', async () => {
    const b = stamp([feat({ type: 'Polygon', coordinates: [mid(125, 125, 50, 50)] }, { OBJECTID: 1, LONGNAME: 'Science Hall' })]);
    const eng = createEngine({ campus, buildings: b });
    const scan = await eng.scanCampus({ buildingBufferM: 10, minOpenAreaM2: 500 });
    expect(scan.plant).toHaveLength(1);
    // exclusion ≈ 70 × 70 minus rounded corners (4 − π)·10² ≈ 4,814 m²  → free ≈ 85,186 m²
    expect(scan.plant[0].raw.mappedAreaM2).toBeGreaterThan(85186 * 0.99);
    expect(scan.plant[0].raw.mappedAreaM2).toBeLessThan(85186 * 1.01);
    expect(scan.plant[0].name).toBe('Open space near Science Hall');
    expect(scan.plant[0].kind).toBe('openspace');
    expect(scan.meta.openSpaceError).toBeNull();
  });

  it('keeps a wider berth around stadiums / athletic buildings than ordinary buildings', async () => {
    const mk = (name) => stamp([feat({ type: 'Polygon', coordinates: [mid(125, 125, 50, 50)] }, { OBJECTID: 1, LONGNAME: name })]);
    const run = async (name) => (await createEngine({ campus, buildings: mk(name) }).scanCampus({ buildingBufferM: 10, athleticBufferM: 40 })).plant[0].raw.mappedAreaM2;
    const ordinary = await run('Science Hall');
    const stadium = await run('Corbett Soccer Stadium');
    // 130×130 − (4−π)·40² ≈ 15,526 m² vs 4,814 m² excluded
    expect(ordinary - stadium).toBeGreaterThan(10000);
    expect(ordinary - stadium).toBeLessThan(11500);
  });

  it('excludes parking lots too', async () => {
    const p = stamp([feat({ type: 'Polygon', coordinates: [mid(100, 100, 100, 100)] }, { OBJECTID: 1, LOT_NUMBER: '9' })]);
    const eng = createEngine({ campus, parking: p });
    const scan = await eng.scanCampus({ parkingBufferM: 5 });
    // 110×110 minus corners (4−π)·25 ≈ 12,100 − 21 → free ≈ 77,921
    expect(scan.plant[0].raw.mappedAreaM2).toBeGreaterThan(77921 * 0.99);
    expect(scan.plant[0].raw.mappedAreaM2).toBeLessThan(77921 * 1.01);
  });

  it('drops thin slivers and tiny fragments', async () => {
    const twoParts = feat({
      type: 'MultiPolygon',
      coordinates: [
        [rectCoords(O, 300, 300)],
        [rectCoords(north(east(O, 400), 0), 6, 120)],   // 720 m² but only 6 m wide → sliver
        [rectCoords(north(east(O, 420), 0), 10, 20)],   // 200 m² → too small
      ],
    }, { CAMPUS: 'Tampa' });
    const b = stamp([feat({ type: 'Polygon', coordinates: [mid(1000, 1000, 10, 10)] }, { OBJECTID: 1, LONGNAME: 'Far shed' })]);
    const scan = await createEngine({ campus: twoParts, buildings: b }).scanCampus({ minOpenAreaM2: 500, minOpenWidthM: 10 });
    expect(scan.plant).toHaveLength(1);
    expect(scan.plant[0].raw.mappedAreaM2).toBeGreaterThan(89000);
  });

  it('reports an error instead of inventing space when there is no footprint data', async () => {
    const scan = await createEngine({ campus }).scanCampus({});
    expect(scan.plant).toEqual([]);
    expect(scan.meta.openSpaceError).toMatch(/building or parking/i);
  });

  it('ranks by area and compactness, mission-separate', async () => {
    const b = stamp([feat({ type: 'Polygon', coordinates: [mid(125, 125, 50, 50)] }, { OBJECTID: 1, LONGNAME: 'Hall' })]);
    const scan = await createEngine({ campus, buildings: b }).scanCampus({});
    const r = rankAll(scan);
    expect(r.plant.ranked[0].rank).toBe(1);
    expect(r.plant.formula).toMatch(/plant_screen_score/);
    expect(Object.values(r.plant.weights).reduce((x, y) => x + y, 0)).toBeCloseTo(1);
  });
});

describe('green-planting scenario & evidence', () => {
  it('tree count from area, planted share and spacing', () => {
    // 10,000 m² × 50% = 5,000 m² ; spacing 8 m → 64 m² per tree → 78 trees
    expect(plantingCountArea({ areaM2: 10000, plantableFractionPct: 50, spacingM: 8 })).toEqual({ plantingAreaM2: 5000, proposedTreeCount: 78 });
    expect(() => plantingCountArea({ areaM2: 1, plantableFractionPct: 150, spacingM: 8 })).toThrow(RangeError);
  });

  const candidate = {
    id: 'openspace-3', kind: 'openspace', name: 'Open space near Science Hall', mission: 'plant', lon: -82.41, lat: 28.06,
    raw: { mappedAreaM2: 10000, compactness: 0.62, exclusions: { buildingBufferM: 8, parkingBufferM: 5, athleticBufferM: 40 } },
  };
  const { evidence } = buildSiteEvidence({ candidate, components: ['planting'], assumptions: DEFAULT_ASSUMPTIONS });

  it('builds a valid evidence pack with honest labels', () => {
    expect(SiteEvidenceSchema.safeParse(evidence).success).toBe(true);
    expect(evidence.intervention).toBe('green-planting');
    expect(evidence.mission).toBe('plant');
    expect(evidence.metrics.find((m) => m.id === 'scn.proposed_tree_count').value).toBe(78);
    expect(evidence.metrics.find((m) => m.id === 'scn.proposed_tree_count').status).toBe('model');
    expect(evidence.metrics.find((m) => m.id === 'base.mapped_area_m2').sourceId).toBe('src-openspace');
  });
  it('fallback report verifies and lists arborist + land-use review', () => {
    const p = buildFallbackProposal(evidence);
    expect(verifyProposal(p, evidence).errors).toEqual([]);
    expect(p.reviews_required.join(' ')).toMatch(/arborist/i);
    expect(p.reviews_required.join(' ')).toMatch(/road, pond, athletic field/i);
  });
});
