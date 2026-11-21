// Server-side PDF report (US Letter or A4). A real PDF with a fixed layout, so the result never
// depends on how a particular browser's print dialog scales the page.

import PDFDocument from 'pdfkit';
import { SOURCES, ALLOWED_URLS, SCENARIO_LABEL, SCREENING_DISCLAIMER } from '../../shared/sources.js';
import { pickStats, statBadge } from '../../shared/reportStats.js';

const C = { forest: '#0b2f26', green: '#006747', ink: '#1f2937', gray: '#55665a', line: '#d7e0d7', paper: '#f4f7f2', gold: '#cfc493', amber: '#8a4b07', amberBg: '#fff4e0', white: '#ffffff' };
const fmt = (v, d = 2) => Number(v).toLocaleString('en-US', { maximumFractionDigits: d });

// The built-in PDF fonts are WinAnsi only; map common symbols and drop anything else.
const MAP = { '−': '-', '≈': '~', '→': '->', '←': '<-', '≥': '>=', '≤': '<=', '✔': '', '✓': '', '₂': '2', '₃': '3', '’': "'", '‘': "'", '“': '"', '”': '"', '…': '...', ' ': ' ', 'π': 'pi', '×': 'x', '÷': '/', '·': '-', '²': '2', '³': '3', '°': ' deg', 'Σ': 'sum' };
export function pdfText(value) {
  return String(value ?? '')
    .replace(/[−≈→←≥≤✔✓₂₃’‘“”… π×÷·²³°Σ]/g, (ch) => MAP[ch] ?? '')
    .replace(/[^\x20-\x7E–—•]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
// Units keep their superscripts readable in plain ASCII.
const unit = (u) => pdfText(String(u ?? '').replace(/m²/g, 'm2').replace(/m³/g, 'm3').replace(/°/g, 'deg'));

export const PAPERS = { letter: { size: 'LETTER', label: 'US Letter (8.5 x 11 in)' }, a4: { size: 'A4', label: 'A4 (210 x 297 mm)' } };

/**
 * @param {{proposal:object, evidence:object, source?:string, model?:string|null, generatedAt?:string, verifyNote?:string|null}} report
 * @param {'letter'|'a4'} paper
 * @returns {Promise<Buffer>}
 */
export function renderReportPdf(report, paper = 'letter') {
  const { proposal: p, evidence, source = 'fallback', model = null, generatedAt = new Date().toISOString(), verifyNote = null } = report;
  const spec = PAPERS[paper] || PAPERS.letter;
  const isPortfolio = evidence.intervention === 'portfolio';
  const byId = new Map(evidence.metrics.map((m) => [m.id, m]));

  const doc = new PDFDocument({
    size: spec.size, margins: { top: 50, bottom: 56, left: 46, right: 46 }, bufferPages: true,
    info: { Title: pdfText(p.title), Author: 'BULLS ECOOPS (independent student prototype)', Subject: 'Campus sustainability screening proposal - SCENARIO ESTIMATES' },
  });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });

  const L = doc.page.margins.left;
  const W = doc.page.width - L - doc.page.margins.right;
  const bottomLimit = () => doc.page.height - doc.page.margins.bottom;
  const need = (h) => { if (doc.y + h > bottomLimit()) doc.addPage(); };
  const text = (s, opts = {}) => doc.text(pdfText(s), L, doc.y, { width: W, lineGap: 2, ...opts });

  const heading = (label) => {
    need(46);
    doc.moveDown(0.7);
    doc.font('Helvetica-Bold').fontSize(12).fillColor(C.green).text(pdfText(label), L, doc.y, { width: W });
    doc.moveDown(0.25);
    doc.font('Helvetica').fontSize(9.5).fillColor(C.ink);
  };
  const para = (s) => { need(30); doc.font('Helvetica').fontSize(9.5).fillColor(C.ink); text(s); };
  const bullets = (items) => {
    doc.font('Helvetica').fontSize(9.5).fillColor(C.ink);
    for (const it of items) {
      const h = doc.heightOfString(pdfText(it), { width: W - 16, lineGap: 2 });
      need(h + 4);
      const y = doc.y;
      doc.text('•', L + 2, y, { width: 10 });
      doc.text(pdfText(it), L + 16, y, { width: W - 16, lineGap: 2 });
      doc.moveDown(0.15);
    }
  };
  const note = (s) => { need(24); doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(C.gray); text(s); doc.font('Helvetica').fillColor(C.ink); };

  const table = (cols, rows) => {
    const widths = cols.map((c) => c.w * W);
    const drawHeader = () => {
      need(30);
      const y = doc.y;
      doc.rect(L, y, W, 18).fill(C.forest);
      let x = L;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.white);
      cols.forEach((c, i) => { doc.text(pdfText(c.label), x + 4, y + 5, { width: widths[i] - 8, lineBreak: false }); x += widths[i]; });
      doc.y = y + 20;
      doc.font('Helvetica').fontSize(8.5).fillColor(C.ink);
    };
    drawHeader();
    rows.forEach((row, ri) => {
      doc.font('Helvetica').fontSize(8.5);
      const hs = row.map((cell, i) => doc.heightOfString(pdfText(cell), { width: widths[i] - 8, lineGap: 1 }));
      const h = Math.max(...hs) + 8;
      if (doc.y + h > bottomLimit()) { doc.addPage(); drawHeader(); }
      const y = doc.y;
      if (ri % 2 === 1) doc.rect(L, y, W, h).fill(C.paper);
      doc.fillColor(C.ink);
      let x = L;
      row.forEach((cell, i) => { doc.text(pdfText(cell), x + 4, y + 4, { width: widths[i] - 8, lineGap: 1 }); x += widths[i]; });
      doc.moveTo(L, y + h).lineTo(L + W, y + h).lineWidth(0.4).strokeColor(C.line).stroke();
      doc.y = y + h;
    });
    doc.moveDown(0.4);
  };

  // ---------------- header ----------------
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.green)
    .text(`BULLS ECOOPS  -  USF TAMPA  -  INDEPENDENT STUDENT PROTOTYPE  -  ${SCENARIO_LABEL}`, L, doc.y, { width: W });
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').fontSize(19).fillColor(C.forest).text(pdfText(p.title), L, doc.y, { width: W, lineGap: 2 });
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(8.5).fillColor(C.gray).text(
    pdfText(`${isPortfolio ? 'Combined plan' : `Site ${evidence.siteId} - ${evidence.intervention.replace(/-/g, ' ')}`}  -  Generated ${new Date(generatedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC  -  ${spec.label}`),
    L, doc.y, { width: W },
  );
  doc.moveDown(0.6);

  // ---------------- hero (at a glance) ----------------
  const stats = pickStats(evidence);
  const headline = p.headline || p.executive_summary;
  const takeaways = (p.key_takeaways?.length ? p.key_takeaways : p.baseline_claims.map((c) => c.text)).slice(0, 4);
  const score = byId.get('score.screen');
  const trust = [
    score ? `Screening score ${fmt(score.value, 0)}/100` : null,
    `${evidence.metrics.length} figures traced to a source`,
    source === 'gemini' ? 'AI text machine-verified: 0 invented numbers' : 'All text built from computed metrics',
  ].filter(Boolean).join('   |   ');

  const pad = 14;
  doc.font('Helvetica-Bold').fontSize(15);
  const headH = doc.heightOfString(pdfText(headline), { width: W - 2 * pad, lineGap: 2 });
  doc.font('Helvetica').fontSize(9.5);
  const takeH = takeaways.reduce((s, t) => s + doc.heightOfString(pdfText(t), { width: W - 2 * pad - 14, lineGap: 2 }) + 3, 0);
  const statH = stats.length ? 64 : 0;
  const heroH = pad + 11 + 6 + headH + 10 + (statH ? statH + 10 : 0) + takeH + 8 + 14 + pad;
  need(heroH + 6);
  const hy = doc.y;
  doc.roundedRect(L, hy, W, heroH, 8).fill(C.forest);
  let cy = hy + pad;
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.gold).text('THE PROJECT IN ONE LINE', L + pad, cy, { width: W - 2 * pad, characterSpacing: 1.2 });
  cy += 17;
  doc.font('Helvetica-Bold').fontSize(15).fillColor(C.white).text(pdfText(headline), L + pad, cy, { width: W - 2 * pad, lineGap: 2 });
  cy += headH + 10;
  if (stats.length) {
    const gap = 8;
    const cw = (W - 2 * pad - gap * (stats.length - 1)) / stats.length;
    stats.forEach(({ m, caption }, i) => {
      const x = L + pad + i * (cw + gap);
      doc.save().fillOpacity(0.14).roundedRect(x, cy, cw, statH, 6).fill(C.white).restore();
      const val = fmt(m.value, Math.abs(m.value) >= 100 ? 0 : 1);
      doc.font('Helvetica-Bold').fontSize(18).fillColor(C.white).text(val, x + 8, cy + 6, { width: cw - 12, lineBreak: false });
      doc.font('Helvetica').fontSize(7.5).fillColor('#d6e9dc').text(`${unit(m.unit)}  ${pdfText(caption)}`, x + 8, cy + 28, { width: cw - 12, lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(C.gold).text(pdfText(statBadge(m.status)).toUpperCase(), x + 8, cy + 46, { width: cw - 12, lineBreak: false });
    });
    cy += statH + 10;
  }
  doc.font('Helvetica').fontSize(9.5).fillColor(C.white);
  for (const t of takeaways) {
    const h = doc.heightOfString(pdfText(t), { width: W - 2 * pad - 14, lineGap: 2 });
    doc.text('•', L + pad, cy, { width: 10 });
    doc.text(pdfText(t), L + pad + 14, cy, { width: W - 2 * pad - 14, lineGap: 2 });
    cy += h + 3;
  }
  cy += 8;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.gold).text(pdfText(trust), L + pad, cy, { width: W - 2 * pad });
  doc.y = hy + heroH + 10;

  // ---------------- verification banner ----------------
  const banner = source === 'gemini'
    ? `Narrative drafted by Gemini${model ? ` (${pdfText(model).slice(0, 40)})` : ''} from the supplied metrics only, then machine-verified: every metric ID, source ID and number was checked against the evidence. Gemini did not calculate any value.`
    : verifyNote
      ? `${verifyNote} The text below is a deterministic template filled only from computed metrics.`
      : 'Deterministic report built directly from computed metrics (Gemini was not used).';
  {
    doc.font('Helvetica').fontSize(8.5);
    const h = doc.heightOfString(pdfText(banner), { width: W - 18 }) + 12;
    need(h + 4);
    const y = doc.y;
    doc.rect(L, y, W, h).fill(verifyNote && source !== 'gemini' ? C.amberBg : '#e8f0ea');
    doc.rect(L, y, 3, h).fill(verifyNote && source !== 'gemini' ? C.amber : C.green);
    doc.fillColor(C.ink).text(pdfText(banner), L + 12, y + 6, { width: W - 18 });
    doc.y = y + h + 4;
  }

  // ---------------- body ----------------
  heading('Executive summary'); para(p.executive_summary);
  heading('Problem statement'); para(p.problem_statement);
  heading('Selected intervention'); para(p.intervention);

  heading('Baseline measurements');
  table(
    [{ label: 'Measurement', w: 0.3 }, { label: 'Value', w: 0.17 }, { label: 'Method', w: 0.37 }, { label: 'Source', w: 0.16 }],
    evidence.metrics.filter((m) => m.status === 'measured').map((m) => [m.label, `${fmt(m.value)} ${unit(m.unit)}`, m.method, m.sourceId]),
  );
  if (p.baseline_claims.length) bullets(p.baseline_claims.map((c) => `${c.text} [${c.metric_ids.join(', ')}]`));

  const asm = evidence.metrics.filter((m) => m.status === 'assumption');
  if (asm.length) {
    heading('Scenario inputs and assumptions');
    table([{ label: 'Assumption', w: 0.55 }, { label: 'Value', w: 0.25 }, { label: 'Origin', w: 0.2 }], asm.map((m) => [m.label, `${fmt(m.value)} ${unit(m.unit)}`, m.id.startsWith('score.weight') ? 'Adjustable weight' : 'User-declared']));
  }

  heading(`Scenario estimates  (${SCENARIO_LABEL})`);
  table(
    [{ label: 'Estimate', w: 0.38 }, { label: 'Value', w: 0.2 }, { label: 'Calculated by', w: 0.42 }],
    p.scenario_estimates.map((e) => [e.label, `${fmt(e.value)} ${unit(e.unit)}`, byId.get(e.metric_ids[0])?.method || 'computed in code']),
  );
  note('Scenario estimates follow from the stated inputs. They are not measured benefits, energy or water savings, flood reduction or temperature reduction.');

  heading('Objectives (targets to be tested, not guaranteed benefits)'); bullets(p.objectives);
  heading('Implementation considerations'); bullets(p.implementation_steps);
  heading('Professional reviews required'); bullets(p.reviews_required);
  heading('Monitoring plan');
  table([{ label: 'Metric', w: 0.3 }, { label: 'Collection method', w: 0.5 }, { label: 'Cadence', w: 0.2 }], p.monitoring_plan.map((m) => [m.metric, m.method, m.cadence]));
  heading('Limitations'); bullets(p.limitations); note(SCREENING_DISCLAIMER);

  heading('Source register');
  for (const id of evidence.sourceIds) {
    const s = SOURCES[id];
    if (!s) continue;
    const line = `${s.id} - ${s.title}${s.url && ALLOWED_URLS.has(s.url) ? `  ${s.url}` : ''}`;
    need(doc.heightOfString(pdfText(line), { width: W }) + 14);
    doc.font('Helvetica').fontSize(8).fillColor(C.ink).text(pdfText(line), L, doc.y, { width: W, lineGap: 1 });
    doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(C.gray).text(pdfText(s.note), L, doc.y, { width: W });
    doc.moveDown(0.3);
  }
  note(`Confidence: ${p.confidence}. Public GIS layers are dated study/feature data.`);

  // ---------------- footer on every page ----------------
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    const prev = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // stop pdfkit adding a blank page when writing in the margin
    const y = doc.page.height - 34;
    doc.moveTo(L, y - 6).lineTo(L + W, y - 6).lineWidth(0.4).strokeColor(C.line).stroke();
    doc.font('Helvetica').fontSize(7).fillColor(C.gray)
      .text(`BULLS ECOOPS - independent student prototype, not an official USF recommendation - ${SCENARIO_LABEL}S`, L, y, { width: W - 70, lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, L + W - 66, y, { width: 66, align: 'right', lineBreak: false });
    doc.page.margins.bottom = prev;
  }
  doc.end();
  return done;
}
