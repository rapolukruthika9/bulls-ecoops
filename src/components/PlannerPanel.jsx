import { ASSUMPTION_META } from '../../shared/scenarios.js';
import { availableComponents } from '../../shared/evidence.js';

const COMPONENT_LABEL = {
  solar: 'Solar shade canopy / rooftop array',
  rainwater: 'Rainwater harvesting',
  raingarden: 'Rain garden / permeable surface',
  planting: 'Native shade planting',
};

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

const fmt = (v) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });

export default function PlannerPanel({
  candidate, components, onComponents, assumptions, onAssumptions, evidence, evidenceError,
  pv, pvState, onPv, health, proposalState, onGenerate, onClear,
}) {
  if (!candidate) {
    return (
      <div className="empty-state">
        <div className="empty-icon">✎</div>
        <strong>No site selected</strong>
        <span>Run EcoScan, pick a ranked candidate (or click a walkway, parking lot or roof on the map) and choose <b>Add to EcoPlan</b>.</span>
      </div>
    );
  }
  const options = availableComponents(candidate.kind);
  const toggle = (c) => onComponents(components.includes(c) ? components.filter((x) => x !== c) : [...components, c]);
  const scenarioMetrics = (evidence?.metrics || []).filter((m) => m.id.startsWith('scn.'));
  const baselineMetrics = (evidence?.metrics || []).filter((m) => m.id.startsWith('base.'));

  return (
    <div className="planner">
      <div className="site-detail-head">
        <div><span className="selected-type">EcoPlanner</span><strong>{candidate.name}</strong></div>
        <button className="link-button" onClick={onClear}>Clear</button>
      </div>

      <fieldset className="component-set">
        <legend>Scenario components</legend>
        {options.map((c) => (
          <label key={c} className="check-row"><input type="checkbox" checked={components.includes(c)} onChange={() => toggle(c)} />{COMPONENT_LABEL[c]}</label>
        ))}
        {components.includes('solar') && components.some((c) => c === 'rainwater' || c === 'raingarden') && (
          <p className="limit-text">EcoCanopy: rainwater catchment uses the proposed canopy’s usable area.</p>
        )}
      </fieldset>

      {components.map((c) => (
        <fieldset className="assumption-set" key={c}>
          <legend>{COMPONENT_LABEL[c]} — your assumptions</legend>
          {FIELDS[c].map((key) => {
            const [min, max, step] = RANGE[key];
            const meta = ASSUMPTION_META[key];
            return (
              <label className="assumption-row" key={key}>
                <span>{meta.label}{meta.unit ? ` (${meta.unit})` : ''}</span>
                <input type="number" min={min} max={max} step={step}
                  value={assumptions[key] ?? ''} placeholder={key === 'storageCapacityM3' ? 'none' : ''}
                  onChange={(e) => onAssumptions({ [key]: e.target.value === '' ? null : Number(e.target.value) })} />
              </label>
            );
          })}
        </fieldset>
      ))}

      {components.includes('solar') && (
        <div className="pv-box">
          <button className="secondary-button" onClick={onPv} disabled={pvState.status === 'loading' || !health?.pvwatts}>
            {pvState.status === 'loading' ? 'Calling PVWatts…' : 'Get PVWatts annual estimate (optional)'}
          </button>
          {!health?.pvwatts && <span className="limit-text">PVWatts key not configured on the server — showing capacity only (no annual kWh).</span>}
          {pvState.status === 'error' && <span className="warn-text">{pvState.message}</span>}
          {pv && <span className="ok-text">PVWatts model estimate: {fmt(pv.acAnnualKwh)} kWh/yr{pv.cached ? ' (cached sample)' : ''}</span>}
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
            {proposalState.status === 'loading' ? 'Generating proposal…' : health?.gemini ? 'Generate Gemini proposal →' : 'Generate report →'}
          </button>
          {!health?.gemini && health && <span className="limit-text">Gemini key not configured — a deterministic report will be produced from the metrics.</span>}
          {!health && <span className="warn-text">API server not reachable: start it with <code>npm run server</code>. A local deterministic report is still available.</span>}
          {proposalState.status === 'error' && <p className="error-text">{proposalState.message}</p>}
        </div>
      )}
    </div>
  );
}
