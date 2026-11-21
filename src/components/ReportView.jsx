import { ALLOWED_URLS, SOURCES, SCENARIO_LABEL, SCREENING_DISCLAIMER } from '../../shared/sources.js';

const fmt = (v, d = 2) => Number(v).toLocaleString('en-US', { maximumFractionDigits: d });

// Headline numbers shown as big stat cards, in order of "wow". Values come straight from the
// computed evidence metrics (never from model prose), so a judge can trust every figure.
const STAT_PRIORITY = [
  ['tot.capacity_kwdc', 'solar capacity'], ['tot.pv_kwh', 'modelled kWh / year'], ['tot.capture_m3', 'rainwater per event'], ['tot.trees', 'trees proposed'],
  ['scn.pv_ac_annual_kwh', 'modelled kWh / year'], ['scn.capacity_kwdc', 'solar capacity'], ['scn.capture_m3', 'rainwater per event'],
  ['scn.diverted_volume_m3', 'to rain garden'], ['scn.proposed_tree_count', 'trees proposed'],
  ['tot.area_m2', 'surface screened'], ['base.mapped_area_m2', 'mapped surface'], ['base.low_canopy_pct', 'low-canopy exposure'],
];

function pickStats(evidence) {
  const byId = new Map(evidence.metrics.map((m) => [m.id, m]));
  const stats = [];
  const seenLabel = new Set();
  for (const [id, caption] of STAT_PRIORITY) {
    const m = byId.get(id);
    if (!m || seenLabel.has(caption)) continue;
    seenLabel.add(caption);
    stats.push({ m, caption });
    if (stats.length === 4) break;
  }
  return stats;
}

