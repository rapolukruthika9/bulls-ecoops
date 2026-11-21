const CATEGORY = {
  energy: { label: 'Energy', icon: '' },
  water: { label: 'Water', icon: '' },
  'green-heat': { label: 'Green & heat', icon: '' },
  'behavior-and-monitoring': { label: 'Monitoring & engagement', icon: '' },
  'policy-and-funding': { label: 'Funding & policy', icon: '' },
  'cross-cutting': { label: 'Multi-benefit', icon: '' },
};
const SUGGESTIONS = ['Make USF a net-zero energy campus', 'Cooler walkways for students', 'Water-smart parking lots', 'Student-funded green projects'];

export default function IdeasPanel({
  focus, onFocus, state, onBrainstorm, hasScan, siteNames, onOpenSite, onAddSite, health, demo,
}) {
  const result = state.result;
  return (
    <div className="ideas-panel">
      <div className="mission-header">
        <strong>EcoIdeas — Gemini brainstorm</strong>
        <span>Gemini studies your scan results and suggests the best ways to make USF more sustainable. Ideas that aren’t backed by scan data are labelled as general ideas.</span>
      </div>

      {demo && <p className="warn-text"><b>DEMO DATA:</b> these ideas are based on synthetic test sites, not real USF buildings or lots.</p>}
      {!hasScan && <p className="warn-text">Tip: run <b>ANALYZE CAMPUS</b> first so ideas can point to specific ranked sites.</p>}

      <label className="focus-field">
        <span>Optional focus</span>
        <input type="text" maxLength={200} value={focus} onChange={(e) => onFocus(e.target.value)} placeholder="e.g. cooler walkways, solar for parking…" />
      </label>
      <div className="chip-row">
        {SUGGESTIONS.map((s) => <button key={s} className="chip-button" onClick={() => onFocus(s)}>{s}</button>)}
      </div>

      <button className="primary-button" disabled={state.status === 'loading'} onClick={onBrainstorm}>
        {state.status === 'loading' ? 'Brainstorming…' : result ? '↻ Brainstorm again' : health?.gemini ? 'Brainstorm with Gemini' : 'Generate ideas'}
      </button>
      {!health?.gemini && <span className="limit-text">Gemini key not configured — showing rule-based ideas from your top-ranked sites.</span>}
      {state.status === 'error' && <p className="error-text">{state.message}</p>}

      {result && (
        <div className="ideas-result">
          <div className={`report-banner ${result.source === 'gemini' ? '' : 'warn'}`}>
            {result.source === 'gemini'
              ? `Ideas drafted by Gemini (${result.model}) and machine-checked: every cited site, metric and number was verified against your scan. Gemini cannot add numbers.`
              : 'Rule-based ideas built directly from your scan results (Gemini was not used or its answer could not be verified).'}
          </div>
          <p className="ideas-summary">{result.ideas.summary}</p>
          <ul className="idea-list">
            {result.ideas.ideas.map((idea, i) => {
              const cat = CATEGORY[idea.category] || CATEGORY['cross-cutting'];
              return (
                <li className="idea-card" key={i}>
                  <div className="idea-head">
                    <span className="idea-cat">{cat.label}</span>
                    <span className={`idea-tag ${idea.data_backed ? 'backed' : 'general'}`}>{idea.data_backed ? 'DATA-BACKED' : 'GENERAL IDEA'}</span>
                  </div>
                  <strong>{idea.title}</strong>
                  <p>{idea.description}</p>
                  <p className="idea-why"><b>Why:</b> {idea.why_here}</p>
                  {idea.site_ids.length > 0 && (
                    <div className="chip-row">
                      {idea.site_ids.map((id) => (
                        <span className="site-chip" key={id}>
                          <button onClick={() => onOpenSite(id)} title="Show on map">{siteNames[id] || id}</button>
                          <button onClick={() => onAddSite(id)} title="Add to EcoPlan" aria-label={`Add ${siteNames[id] || id} to EcoPlan`}>＋ Plan</button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="idea-foot">
                    <span>Effort: <b>{idea.effort}</b></span>
                    {idea.validation_needed.length > 0 && <span>Needs: {idea.validation_needed.join('; ')}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
          {result.ideas.caveats?.length > 0 && <ul className="limit-text">{result.ideas.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}
