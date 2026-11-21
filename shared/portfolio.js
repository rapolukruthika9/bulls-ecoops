// Multi-site EcoPlan portfolio: combines several per-site evidence packs into ONE evidence
// pack. Totals are summed in code; Gemini only explains them (same verifier, same guardrails).

import { SCENARIO_LABEL, SCREENING_DISCLAIMER } from './sources.js';

export const MAX_PORTFOLIO_SITES = 6;
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const fmt = (v, d = 1) => Number(v).toLocaleString('en-US', { maximumFractionDigits: d });
const r3 = (v) => Math.round(v * 1000) / 1000;

// Per-site metrics worth carrying into the portfolio (keeps the pack under 60 metrics).
const CARRY = [
  'base.mapped_area_m2', 'base.path_length_m', 'base.canopy_pct',
  'scn.usable_area_m2', 'scn.capacity_kwdc', 'scn.pv_ac_annual_kwh', 'scn.capture_m3', 'scn.diverted_volume_m3', 'scn.proposed_tree_count', 'scn.planting_area_m2',
];

/**
 * @param {{ evidence: object }[]} plans  per-site evidence packs (already built from assumptions)
 * @returns {object} SiteEvidence with intervention 'portfolio'
 */
export function buildPortfolioEvidence(plans) {
  if (!plans.length) throw new RangeError('Add at least one site to the portfolio.');
  const sites = plans.slice(0, MAX_PORTFOLIO_SITES);
  const metrics = [];
  const assumptions = {};
  const sourceIds = new Set(['src-method']);
  const totals = { area: 0, capacity: 0, pv: 0, pvSites: 0, capture: 0, trees: 0, solarSites: 0 };

  sites.forEach(({ evidence }, i) => {
    const pref = `s${LETTERS[i]}`;
    evidence.sourceIds.forEach((s) => sourceIds.add(s));
    for (const [k, v] of Object.entries(evidence.assumptions)) assumptions[`${pref}_${k}`.slice(0, 60)] = v;
    const byId = new Map(evidence.metrics.map((m) => [m.id, m]));
    for (const key of CARRY) {
      const m = byId.get(key);
      if (!m) continue;
      metrics.push({
        id: `${pref}.${key.replace('.', '_')}`,
        label: `${evidence.siteName} — ${m.label}`.slice(0, 160),
        value: m.value, unit: m.unit, method: m.method, sourceId: m.sourceId, status: m.status,
      });
    }
    totals.area += byId.get('base.mapped_area_m2')?.value ?? 0;
    const cap = byId.get('scn.capacity_kwdc')?.value;
    if (cap !== undefined) { totals.capacity += cap; totals.solarSites += 1; }
    const pv = byId.get('scn.pv_ac_annual_kwh')?.value;
    if (pv !== undefined) { totals.pv += pv; totals.pvSites += 1; }
    totals.capture += byId.get('scn.capture_m3')?.value ?? 0;
    totals.trees += byId.get('scn.proposed_tree_count')?.value ?? 0;
  });

  const tot = (id, label, value, unit, method, status = 'model') => metrics.push({
    id: `tot.${id}`, label, value: r3(value), unit, method, sourceId: 'src-method', status,
  });
  tot('sites', 'Sites in this portfolio', sites.length, 'sites', 'Count of plans added to EcoPlan');
  if (totals.area) tot('area_m2', 'Total mapped area of selected sites', totals.area, 'm²', 'Sum of site mapped areas (Turf area())', 'measured');
  if (totals.solarSites) tot('capacity_kwdc', `Total assumed solar capacity (${totals.solarSites} site${totals.solarSites > 1 ? 's' : ''}) — ${SCENARIO_LABEL}`, totals.capacity, 'kWdc', 'Sum of per-site usable area × panel density');
  if (totals.pvSites) tot('pv_kwh', `Total PVWatts modelled annual AC output (${totals.pvSites} site${totals.pvSites > 1 ? 's' : ''} with PVWatts)`, totals.pv, 'kWh/yr', 'Sum of per-site PVWatts model estimates');
  if (totals.capture) tot('capture_m3', `Total potential rainwater capture per event — ${SCENARIO_LABEL}`, totals.capture, 'm³', 'Sum of per-site capture estimates (stated rainfall, no routing model)');
  if (totals.trees) tot('trees', `Total proposed trees — ${SCENARIO_LABEL}`, totals.trees, 'trees', 'Sum of per-site planting counts');

  const missions = sites.map((s) => s.evidence.mission);
  const mission = ['solar', 'water', 'plant', 'green'].sort((a, b) => missions.filter((m) => m === b).length - missions.filter((m) => m === a).length)[0];
  return {
    siteId: `portfolio-${sites.length}`,
    siteName: `Campus portfolio (${sites.length} site${sites.length > 1 ? 's' : ''})`,
    mission,
    intervention: 'portfolio',
    metrics,
    sourceIds: [...sourceIds],
    assumptions,
  };
}

