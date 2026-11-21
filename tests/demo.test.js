import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { area, bbox, booleanIntersects, booleanPointInPolygon, point } from '@turf/turf';
import { generateDemoCampus, DEMO_COUNTS } from '../src/lib/demoData.js';
import { createEngine, validateCollection, rankAll } from '../src/lib/gis.js';
import { rankMission } from '../shared/scoring.js';
import { buildSiteEvidence } from '../shared/evidence.js';
import { buildFallbackProposal, verifyProposal, SiteEvidenceSchema } from '../shared/proposal.js';
import { DEFAULT_ASSUMPTIONS } from '../shared/scenarios.js';
import { createApp } from '../server/app.js';

const demo = generateDemoCampus();
const q = (a, p) => a.slice().sort((x, y) => x - y)[Math.floor(p * (a.length - 1))];
const stamp = (c) => validateCollection(c, { kind: 'polygon' }).collection;

describe('synthetic demo campus', () => {
  it('matches the live layer counts and is clearly flagged synthetic', () => {
    expect(demo.buildings.features).toHaveLength(DEMO_COUNTS.buildings);
    expect(demo.parking.features).toHaveLength(DEMO_COUNTS.parking);
    expect(demo.meta.synthetic).toBe(true);
    expect([...demo.buildings.features, ...demo.parking.features].every((f) => f.properties.DEMO === true)).toBe(true);
    // generic names only — never real building names
    expect(demo.buildings.features.every((f) => /^Demo /.test(f.properties.LONGNAME))).toBe(true);
    expect(demo.parking.features.every((f) => /^Demo lot \d+$/.test(f.properties.LOT_ID))).toBe(true);
    expect(demo.campus.properties.CAMPUS).toMatch(/DEMO/);
  });
  it('is deterministic', () => {
    expect(JSON.stringify(generateDemoCampus())).toBe(JSON.stringify(demo));
  });
  it('has a campus-scale boundary, footprints inside it, and no overlaps', () => {
    const km2 = area(demo.campus) / 1e6;
    expect(km2).toBeGreaterThan(5); expect(km2).toBeLessThan(9);
    const all = [...demo.buildings.features, ...demo.parking.features];
    for (const f of all) for (const [lon, lat] of f.geometry.coordinates[0]) expect(booleanPointInPolygon(point([lon, lat]), demo.campus)).toBe(true);
    const boxes = all.map((f) => bbox(f));
    let overlaps = 0;
    for (let i = 0; i < all.length; i += 1) for (let j = i + 1; j < all.length; j += 1) {
      const a = boxes[i]; const b = boxes[j];
      if (a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]) continue;
      if (booleanIntersects(all[i], all[j])) overlaps += 1;
    }
    expect(overlaps).toBe(0);
  });
  it('has plausible, varied surface areas (documented assumptions, not measurements)', () => {
    const b = demo.buildings.features.map((f) => area(f)); const p = demo.parking.features.map((f) => area(f));
    expect(q(b, 0.5)).toBeGreaterThan(600); expect(q(b, 0.5)).toBeLessThan(1400);
    expect(q(p, 0.5)).toBeGreaterThan(2000); expect(q(p, 0.5)).toBeLessThan(4500);
    expect(Math.max(...p) / Math.min(...p)).toBeGreaterThan(15); // wide spread → varied priority colours
  });
});

describe('priority colours on demo data', () => {
  const engine = createEngine({ campus: demo.campus, buildings: stamp(demo.buildings), parking: stamp(demo.parking) }, { paths: false, greenspace: false }, { demo: true });
  it('spreads scores across several colour bands (blue → red)', async () => {
    const scan = await engine.scanCampus({});
    const r = rankAll(scan);
    const scores = r.solar.ranked.map((c) => c.score);
    expect(Math.max(...scores) - Math.min(...scores)).toBeGreaterThan(40);
    const bands = new Set(scores.map((s) => Math.min(3, Math.floor(s / 25))));
    expect(bands.size).toBeGreaterThanOrEqual(3);
    expect(scan.solar.every((c) => c.demo === true)).toBe(true);
    expect(scan.plant.length).toBeGreaterThan(0);
  });
  it('weights really re-rank when two factors have data (area vs load proximity)', async () => {
    const scan = await engine.scanCampus({});
    const areaOnly = rankMission('solar', scan.solar, { area: 1, walk: 0, load: 0 }).ranked[0].id;
    const loadOnly = rankMission('solar', scan.solar, { area: 0, walk: 0, load: 1 }).ranked[0].id;
    expect(areaOnly).not.toBe(loadOnly);
    // load-only: roofs are 0 m from "a building" so they lead; area-only: the biggest surface leads
    expect(loadOnly.startsWith('building-')).toBe(true);
  });
  it('with a single factor, weights cannot change the order (so the UI locks the sliders)', () => {
    const items = [
      { id: 'a', raw: { usableAreaM2: 100, pathDistanceM: null, loadDistanceM: null } },
      { id: 'b', raw: { usableAreaM2: 300, pathDistanceM: null, loadDistanceM: null } },
      { id: 'c', raw: { usableAreaM2: 200, pathDistanceM: null, loadDistanceM: null } },
    ];
    const one = rankMission('solar', items, { area: 1, walk: 0, load: 0 });
    const two = rankMission('solar', items, { area: 0.1, walk: 0.5, load: 0.4 });
    expect(Object.keys(one.weights)).toEqual(['area']);
    expect(one.ranked.map((x) => x.id)).toEqual(two.ranked.map((x) => x.id));
    expect(two.weights.area).toBe(1);
    expect(one.droppedTerms.sort()).toEqual(['load', 'walk']);
  });
});

describe('demo labelling carries through evidence, reports and the PDF', () => {
  it('evidence never cites real USF sources for synthetic geometry', async () => {
    const engine = createEngine({ campus: demo.campus, buildings: stamp(demo.buildings), parking: stamp(demo.parking) }, { paths: false, greenspace: false }, { demo: true });
    const scan = await engine.scanCampus({});
    const c = rankAll(scan).solar.ranked.find((x) => x.kind === 'parking');
    const { evidence } = buildSiteEvidence({ candidate: c, components: ['solar', 'rainwater'], assumptions: DEFAULT_ASSUMPTIONS });
    expect(evidence.demo).toBe(true);
    expect(evidence.sourceIds).toContain('src-demo');
    expect(evidence.sourceIds).not.toContain('src-parking');
    expect(evidence.sourceIds).not.toContain('src-buildings');
    expect(SiteEvidenceSchema.safeParse(evidence).success).toBe(true);
    const p = buildFallbackProposal(evidence);
    expect(p.title).toMatch(/^DEMO - /);
    expect(p.executive_summary).toMatch(/^DEMO DATA/);
    expect(p.limitations.join(' ')).toMatch(/synthetic DEMO geometry/);
    expect(verifyProposal(p, evidence).errors).toEqual([]);

    const res = await request(createApp({ env: {} })).post('/api/report-pdf').buffer(true)
      .parse((r, cb) => { r.setEncoding('binary'); let d = ''; r.on('data', (x) => { d += x; }); r.on('end', () => cb(null, Buffer.from(d, 'binary'))); })
      .send({ evidence, proposal: p, paper: 'a4' });
    expect(res.status).toBe(200);
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
