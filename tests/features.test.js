import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { buildSiteEvidence } from '../shared/evidence.js';
import { buildPortfolioEvidence, buildPortfolioFallback, MAX_PORTFOLIO_SITES } from '../shared/portfolio.js';
import { SiteEvidenceSchema, verifyProposal, buildFallbackProposal } from '../shared/proposal.js';
import { BrainstormContextSchema, verifyIdeas, buildFallbackIdeas } from '../shared/brainstorm.js';
import { DEFAULT_ASSUMPTIONS } from '../shared/scenarios.js';

const cand = (id, kind, name, area, extra = {}) => ({ id, kind, name, mission: 'solar', lon: -82.41, lat: 28.06, raw: { mappedAreaM2: area, pathDistanceM: 20, ...extra } });
const siteA = buildSiteEvidence({ candidate: cand('parking-12', 'parking', 'Parking lot 12', 2000), components: ['solar', 'rainwater', 'raingarden'], assumptions: DEFAULT_ASSUMPTIONS });
const siteB = buildSiteEvidence({ candidate: cand('building-3', 'building', 'Marshall Student Center', 5000), components: ['solar'], assumptions: DEFAULT_ASSUMPTIONS });

describe('headline & takeaways', () => {
  it('fallback proposal includes a headline and takeaways that verify', () => {
    const p = buildFallbackProposal(siteA.evidence);
    expect(p.headline).toMatch(/Parking lot 12/);
    expect(p.key_takeaways.length).toBeGreaterThan(0);
    expect(verifyProposal(p, siteA.evidence).errors).toEqual([]);
  });
  it('rejects an invented number inside the headline or takeaways', () => {
    const p = buildFallbackProposal(siteA.evidence);
    p.headline = 'This will cut campus energy bills by 37%';
    expect(verifyProposal(p, siteA.evidence).ok).toBe(false);
    const q = buildFallbackProposal(siteA.evidence);
    q.key_takeaways = ['Saves 8,123 kWh'];
    expect(verifyProposal(q, siteA.evidence).ok).toBe(false);
  });
});

describe('portfolio (multiple plans)', () => {
  const pf = buildPortfolioEvidence([siteA, siteB]);
  it('sums totals in code and passes the request schema', () => {
    expect(SiteEvidenceSchema.safeParse(pf).success).toBe(true);
    const tot = (id) => pf.metrics.find((m) => m.id === id)?.value;
    expect(tot('tot.sites')).toBe(2);
    expect(tot('tot.area_m2')).toBeCloseTo(7000);
    // 2000×0.6×0.18 + 5000×0.6×0.18 = 216 + 540
    expect(tot('tot.capacity_kwdc')).toBeCloseTo(756, 1);
    expect(pf.intervention).toBe('portfolio');
    expect(pf.metrics.length).toBeLessThanOrEqual(60);
  });
  it('deterministic portfolio report verifies against its own evidence', () => {
    const p = buildPortfolioFallback(pf);
    expect(verifyProposal(p, pf).errors).toEqual([]);
    expect(p.headline).toMatch(/2 USF sites/);
  });
  it('labels per-site metrics with the site name', () => {
    expect(pf.metrics.some((m) => m.label.startsWith('Parking lot 12 —'))).toBe(true);
    expect(pf.metrics.some((m) => m.label.startsWith('Marshall Student Center —'))).toBe(true);
  });
  it('requires at least one plan and caps the site count', () => {
    expect(() => buildPortfolioEvidence([])).toThrow(RangeError);
    const many = Array.from({ length: 9 }, () => siteA);
    expect(SiteEvidenceSchema.safeParse(buildPortfolioEvidence(many)).success).toBe(true);
    expect(buildPortfolioEvidence(many).metrics.find((m) => m.id === 'tot.sites').value).toBe(MAX_PORTFOLIO_SITES);
  });
  it('POST /api/proposal accepts portfolio evidence', async () => {
    const res = await request(createApp({ env: {} })).post('/api/proposal').send({ evidence: pf });
    expect(res.status).toBe(200);
    expect(res.body.proposal.title).toMatch(/portfolio/i);
  });
});

