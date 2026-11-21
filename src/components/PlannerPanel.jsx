import { ASSUMPTION_META } from '../../shared/scenarios.js';
import { availableComponents } from '../../shared/evidence.js';
import { MAX_PORTFOLIO_SITES } from '../../shared/portfolio.js';

const COMPONENT_LABEL = {
  solar: 'Solar shade canopy / rooftop array',
  rainwater: 'Rainwater harvesting',
  raingarden: 'Rain garden / permeable surface',
  planting: 'Native shade planting',
};
const COMPONENT_SHORT = { solar: 'Solar', rainwater: 'Rainwater', raingarden: 'Rain garden', planting: 'Planting' };

const FIELDS = {
  solar: ['usableFractionPct', 'panelDensityKwdcPerM2', 'pvTiltDeg', 'pvAzimuthDeg', 'pvLossesPct'],
  rainwater: ['rainfallMm', 'runoffCoefficient', 'collectionEfficiency', 'storageCapacityM3'],
  raingarden: ['treatmentFraction', 'diversionFraction'],
  planting: ['plantingSpacingM', 'plantingSides'],
};
const RANGE = {
  usableFractionPct: [0, 100, 5], panelDensityKwdcPerM2: [0.05, 0.3, 0.01], pvTiltDeg: [0, 60, 1], pvAzimuthDeg: [0, 359, 5],
  pvLossesPct: [0, 50, 1], rainfallMm: [0, 500, 1], runoffCoefficient: [0, 1, 0.05], collectionEfficiency: [0, 1, 0.05],
  storageCapacityM3: [0, 100000, 1], treatmentFraction: [0, 1, 0.05], diversionFraction: [0, 1, 0.05],
  plantingSpacingM: [1, 30, 0.5], plantingSides: [1, 2, 1],
};
const KIND_LABEL = { path: 'Walkway', parking: 'Parking lot', building: 'Building' };

const fmt = (v) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });

function PlanCard({ plan, active, onActivate, onRemove, error }) {
  return (
    <li className={`plan-card ${active ? 'active' : ''}`}>
      <button className="plan-card-main" onClick={onActivate} aria-pressed={active}>
        <span className="plan-kind">{KIND_LABEL[plan.candidate.kind]}</span>
        <strong>{plan.candidate.name}</strong>
        <span className="plan-chips">
          {plan.components.length ? plan.components.map((c) => <em key={c}>{COMPONENT_SHORT[c]}</em>) : <em>no components</em>}
          {error && <em className="chip-error">check inputs</em>}
        </span>
      </button>
      <button className="plan-remove" onClick={onRemove} aria-label={`Remove ${plan.candidate.name} from EcoPlan`} title="Remove from EcoPlan">×</button>
    </li>
  );
}

