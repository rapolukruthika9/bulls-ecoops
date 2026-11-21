import { MISSION_TERMS, DEFAULT_WEIGHTS } from '../../shared/scoring.js';
import { SOURCES } from '../../shared/sources.js';

export const MISSIONS = {
  green: { label: 'Green corridor', short: 'Green', blurb: 'Walkways with the lowest mapped canopy overlap', unit: 'low-canopy exposure' },
  solar: { label: 'Solar shade canopy', short: 'Parking & solar', blurb: 'Parking lots and roofs ranked by mapped area (walkway adjacency when that layer is available)', unit: 'solar screening' },
  water: { label: 'Water-smart site', short: 'Water', blurb: 'Roof and paved catchments ranked by catchment / paved area (green-space adjacency when available)', unit: 'water screening' },
};

const fmt = (v, d = 1) => (Number.isFinite(v) ? Number(v).toLocaleString('en-US', { maximumFractionDigits: d }) : '—');

function keyMetric(c) {
  if (c.kind === 'path') return `${fmt(c.raw.pathLengthM, 0)} m · ${fmt(c.raw.canopyPct)}% canopy`;
  return `${fmt(c.raw.mappedAreaM2, 0)} m²${Number.isFinite(c.raw.pathDistanceM) ? ` · ${fmt(c.raw.pathDistanceM, 0)} m to path` : ''}`;
}

function SourceBadge({ id }) {
  const s = SOURCES[id];
  return <span className="source-badge" title={s?.title}>{id.replace('src-', '')}</span>;
}

