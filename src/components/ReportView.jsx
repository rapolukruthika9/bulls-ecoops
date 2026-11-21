import { ALLOWED_URLS, SOURCES, SCENARIO_LABEL, SCREENING_DISCLAIMER } from '../../shared/sources.js';

const fmt = (v) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });

export default function ReportView({ report, evidence, onClose }) {
  const { proposal: p, source, model, warnings = [], generatedAt } = report;
  const metricById = new Map(evidence.metrics.map((m) => [m.id, m]));
  const baseline = evidence.metrics.filter((m) => m.id.startsWith('base.'));
  const assumptions = evidence.metrics.filter((m) => m.status === 'assumption' && m.id.startsWith('asm.'));
  const usedSources = evidence.sourceIds.map((id) => SOURCES[id]).filter(Boolean);
  const unverified = source === 'fallback' && warnings.some((w) => /rejected|failed/i.test(w));

  return (
    <div className="report-overlay" role="dialog" aria-modal="true" aria-label="Proposal report">
      <div className="report-toolbar no-print">
        <button className="secondary-button" onClick={onClose}>← Back to map</button>
        <button className="primary-button" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>
      <article className="report">
        <header>
          <div className="report-eyebrow">BULLS ECOOPS · Independent student prototype · {SCENARIO_LABEL}</div>
          <h1>{p.title}</h1>
          <div className="report-meta">
            Site <b>{evidence.siteId}</b> · {evidence.intervention.replace(/-/g, ' ')} · Generated {new Date(generatedAt || Date.now()).toLocaleString()}
          </div>
        </header>

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