export default function PlannerPanel({
  plans, activeId, onActivate, onRemove, onClearAll, onUpdate, evidenceByPlan, portfolio, onGeneratePortfolio,
  pvState, onPv, health, proposalState, onGenerate,
}) {
  if (!plans.length) {
    return (
      <div className="empty-state">
        <div className="empty-icon">✎</div>
        <strong>No sites in EcoPlan yet</strong>
        <span>Run EcoScan, then click a ranked site or a building/parking lot on the map and press <b>Add to EcoPlan</b> in its pop-up. You can add several sites and generate one combined report.</span>
      </div>
    );
  }
  const plan = plans.find((p) => p.id === activeId) || plans[0];
  const { evidence, error: evidenceError } = evidenceByPlan[plan.id] || {};
  const candidate = plan.candidate;
  const options = availableComponents(candidate.kind);
  const toggle = (c) => onUpdate(plan.id, { components: plan.components.includes(c) ? plan.components.filter((x) => x !== c) : [...plan.components, c] });
  const scenarioMetrics = (evidence?.metrics || []).filter((m) => m.id.startsWith('scn.'));
  const baselineMetrics = (evidence?.metrics || []).filter((m) => m.id.startsWith('base.'));
  const portfolioMetrics = (portfolio?.metrics || []).filter((m) => m.id.startsWith('tot.'));

  return (
    <div className="planner">
      <div className="plan-list-head">
        <div className="section-title">YOUR PLAN · {plans.length} SITE{plans.length > 1 ? 'S' : ''}</div>
        <button className="link-button" onClick={onClearAll}>Clear all</button>
      </div>
      <ul className="plan-list">
        {plans.map((p) => (
          <PlanCard key={p.id} plan={p} active={p.id === plan.id} error={Boolean(evidenceByPlan[p.id]?.error)}
            onActivate={() => onActivate(p.id)} onRemove={() => onRemove(p.id)} />
        ))}
      </ul>
      {plans.length >= MAX_PORTFOLIO_SITES && <p className="limit-text">Portfolio limit reached ({MAX_PORTFOLIO_SITES} sites).</p>}

      {portfolio && plans.length >= 2 && (
        <div className="portfolio-box">
          <div className="scenario-banner">PORTFOLIO TOTALS — SCENARIO ESTIMATE</div>
          <table className="metric-table"><tbody>
            {portfolioMetrics.map((m) => <tr key={m.id}><td>{m.label.replace(' — SCENARIO ESTIMATE', '')}</td><td><b>{fmt(m.value)}</b> {m.unit}</td></tr>)}
          </tbody></table>
          <button className="primary-button" disabled={proposalState.status === 'loading'} onClick={onGeneratePortfolio}>
            {proposalState.status === 'loading' && proposalState.scope === 'portfolio' ? 'Generating…' : `Generate combined report (${plans.length} sites) →`}
          </button>
        </div>
      )}

      <div className="site-detail-head">
        <div><span className="selected-type">EDITING</span><strong>{candidate.name}</strong></div>
      </div>

      <fieldset className="component-set">
        <legend>Scenario components</legend>
        {options.map((c) => (
          <label key={c} className="check-row"><input type="checkbox" checked={plan.components.includes(c)} onChange={() => toggle(c)} />{COMPONENT_LABEL[c]}</label>
        ))}
        {plan.components.includes('solar') && plan.components.some((c) => c === 'rainwater' || c === 'raingarden') && (
          <p className="limit-text">EcoCanopy: rainwater catchment uses the proposed canopy’s usable area.</p>
        )}
      </fieldset>

      {plan.components.map((c) => (
        <fieldset className="assumption-set" key={c}>
          <legend>{COMPONENT_LABEL[c]} — your assumptions</legend>
          {FIELDS[c].map((key) => {
            const [min, max, step] = RANGE[key];
            const meta = ASSUMPTION_META[key];
            return (
              <label className="assumption-row" key={key}>
                <span>{meta.label}{meta.unit ? ` (${meta.unit})` : ''}</span>
                <input type="number" min={min} max={max} step={step}
                  value={plan.assumptions[key] ?? ''} placeholder={key === 'storageCapacityM3' ? 'none' : ''}
                  onChange={(e) => onUpdate(plan.id, { assumptions: { [key]: e.target.value === '' ? null : Number(e.target.value) } })} />
              </label>
            );
          })}
        </fieldset>
      ))}

      {plan.components.includes('solar') && (
        <div className="pv-box">
          <button className="secondary-button" onClick={onPv} disabled={pvState.status === 'loading' || !health?.pvwatts}>
            {pvState.status === 'loading' ? 'Calling PVWatts…' : 'Get PVWatts annual estimate (optional)'}
          </button>
          {!health?.pvwatts && <span className="limit-text">PVWatts key not configured on the server — showing capacity only (no annual kWh).</span>}
          {pvState.status === 'error' && <span className="warn-text">{pvState.message}</span>}
          {plan.pv && <span className="ok-text">PVWatts model estimate: {fmt(plan.pv.acAnnualKwh)} kWh/yr{plan.pv.cached ? ' (cached sample)' : ''}</span>}
        </div>
      )}

      {evidenceError && <p className="error-text">{evidenceError}</p>}

      {evidence && (
        <div className="results">
          <div className="scenario-banner">SCENARIO ESTIMATE — not a measured benefit</div>
          <div className="section-title">BASELINE (measured from GIS geometry)</div>
          <table className="metric-table"><tbody>
            {baselineMetrics.map((m) => <tr key={m.id}><td>{m.label}</td><td><b>{fmt(m.value)}</b> {m.unit}</td><td><span className="source-badge">{m.sourceId.replace('src-', '')}</span></td></tr>)}
          </tbody></table>
          <div className="section-title">SCENARIO OUTPUTS (from your assumptions)</div>
          {scenarioMetrics.length === 0 ? <p className="limit-text">Select a component above.</p> : (
            <table className="metric-table"><tbody>
              {scenarioMetrics.map((m) => (
                <tr key={m.id} title={m.method}><td>{m.label}</td><td><b>{fmt(m.value)}</b> {m.unit}</td><td><span className={`status-badge st-${m.status}`}>{m.status === 'model' ? 'estimate' : m.status}</span></td></tr>
              ))}
            </tbody></table>
          )}
          <p className="limit-text">Hover a row for its formula. Rainwater volumes are scenario estimates, not savings or stormwater reduction; no infiltration or runoff-routing model is run.</p>
          <button className="primary-button" disabled={proposalState.status === 'loading' || scenarioMetrics.length === 0} onClick={onGenerate}>
            {proposalState.status === 'loading' && proposalState.scope !== 'portfolio' ? 'Generating proposal…' : health?.gemini ? 'Generate Gemini proposal →' : 'Generate report →'}
          </button>
          {!health?.gemini && health && <span className="limit-text">Gemini key not configured — a deterministic report will be produced from the metrics.</span>}
          {!health && <span className="warn-text">API server not reachable: start it with <code>npm run server</code>. A local deterministic report is still available.</span>}
          {proposalState.status === 'error' && <p className="error-text">{proposalState.message}</p>}
        </div>
      )}
    </div>
  );
}