export function SiteDetail({ candidate, formula, onAddToPlan, onFly, inPlan }) {
  if (!candidate) return null;
  const r = candidate.raw;
  const rows = candidate.kind === 'path'
    ? [['Path length', `${fmt(r.pathLengthM)} m`, 'src-paths'], [`Buffer area (${r.bufferM} m)`, `${fmt(r.bufferAreaM2, 0)} m²`, 'src-paths'],
      ['Canopy overlap', `${fmt(r.canopyOverlapM2, 0)} m²`, 'src-canopy'], ['Canopy coverage', `${fmt(r.canopyPct)}%`, 'src-canopy'],
      ['Low-canopy exposure proxy', `${fmt(r.lowCanopyPct)}%`, 'src-canopy']]
    : [[candidate.kind === 'building' ? 'Footprint (roof proxy)' : 'Mapped parking area', `${fmt(r.mappedAreaM2, 0)} m²`, candidate.kind === 'building' ? 'src-buildings' : 'src-parking'],
      ['Usable area (default assumption)', `${fmt(r.usableAreaM2, 0)} m² @ ${r.usableFractionPct}%`, 'src-assumption'],
      ['Distance to nearest path', Number.isFinite(r.pathDistanceM) ? `${fmt(r.pathDistanceM)} m` : 'Unavailable', 'src-paths'],
      ['Distance to green space', Number.isFinite(r.greenDistanceM) ? `${fmt(r.greenDistanceM)} m` : 'Unavailable', 'src-green']];
  return (
    <div className="site-detail" aria-live="polite">
      <div className="site-detail-head">
        <div>
          <span className="selected-type">{candidate.kind === 'path' ? 'WALKWAY' : candidate.kind === 'parking' ? 'PARKING LOT' : 'BUILDING'} · {candidate.id}</span>
          <strong>{candidate.name}</strong>
        </div>
        {candidate.score !== undefined && <div className="score-chip" title="Screening score (relative rank within this mission)">{candidate.score.toFixed(0)}<small>#{candidate.rank}</small></div>}
      </div>
      <div className="attribute-list">
        {rows.map(([k, v, src]) => (
          <div className="attribute-row" key={k}><span>{k} <SourceBadge id={src} /></span><strong>{v}</strong></div>
        ))}
      </div>
      {candidate.score !== undefined && (
        <details className="formula-box" open>
          <summary>How this score is computed</summary>
          <code>{formula}</code>
          <div className="parts">
            {Object.entries(candidate.scoreParts).map(([k, v]) => <span key={k}>{k}: {v.toFixed(2)}</span>)}
          </div>
        </details>
      )}
      {candidate.approximate && <p className="warn-text">Canopy overlap is approximate (could not dissolve overlapping polygons).</p>}
      {candidate.missing?.length > 0 && <p className="warn-text">Missing data: {candidate.missing.join(', ')}. Related terms are not scored.</p>}
      <p className="limit-text">Screening candidate — engineering review required. Geodesic WGS84 metrics, not surveyed.</p>
      <div className="button-row">
        <button className="primary-button" onClick={onAddToPlan} disabled={inPlan}>{inPlan ? '✓ In EcoPlan' : 'Add to EcoPlan →'}</button>
        <button className="secondary-button" onClick={onFly}>Zoom to site</button>
      </div>
    </div>
  );
}

export default function ScanPanel({
  mission, scan, ranked, weights, onWeights, onResetWeights, onAnalyze, canAnalyze, blockers,
  selectedId, onSelect, selectedCandidate, onAddToPlan, onFly, settings, onSettings, inPlan,
}) {
  const terms = MISSION_TERMS[mission];
  const mr = ranked?.[mission];
  const list = mr?.ranked || [];
  return (
    <div className="scan-panel">
      <div className="mission-header">
        <strong>{MISSIONS[mission].label}</strong>
        <span>{MISSIONS[mission].blurb}</span>
      </div>

      <div className="settings-grid">
        {mission === 'green' && (
          <label>Corridor buffer (m)
            <input type="number" min="2" max="50" step="1" value={settings.bufferM} onChange={(e) => onSettings({ bufferM: Math.min(50, Math.max(2, Number(e.target.value) || 10)) })} />
          </label>
        )}
        {mission !== 'green' && (
          <label>Usable fraction (%)
            <input type="number" min="5" max="100" step="5" value={settings.usableFractionPct} onChange={(e) => onSettings({ usableFractionPct: Math.min(100, Math.max(5, Number(e.target.value) || 60)) })} />
          </label>
        )}
      </div>

      <button className="primary-button analyze" disabled={!canAnalyze || scan.status === 'running'} onClick={onAnalyze}>
        {scan.status === 'running' ? `Analyzing… ${Math.round((scan.progress?.done / Math.max(1, scan.progress?.total)) * 100)}%` : scan.status === 'done' ? '↻ RE-ANALYZE CAMPUS' : 'ANALYZE CAMPUS'}
      </button>
      {scan.status === 'running' && (
        <div className="health-track" role="progressbar" aria-valuenow={scan.progress?.done} aria-valuemax={scan.progress?.total}>
          <span style={{ width: `${(scan.progress?.done / Math.max(1, scan.progress?.total)) * 100}%` }} />
        </div>
      )}
      {!canAnalyze && blockers.length > 0 && <p className="warn-text">Waiting for: {blockers.join(', ')}.</p>}
      {scan.status === 'error' && <p className="error-text">{scan.error}</p>}
      {scan.status === 'done' && (
        <p className="limit-text">
          Scanned {scan.result.meta.total.toLocaleString()} features in {(scan.result.meta.durationMs / 1000).toFixed(1)} s
          {scan.result.meta.skipped ? ` · ${scan.result.meta.skipped} skipped (degenerate geometry)` : ''}.
        </p>
      )}

      {scan.status === 'done' && (
        <>
          <div className="weights">
            <div className="section-title">SCORING WEIGHTS (adjustable · product choice, not scientific)</div>
            {terms.map((t) => {
              const active = mr?.weights?.[t.key];
              const dropped = mr?.droppedTerms?.includes(t.key);
              return (
                <label className="weight-row" key={t.key}>
                  <span>{t.label}{dropped ? ' (no data)' : ''}</span>
                  <input type="range" min="0" max="1" step="0.05" value={weights[mission][t.key]} disabled={dropped}
                    onChange={(e) => onWeights(mission, { ...weights[mission], [t.key]: Number(e.target.value) })} />
                  <b>{Number.isFinite(active) ? `${Math.round(active * 100)}%` : '—'}</b>
                </label>
              );
            })}
            <button className="link-button" onClick={onResetWeights}>Reset to {Object.values(DEFAULT_WEIGHTS[mission]).map((v) => Math.round(v * 100)).join(' / ')}</button>
            <code className="formula-line">{mr?.formula}</code>
          </div>

          <div className="section-title">RANKED CANDIDATES · {list.length}</div>
          {list.length === 0 ? (
            <div className="empty-state"><strong>No candidates</strong><span>No candidate met these filters. Lower the threshold or check the data layers.</span></div>
          ) : (
            <ol className="ranked-list">
              {list.slice(0, 40).map((c) => (
                <li key={c.id}>
                  <button className={`ranked-item ${c.id === selectedId ? 'selected' : ''}`} onClick={() => onSelect(c.id)} aria-pressed={c.id === selectedId}>
                    <span className="rank-num">{c.rank}</span>
                    <span className="rank-main"><strong>{c.name}</strong><small>{keyMetric(c)}</small></span>
                    <span className="rank-score">{c.score.toFixed(0)}</span>
                    <span className={`conf conf-${c.confidence.level}`} title={c.confidence.reason}>{c.confidence.level}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
          <p className="limit-text">Scores rank candidates within this mission only; a solar 82 is not comparable to a green 82. Evidence confidence reflects source completeness, not environmental outcome.</p>
        </>
      )}

      {selectedCandidate && <SiteDetail candidate={selectedCandidate} formula={mr?.formula} onAddToPlan={onAddToPlan} onFly={onFly} inPlan={inPlan} />}
    </div>
  );
}
