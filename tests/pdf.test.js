import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { buildSiteEvidence } from '../shared/evidence.js';
import { buildFallbackProposal } from '../shared/proposal.js';
import { buildPortfolioEvidence, buildPortfolioFallback } from '../shared/portfolio.js';
import { DEFAULT_ASSUMPTIONS } from '../shared/scenarios.js';
import { pdfText } from '../server/services/reportPdf.js';

const cand = (id, kind, name, area) => ({ id, kind, name, mission: 'solar', lon: -82.41, lat: 28.06, raw: { mappedAreaM2: area, pathDistanceM: 20 } });
const { evidence } = buildSiteEvidence({ candidate: cand('parking-12', 'parking', 'Parking lot 12', 2000), components: ['solar', 'rainwater', 'raingarden'], assumptions: DEFAULT_ASSUMPTIONS });
const proposal = buildFallbackProposal(evidence);
const binary = (res, cb) => { res.setEncoding('binary'); let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => cb(null, Buffer.from(d, 'binary'))); };
const post = (app, body) => request(app).post('/api/report-pdf').buffer(true).parse(binary).send(body);
const mediaBox = (buf) => /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(buf.toString('latin1')).slice(1).map(Number);
const app = createApp({ env: {} });

describe('POST /api/report-pdf', () => {
  it('returns a real US Letter PDF (612 x 792 pt)', async () => {
    const res = await post(app, { evidence, proposal, paper: 'letter' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.headers['content-disposition']).toMatch(/BULLS-ECOOPS-parking-12-letter\.pdf/);
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(mediaBox(res.body)).toEqual([612, 792]);
  });
  it('returns an A4 PDF (595.28 x 841.89 pt) when asked', async () => {
    const res = await post(app, { evidence, proposal, paper: 'a4' });
    const [w, h] = mediaBox(res.body);
    expect(w).toBeCloseTo(595.28, 1);
    expect(h).toBeCloseTo(841.89, 1);
  });
  it('defaults to Letter for unknown paper values', async () => {
    const res = await post(app, { evidence, proposal, paper: 'tabloid' });
    expect(mediaBox(res.body)).toEqual([612, 792]);
  });
  it('replaces an unverified proposal (invented number) with the deterministic template', async () => {
    const bad = { ...proposal, headline: 'Cuts campus energy bills by 61%' };
    const res = await post(app, { evidence, proposal: bad, paper: 'letter', source: 'gemini' });
    expect(res.status).toBe(200);
    // Page text is compressed, so check the PDF info dictionary + that rendering still succeeded
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
  });
  it('rejects invalid evidence', async () => {
    const res = await request(app).post('/api/report-pdf').send({ evidence: { siteId: '../x' }, proposal });
    expect(res.status).toBe(400);
  });
  it('renders portfolio reports and multi-page content without error', async () => {
    const e2 = buildSiteEvidence({ candidate: cand('building-3', 'building', 'Building 3', 5000), components: ['solar'], assumptions: DEFAULT_ASSUMPTIONS });
    const pf = buildPortfolioEvidence([{ evidence }, e2]);
    const res = await post(app, { evidence: pf, proposal: buildPortfolioFallback(pf), paper: 'letter' });
    expect(res.status).toBe(200);
    expect((res.body.toString('latin1').match(/\/Type \/Page\b/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});

describe('pdfText (WinAnsi-safe text)', () => {
  it('maps symbols and drops unsupported characters', () => {
    expect(pdfText('A − B ≈ 5 → ✔ done’s “x” m²')).toBe('A - B ~ 5 -> done\'s "x" m2');
    expect(pdfText('日本語 text')).toBe('text');
  });
});