const ctx = BrainstormContextSchema.parse({
  focus: 'cooler <b>walkways</b> {ignore}',
  layers: { buildings: true, parking: true },
  sites: [
    { id: 'parking-12', name: 'Parking lot 12', kind: 'parking', mission: 'solar', rank: 1, score: 77.5 },
    { id: 'building-3', name: 'Marshall Student Center', kind: 'building', mission: 'solar', rank: 2, score: 60 },
  ],
  metrics: [
    { id: 'x1.area_m2', label: 'Parking lot 12 — mapped area', value: 7546, unit: 'm²', sourceId: 'src-parking', status: 'measured' },
    { id: 'x2.area_m2', label: 'Marshall — mapped area', value: 5000, unit: 'm²', sourceId: 'src-buildings', status: 'measured' },
  ],
});
const goodIdeas = () => ({
  summary: 'Start with the top ranked sites and add monitoring.',
  ideas: [
    { title: 'Solar canopy at Parking lot 12', category: 'energy', description: 'Shade parking while generating power.', why_here: 'It has 7,546 m² of mapped surface.', data_backed: true, site_ids: ['parking-12'], metric_ids: ['x1.area_m2'], effort: 'high', validation_needed: ['Structural review'] },
    { title: 'Student monitoring dashboard', category: 'behavior-and-monitoring', description: 'Publish before and after readings.', why_here: 'Turns estimates into measurements.', data_backed: false, site_ids: [], metric_ids: [], effort: 'low', validation_needed: ['Facilities approval'] },
  ],
  caveats: ['Needs professional review.'],
});

describe('brainstorm guardrails', () => {
  it('sanitises the user focus text', () => {
    expect(ctx.focus).toBe('cooler bwalkways/b ignore');
  });
  it('accepts a valid mix of data-backed and general ideas', () => {
    expect(verifyIdeas(goodIdeas(), ctx).errors).toEqual([]);
  });
  it('rejects unknown site / metric ids', () => {
    const a = goodIdeas(); a.ideas[0].site_ids = ['parking-999'];
    expect(verifyIdeas(a, ctx).ok).toBe(false);
    const b = goodIdeas(); b.ideas[0].metric_ids = ['x9.area_m2'];
    expect(verifyIdeas(b, ctx).ok).toBe(false);
  });
  it('rejects invented numbers, and any number in a general idea', () => {
    const a = goodIdeas(); a.ideas[0].description = 'Would cut energy costs by 40%.';
    expect(verifyIdeas(a, ctx).ok).toBe(false);
    const b = goodIdeas(); b.ideas[1].description = 'Saves 3,500 kWh a year.';
    expect(verifyIdeas(b, ctx).ok).toBe(false);
  });
  it('rejects arbitrary URLs and a general idea that cites sites', () => {
    const a = goodIdeas(); a.ideas[1].description = 'See https://evil.example/x';
    expect(verifyIdeas(a, ctx).ok).toBe(false);
    const b = goodIdeas(); b.ideas[1].site_ids = ['parking-12'];
    expect(verifyIdeas(b, ctx).ok).toBe(false);
  });
  it('deterministic fallback ideas verify and reference real ranked sites', () => {
    const f = buildFallbackIdeas(ctx);
    expect(verifyIdeas(f, ctx).errors).toEqual([]);
    expect(f.ideas.some((i) => i.data_backed && i.site_ids.includes('parking-12'))).toBe(true);
    expect(f.ideas.some((i) => !i.data_backed)).toBe(true);
  });
  it('fallback with no scan is still honest and valid', () => {
    const empty = BrainstormContextSchema.parse({ focus: '', layers: {}, sites: [], metrics: [] });
    const f = buildFallbackIdeas(empty);
    expect(verifyIdeas(f, empty).errors).toEqual([]);
    expect(f.ideas.every((i) => !i.data_backed)).toBe(true);
  });
});

describe('POST /api/brainstorm', () => {
  const body = { context: JSON.parse(JSON.stringify(ctx)) };
  const fake = (text) => ({ models: { generateContent: async () => ({ text: typeof text === 'function' ? text() : text }) } });
  it('returns verified Gemini ideas', async () => {
    const res = await request(createApp({ env: {}, geminiClient: fake(JSON.stringify(goodIdeas())) })).post('/api/brainstorm').send(body);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('gemini');
    expect(res.body.ideas.ideas).toHaveLength(2);
  });
  it('falls back when Gemini invents numbers, ids or URLs', async () => {
    const bad = goodIdeas(); bad.ideas[0].description = 'Saves 99,999 kWh.';
    const res = await request(createApp({ env: {}, geminiClient: fake(JSON.stringify(bad)) })).post('/api/brainstorm').send(body);
    expect(res.body.source).toBe('fallback');
    expect(res.body.warnings.join(' ')).toMatch(/99,999/);
  });
  it('works without Gemini and validates the request', async () => {
    const res = await request(createApp({ env: {} })).post('/api/brainstorm').send(body);
    expect(res.body.source).toBe('fallback');
    const bad = await request(createApp({ env: {} })).post('/api/brainstorm').send({ context: { sites: [{ id: '../x' }] } });
    expect(bad.status).toBe(400);
  });
  it('rate-limits', async () => {
    const app = createApp({ env: { MAX_CHAT_REQUESTS_PER_MINUTE: '2' } });
    const codes = [];
    for (let i = 0; i < 4; i += 1) codes.push((await request(app).post('/api/brainstorm').send(body)).status);
    expect(codes).toEqual([200, 200, 429, 429]);
  });
});