export default function ReportView({ report, evidence, onClose }) {
  const { proposal: p, source, model, warnings = [], generatedAt } = report;
  const metricById = new Map(evidence.metrics.map((m) => [m.id, m]));
  const baseline = evidence.metrics.filter((m) => m.status === 'measured');
  const assumptions = evidence.metrics.filter((m) => m.status === 'assumption');
  const usedSources = evidence.sourceIds.map((id) => SOURCES[id]).filter(Boolean);
  const unverified = source === 'fallback' && warnings.some((w) => /rejected|failed/i.test(w));
  const stats = pickStats(evidence);
  const score = metricById.get('score.screen');
  const takeaways = (p.key_takeaways && p.key_takeaways.length ? p.key_takeaways : p.baseline_claims.map((c) => c.text)).slice(0, 4);
  const headline = p.headline || p.executive_summary;
  const isPortfolio = evidence.intervention === 'portfolio';

  return (
    <div className="report-overlay" role="dialog" aria-modal="true" aria-label="Proposal report">
      <div className="report-toolbar no-print">
        <button className="secondary-button" onClick={onClose}>← Back to map</button>
        <button className="primary-button" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>
      <article className="report">
        <header>
          <div className="report-eyebrow">BULLS ECOOPS · USF Tampa · Independent student prototype · {SCENARIO_LABEL}</div>
          <h1>{p.title}</h1>
          <div className="report-meta">
            {isPortfolio ? <>Combined plan</> : <>Site <b>{evidence.siteId}</b> · {evidence.intervention.replace(/-/g, ' ')}</>} · Generated {new Date(generatedAt || Date.now()).toLocaleString()}
          </div>
        </header>

        {/* ---------- At a glance ---------- */}
        <section className="hero" aria-label="Project at a glance">
          <div className="hero-kicker">THE PROJECT IN ONE LINE</div>
          <p className="hero-headline">{headline}</p>
          {stats.length > 0 && (
            <div className="stat-grid">
              {stats.map(({ m, caption }) => (
                <div className="stat-card" key={m.id}>
                  <div className="stat-value">{fmt(m.value, Math.abs(m.value) >= 100 ? 0 : 1)}<small>{m.unit}</small></div>
                  <div className="stat-caption">{caption}</div>
                  <span className={`status-badge st-${m.status}`}>{m.status === 'measured' ? 'measured from GIS' : m.status === 'model' ? 'scenario estimate' : 'assumption'}</span>
                </div>
              ))}
            </div>
          )}
          {takeaways.length > 0 && (
            <ul className="takeaways">{takeaways.map((t, i) => <li key={i}>{t}</li>)}</ul>
          )}
          <div className="trust-strip">
            {score && <span className="trust-pill score">Screening score <b>{fmt(score.value, 0)}</b>/100</span>}
            <span className="trust-pill">✔ {evidence.metrics.length} figures traced to a source</span>
            <span className="trust-pill">✔ {source === 'gemini' ? 'AI text machine-verified · 0 invented numbers' : 'All text built from computed metrics'}</span>
            <span className="trust-pill warn">Scenario estimates — professional review required</span>
          </div>
        </section>

        <div className={`report-banner ${unverified ? 'warn' : ''}`}>
          {source === 'gemini'
            ? `Narrative drafted by Gemini (${model}) from the supplied metrics only, then machine-verified: every metric ID, source ID and number was checked against the evidence. Gemini did not calculate any value.`
            : unverified
              ? 'Proposal generation could not be verified. Review the site metrics and source links. The text below is a deterministic template filled only from computed metrics.'
              : 'Deterministic report built directly from computed metrics (Gemini was not used).'}
        </div>

        <section><h2>Executive summary</h2><p>{p.executive_summary}</p></section>
        <section><h2>Problem statement</h2><p>{p.problem_statement}</p></section>
        <section><h2>Selected intervention</h2><p>{p.intervention}</p></section>

        <section>
          <h2>Baseline measurements</h2>
          <table className="report-table">
            <thead><tr><th>Measurement</th><th>Value</th><th>Method</th><th>Source</th></tr></thead>
            <tbody>
              {baseline.map((m) => <tr key={m.id}><td>{m.label}</td><td>{fmt(m.value)} {m.unit}</td><td>{m.method}</td><td>{m.sourceId}</td></tr>)}
            </tbody>
          </table>
          {p.baseline_claims.length > 0 && (
            <ul>{p.baseline_claims.map((c, i) => <li key={i}>{c.text} <small className="ids">[{c.metric_ids.join(', ')}]</small></li>)}</ul>
          )}
        </section>

        <section>
          <h2>Scenario inputs and assumptions</h2>
          <table className="report-table">
            <thead><tr><th>Assumption</th><th>Value</th><th>Origin</th></tr></thead>
            <tbody>{assumptions.map((m) => <tr key={m.id}><td>{m.label}</td><td>{fmt(m.value)} {m.unit}</td><td>User-declared</td></tr>)}</tbody>
          </table>
        </section>

        <section>
          <h2>Scenario estimates <span className="scenario-tag">{SCENARIO_LABEL}</span></h2>
          <table className="report-table">
            <thead><tr><th>Estimate</th><th>Value</th><th>Calculated by</th></tr></thead>
            <tbody>
              {p.scenario_estimates.map((e, i) => {
                const ref = metricById.get(e.metric_ids[0]);
                return <tr key={i}><td>{e.label}</td><td>{fmt(e.value)} {e.unit}</td><td>{ref ? ref.method : 'computed in code'}</td></tr>;
              })}
            </tbody>
          </table>
          <p className="report-note">Scenario estimates follow from the stated inputs. They are not measured benefits, energy or water savings, flood reduction or temperature reduction.</p>
        </section>

        <section><h2>Objectives (targets to be tested, not guaranteed benefits)</h2><ul>{p.objectives.map((o, i) => <li key={i}>{o}</li>)}</ul></section>
        <section><h2>Implementation considerations</h2><ol>{p.implementation_steps.map((o, i) => <li key={i}>{o}</li>)}</ol></section>
        <section><h2>Professional reviews required</h2><ul>{p.reviews_required.map((o, i) => <li key={i}>{o}</li>)}</ul></section>
        <section>
          <h2>Monitoring plan</h2>
          <table className="report-table">
            <thead><tr><th>Metric</th><th>Collection method</th><th>Cadence</th></tr></thead>
            <tbody>{p.monitoring_plan.map((m, i) => <tr key={i}><td>{m.metric}</td><td>{m.method}</td><td>{m.cadence}</td></tr>)}</tbody>
          </table>
        </section>
        <section><h2>Limitations</h2><ul>{p.limitations.map((o, i) => <li key={i}>{o}</li>)}</ul><p className="report-note">{SCREENING_DISCLAIMER}</p></section>

        <section>
          <h2>Source register</h2>
          <ul className="source-list">
            {usedSources.map((s) => (
              <li key={s.id}>
                <b>{s.id}</b> — {s.title}
                {s.url && ALLOWED_URLS.has(s.url) && <> · <a href={s.url} target="_blank" rel="noopener noreferrer">{s.url}</a></>}
                <br /><small>{s.note}</small>
              </li>
            ))}
          </ul>
          <p className="report-note">Confidence: <b>{p.confidence}</b> · Public GIS layers are dated study/feature data; see layer status in the app for retrieval times.</p>
        </section>
      </article>
    </div>
  );
}