/** Deterministic portfolio report skeleton from the totals (no model needed). */
export function buildPortfolioFallback(evidence) {
  const m = new Map(evidence.metrics.map((x) => [x.id, x]));
  const baseline = []; const scenarios = [];
  const claim = (text, ids) => baseline.push({ text, metric_ids: ids, source_ids: [...new Set(ids.map((id) => m.get(id).sourceId))].filter((s) => evidence.sourceIds.includes(s)) });
  const est = (label, id) => scenarios.push({ label: `${label} (${SCENARIO_LABEL})`, value: m.get(id).value, unit: m.get(id).unit, assumption_ids: [], metric_ids: [id] });

  claim(`${fmt(m.get('tot.sites').value, 0)} candidate sites are combined in this portfolio.`, ['tot.sites']);
  if (m.has('tot.area_m2')) claim(`Together they cover ${fmt(m.get('tot.area_m2').value, 0)} m² of mapped surface.`, ['tot.area_m2']);
  if (m.has('tot.capacity_kwdc')) est('Total assumed solar capacity', 'tot.capacity_kwdc');
  if (m.has('tot.pv_kwh')) est('Total PVWatts modelled annual output', 'tot.pv_kwh');
  if (m.has('tot.capture_m3')) est('Total potential rainwater capture per event', 'tot.capture_m3');
  if (m.has('tot.trees')) est('Total proposed trees', 'tot.trees');

  const takeaways = scenarios.slice(0, 3).map((s) => `${s.label.replace(` (${SCENARIO_LABEL})`, '')}: ${fmt(s.value)} ${s.unit}.`);
  return {
    title: `${evidence.siteName} — integrated sustainability screening proposal`,
    headline: scenarios.length
      ? `${fmt(m.get('tot.sites').value, 0)} USF sites screened together: ${scenarios[0].label.replace(` (${SCENARIO_LABEL})`, '').toLowerCase()} of ${fmt(scenarios[0].value)} ${scenarios[0].unit}.`
      : `${fmt(m.get('tot.sites').value, 0)} USF sites screened together.`,
    key_takeaways: takeaways,
    executive_summary: `This portfolio combines several candidate campus sites. All totals are summed in code from public GIS geometry and declared assumptions; every scenario output is a ${SCENARIO_LABEL}, not a measured benefit.`,
    problem_statement: 'Early campus sustainability ideas need a defensible site baseline and visible assumptions before any design work.',
    intervention: 'A set of screened sites for solar shade, rainwater capture and/or green-corridor interventions.',
    baseline_claims: baseline,
    scenario_estimates: scenarios,
    objectives: ['Test the scenario assumptions against field measurements before committing to design.', 'Prioritise sites with the relevant campus professionals.'],
    implementation_steps: ['Review the portfolio with Facilities and a faculty or student-organization sponsor.', 'Collect a measured baseline per site.', 'Sequence sites into a phased concept proposal with cost, maintenance and compliance review.'],
    reviews_required: ['Facilities and campus planning review', 'Structural and electrical interconnection engineering review', 'Stormwater / drainage and soil infiltration assessment', 'Campus arborist and accessibility review'],
    monitoring_plan: [{ metric: 'Per-site baseline and installed performance', method: 'Meter readings and field measurements after install (not available in this prototype)', cadence: 'Monthly' }],
    limitations: [SCREENING_DISCLAIMER, 'No hydrological model, structural review, grid interconnection analysis or shade-hour simulation was performed.', 'Totals are sums of per-site screening estimates.'],
    confidence: 'partial',
  };
}
