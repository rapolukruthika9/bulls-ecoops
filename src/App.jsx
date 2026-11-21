import { useEffect, useMemo, useRef, useState } from 'react';
import MapView from './components/MapView.jsx';
import ScanPanel, { MISSIONS } from './components/ScanPanel.jsx';
import PlannerPanel from './components/PlannerPanel.jsx';
import ReportView from './components/ReportView.jsx';
import { createEngine, rankAll, SITE_PREFIX, DEFAULTS } from './lib/gis.js';
import { getHealth, requestProposal, requestSolarEstimate } from './lib/api.js';
import { DEFAULT_WEIGHTS } from '../shared/scoring.js';
import { DEFAULT_ASSUMPTIONS, solarCapacity } from '../shared/scenarios.js';
import { buildSiteEvidence } from '../shared/evidence.js';
import { buildFallbackProposal } from '../shared/proposal.js';

const LAYERS = [
  { key: 'priority', label: 'Priority surface (scan result)', description: 'Heat-map of screening scores for the active mission', swatch: 'priority' },
  { key: 'campus', label: 'USF Tampa campus boundary', description: 'Official USF campus polygon', swatch: 'campus' },
  { key: 'buildings', label: 'Building footprints', description: 'USF Facilities GIS · layer 1', swatch: 'buildings' },
  { key: 'parking', label: 'Surface parking lots', description: 'USF Parking GIS · layer 1', swatch: 'parking' },
  { key: 'paths', label: 'Sidewalks / footpaths', description: 'USF Community Maps · layer 11', swatch: 'paths' },
  { key: 'greenspace', label: 'Campus green space', description: 'USF Community Maps · layer 18', swatch: 'greenspace' },
  { key: 'canopy', label: 'Existing tree canopy', description: 'Tampa UTC polygons · 2021', swatch: 'canopy' },
  { key: 'planting', label: 'Potential planting zones', description: 'Tampa UTC study layer 10 · 2021', swatch: 'planting' },
  { key: 'heat', label: 'Historical heat zones', description: 'Average land-surface temperature · 2021', swatch: 'heat' },
];

const ALL_OFF = Object.fromEntries(LAYERS.map((l) => [l.key, false]));
const PRESETS = {
  green: { ...ALL_OFF, campus: true, canopy: true, paths: true, greenspace: true, planting: true, priority: true },
  water: { ...ALL_OFF, campus: true, buildings: true, parking: true, greenspace: true, priority: true },
  solar: { ...ALL_OFF, campus: true, buildings: true, parking: true, paths: true, priority: true },
  heat: { ...ALL_OFF, campus: true, heat: true },
};
const CORE_KEYS = ['campus', 'buildings', 'parking', 'canopy', 'paths', 'greenspace'];
const VECTOR_LABEL = Object.fromEntries(LAYERS.map((l) => [l.key, l.label]));

const MISSION_BUTTONS = [
  { key: 'green', icon: '♧', label: 'Green', sub: 'Canopy gaps on walkways' },
  { key: 'water', icon: '◍', label: 'Water', sub: 'Roof & paved catchments' },
  { key: 'solar', icon: '▦', label: 'Parking & solar', sub: 'Lots and roofs' },
  { key: 'heat', icon: '☼', label: 'Heat areas', sub: '2021 surface-temp study' },
];

function StatusDot({ status = 'loading' }) {
  return <span className={`status-dot status-${status}`} title={status} />;
}

function LayerRow({ layer, visible, status, onToggle }) {
  return (
    <label className="layer-row">
      <input type="checkbox" checked={visible} onChange={onToggle} />
      <span className={`layer-swatch swatch-${layer.swatch}`} />
      <span className="layer-label-wrap">
        <span className="layer-label">{layer.label}</span>
        <span className="layer-description">{layer.description}</span>
      </span>
      {status && <StatusDot status={status} />}
    </label>
  );
}

const kindToLayer = { path: 'paths', parking: 'parking', building: 'buildings' };

function defaultComponents(candidate, mission) {
  if (candidate.kind === 'path') return ['planting'];
  if (candidate.kind === 'parking') return mission === 'water' ? ['rainwater', 'raingarden'] : ['solar', 'rainwater', 'raingarden'];
  return mission === 'water' ? ['rainwater'] : ['solar'];
}

export default function App() {
  const [visibility, setVisibility] = useState({ ...PRESETS.solar, canopy: true, paths: true, priority: true });
  const [statuses, setStatuses] = useState(() => ({
    ...Object.fromEntries(CORE_KEYS.map((k) => [k, { status: 'loading', message: 'Waiting for query.' }])),
    planting: { status: 'ready', message: 'USF Water Institute potential-planting layer 10; raster overlay loads on demand.' },
    heat: { status: 'ready', message: 'Tampa 2021 average land-surface-temperature raster; not live air temperature.' },
  }));
  const [mapReady, setMapReady] = useState(false);
  const [controls, setControls] = useState(null);
  const [mapBase, setMapBase] = useState('satellite');
  const [data, setData] = useState(null);
  const [mission, setMission] = useState('solar');
  const [tab, setTab] = useState('scan');
  const [inspected, setInspected] = useState(null);
  const [health, setHealth] = useState(null);

  const [settings, setSettings] = useState({ bufferM: DEFAULTS.bufferM, usableFractionPct: DEFAULTS.usableFractionPct });
  const [scan, setScan] = useState({ status: 'idle', progress: null, result: null, error: null });
  const [weights, setWeights] = useState(() => JSON.parse(JSON.stringify(DEFAULT_WEIGHTS)));
  const [selectedId, setSelectedId] = useState(null);

  const [planCandidate, setPlanCandidate] = useState(null);
  const [components, setComponents] = useState([]);
  const [assumptions, setAssumptions] = useState({ ...DEFAULT_ASSUMPTIONS });
  const [pv, setPv] = useState(null);
  const [pvState, setPvState] = useState({ status: 'idle' });
  const [proposalState, setProposalState] = useState({ status: 'idle' });
  const [report, setReport] = useState(null);
  const scanAbort = useRef(null);

  useEffect(() => { getHealth().then(setHealth).catch(() => setHealth(null)); }, []);

  function updateStatus(key, status, message) {
    setStatuses((prev) => ({ ...prev, [key]: { status, message } }));
  }

  // ---------- engine & scan ----------
  const engine = useMemo(() => {
    if (!data) return null;
    return createEngine({
      paths: data.paths?.collection, canopy: data.canopy?.collection, parking: data.parking?.collection,
      buildings: data.buildings?.collection, greenspace: data.greenspace?.collection,
    });
  }, [data]);

  useEffect(() => { // a reload invalidates old scan results
    scanAbort.current?.abort();
    setScan({ status: 'idle', progress: null, result: null, error: null });
    setSelectedId(null);
  }, [data]);

  const blockers = useMemo(() => {
    const a = engine?.available;
    if (!a) return ['campus GIS layers'];
    const need = [];
    if (mission === 'green') { if (!a.paths) need.push('walkway layer'); if (!a.canopy) need.push('canopy layer'); }
    else if (!a.parking && !a.buildings) need.push('parking/building layers');
    return need;
  }, [engine, mission]);

  async function analyze() {
    if (!engine) return;
    scanAbort.current?.abort();
    const controller = new AbortController();
    scanAbort.current = controller;
    setScan({ status: 'running', progress: { done: 0, total: 1 }, result: null, error: null });
    try {
      const result = await engine.scanCampus(settings, {
        signal: controller.signal,
        onProgress: (progress) => setScan((prev) => (prev.status === 'running' ? { ...prev, progress } : prev)),
      });
      setScan({ status: 'done', progress: null, result, error: null });
      setVisibility((v) => ({ ...v, priority: true }));
    } catch (error) {
      if (error?.name === 'AbortError') return;
      setScan({ status: 'error', progress: null, result: null, error: error?.message || 'Scan failed.' });
    }
  }

  const ranked = useMemo(() => (scan.result ? rankAll(scan.result, weights) : null), [scan.result, weights]);
  const missionRank = ranked?.[mission];

  // Priority surface for the map: heat-map points + exact scored shapes for the active mission.
  const priority = useMemo(() => {
    if (!missionRank) return null;
    const points = []; const shapes = [];
    for (const c of missionRank.ranked) {
      const props = { score: c.score, id: c.id, rank: c.rank, layerKey: c.layerKey, __oid: c.objectId, name: c.name };
      points.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [c.lon, c.lat] } });
      shapes.push({ type: 'Feature', properties: props, geometry: c.geometry });
    }
    return { points: { type: 'FeatureCollection', features: points }, shapes: { type: 'FeatureCollection', features: shapes } };
  }, [missionRank]);

  // ---------- selection ----------
  const selectedCandidate = useMemo(() => {
    if (!selectedId) return null;
    const inRank = missionRank?.ranked.find((c) => c.id === selectedId);
    if (inRank) return inRank;
    if (!engine || !data) return null;
    const [prefix, ...rest] = selectedId.split('-');
    const objectId = rest.join('-');
    const layerKey = Object.keys(SITE_PREFIX).find((k) => SITE_PREFIX[k] === prefix);
    const feature = data[layerKey]?.collection.features.find((f) => f.properties.__oid === objectId);
    if (!feature) return null;
    try {
      const c = layerKey === 'paths' ? engine.analyzePath(feature, { bufferM: settings.bufferM }) : engine.analyzeSite(feature, layerKey, settings);
      return c ? { ...c, mission: layerKey === 'paths' ? 'green' : (mission === 'water' ? 'water' : 'solar') } : null;
    } catch { return null; }
  }, [selectedId, missionRank, engine, data, settings, mission]);

  function onMapSelect(info) {
    setInspected(info);
    if (info && SITE_PREFIX[info.layerKey]) {
      const kind = SITE_PREFIX[info.layerKey];
      setSelectedId(`${kind}-${info.objectId}`);
      if (kind === 'path' && mission !== 'green') setMission('green');
      if (kind !== 'path' && mission === 'green') setMission('solar');
      setTab('scan');
    }
  }

  function switchMission(key) {
    if (key !== 'heat') setMission(key);
    setVisibility(PRESETS[key]);
    if (key !== 'heat') setTab('scan');
    if (key !== 'heat' && selectedCandidate && selectedCandidate.mission !== key) setSelectedId(null);
  }

  // ---------- planner ----------
  function addToPlan() {
    const c = selectedCandidate;
    if (!c) return;
    setPlanCandidate(c);
    setComponents(defaultComponents(c, mission));
    setAssumptions({ ...DEFAULT_ASSUMPTIONS, bufferM: c.raw.bufferM ?? DEFAULT_ASSUMPTIONS.bufferM, usableFractionPct: c.raw.usableFractionPct ?? DEFAULT_ASSUMPTIONS.usableFractionPct });
    setPv(null); setPvState({ status: 'idle' }); setProposalState({ status: 'idle' });
    setTab('plan');
  }

  useEffect(() => { setPv(null); setPvState({ status: 'idle' }); }, [components, assumptions.usableFractionPct, assumptions.panelDensityKwdcPerM2, assumptions.pvTiltDeg, assumptions.pvAzimuthDeg, assumptions.pvLossesPct]);

  const { evidence, evidenceError } = useMemo(() => {
    if (!planCandidate) return { evidence: null, evidenceError: null };
    try {
      const scoreInfo = planCandidate.score !== undefined && ranked?.[planCandidate.mission]
        ? { missionLabel: MISSIONS[planCandidate.mission].short, value: planCandidate.score, weights: ranked[planCandidate.mission].weights, formula: ranked[planCandidate.mission].formula }
        : null;
      const { evidence: ev } = buildSiteEvidence({ candidate: planCandidate, components, assumptions, pv, score: scoreInfo });
      return { evidence: ev, evidenceError: null };
    } catch (error) {
      return { evidence: null, evidenceError: error instanceof RangeError ? `Check your inputs: ${error.message}.` : 'Could not build the evidence pack.' };
    }
  }, [planCandidate, components, assumptions, pv, ranked]);

  async function getPv() {
    try {
      setPvState({ status: 'loading' });
      const { systemCapacityKwdc } = solarCapacity({
        mappedAreaM2: planCandidate.raw.mappedAreaM2, usableFractionPct: assumptions.usableFractionPct, panelDensityKwdcPerM2: assumptions.panelDensityKwdcPerM2,
      });
      const res = await requestSolarEstimate({
        lat: planCandidate.lat, lon: planCandidate.lon, systemCapacityKwdc, moduleType: assumptions.pvModuleType, arrayType: assumptions.pvArrayType,
        tiltDeg: assumptions.pvTiltDeg, azimuthDeg: assumptions.pvAzimuthDeg, lossesPct: assumptions.pvLossesPct,
      });
      if (res.available) { setPv(res); setPvState({ status: 'ready' }); } else setPvState({ status: 'error', message: res.reason });
    } catch (error) {
      setPvState({ status: 'error', message: `${error.message} Capacity-only result retained.` });
    }
  }

  async function generate() {
    if (!evidence) return;
    setProposalState({ status: 'loading' });
    try {
      const res = await requestProposal(evidence);
      setReport({ ...res, evidence });
      setProposalState({ status: 'idle' });
    } catch (error) {
      // API unreachable/rate-limited: the report must still render from deterministic metrics.
      setReport({
        proposal: buildFallbackProposal(evidence), source: 'fallback', model: null, evidence,
        warnings: [`Proposal API unavailable: ${error.message}`], generatedAt: new Date().toISOString(),
      });
      setProposalState({ status: 'idle' });
    }
  }

  // ---------- derived UI ----------
  const readyCount = CORE_KEYS.filter((k) => ['ready', 'cached'].includes(statuses[k]?.status)).length;
  const errorKeys = CORE_KEYS.filter((k) => statuses[k]?.status === 'error');
  const cachedKeys = CORE_KEYS.filter((k) => statuses[k]?.status === 'cached');
  const showLegend = visibility.priority && missionRank;
  const proposedGeometry = tab === 'plan' && planCandidate ? planCandidate.geometry : null;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">BE</div>
          <div>
            <div className="brand-name">BULLS <span>ECOOPS</span></div>
            <div className="brand-subtitle">USF CAMPUS ENVIRONMENTAL INTELLIGENCE</div>
          </div>
        </div>
        <div className="topbar-right">
          <span className="connection-pill"><StatusDot status={health ? 'ready' : 'error'} /> API {health ? `ONLINE · Gemini ${health.gemini ? 'on' : 'off'} · PVWatts ${health.pvwatts ? 'on' : 'off'}` : 'OFFLINE'}</span>
          <span className="connection-pill"><StatusDot status={mapReady ? 'ready' : 'loading'} /> MAP {mapReady ? 'READY' : 'INITIALIZING'}</span>
          <a className="official-link" href="https://maps.usf.edu/" target="_blank" rel="noopener noreferrer">USF Maps Portal ↗</a>
        </div>
      </header>

      <section className="workspace">
        <aside className="left-panel panel">
          <div className="panel-heading">
            <span className="eyebrow">MISSIONS</span>
            <h2>What to look at</h2>
            <p>Pick a lens. Each shows its own layers; Analyze then ranks candidate sites.</p>
          </div>

          <div className="mission-switcher">
            {MISSION_BUTTONS.map((m) => (
              <button key={m.key} className={`mission-button ${(m.key === mission && !visibility.heat) || (m.key === 'heat' && visibility.heat && !visibility.priority) ? 'active' : ''}`} onClick={() => switchMission(m.key)}>
                <span className={`mission-icon ${m.key === 'heat' ? 'heat-icon' : ''}`}>{m.icon}</span>
                <span><strong>{m.label}</strong><small>{m.sub}</small></span>
              </button>
            ))}
          </div>

          <div className="layer-group">
            <div className="layer-group-title">BASEMAP</div>
            <div className="base-toggle">
              <button className={mapBase === 'satellite' ? 'selected' : ''} onClick={() => setMapBase('satellite')}>Satellite</button>
              <button className={mapBase === 'street' ? 'selected' : ''} onClick={() => setMapBase('street')}>Street</button>
            </div>
          </div>

          <div className="layer-group">
            <div className="layer-group-title">LAYERS · TOGGLE INDIVIDUALLY</div>
            {LAYERS.map((layer) => (
              <LayerRow key={layer.key} layer={layer} visible={visibility[layer.key]} status={statuses[layer.key]?.status}
                onToggle={() => setVisibility((prev) => ({ ...prev, [layer.key]: !prev[layer.key] }))} />
            ))}
          </div>

          <div className="panel-footnote">
            <strong>Reading the map</strong>
            <span>The priority surface is a <b>screening ranking</b> computed in code from public GIS geometry (red = higher rank within the active mission). It is not measured temperature, savings or engineering feasibility. Canopy, planting and heat are dated 2021 study layers.</span>
          </div>
        </aside>

        <section className="map-column">
          <div className="map-toolbar">
            <div>
              <span className="eyebrow">CAMPUS ENVIRONMENTAL MAP</span>
              <h1>University of South Florida · Tampa</h1>
              <p className="toolbar-subtitle">{MISSIONS[mission].label} · {scan.status === 'done' ? `${missionRank?.ranked.length ?? 0} ranked candidates` : 'run ANALYZE CAMPUS to rank sites'}</p>
            </div>
            <div className="map-actions">
              <span className="data-count"><b>{readyCount}/{CORE_KEYS.length}</b> sources{cachedKeys.length ? ` · ${cachedKeys.length} cached` : ''}{errorKeys.length ? ` · ${errorKeys.length} errors` : ''}</span>
              <button className="secondary-button" onClick={() => controls?.reload()} title="Reload campus data">↻ Reload</button>
              <button className="secondary-button" onClick={() => controls?.resetView()}>Reset view</button>
            </div>
          </div>

          <div className="map-frame">
            <MapView
              visibility={visibility} mapBase={mapBase} reloadToken={0}
              priority={priority} selectedGeometry={selectedCandidate?.geometry} proposedGeometry={proposedGeometry}
              onStatus={updateStatus} onSelected={onMapSelect} onData={setData}
              onControlsReady={setControls} onMapReady={setMapReady}
            />
            <div className="map-overlay-tag"><span className="live-dot" /> USF TAMPA CAMPUS</div>
            {statuses.campus?.status === 'loading' && <div className="map-loading" role="status">Loading USF campus layers…</div>}
            <div className="map-legend">
              {showLegend && (
                <div className="heat-legend">
                  <b>Priority · {MISSIONS[mission].short}</b>
                  <i className="heat-ramp" />
                  <span><em>lower</em><em>higher rank</em></span>
                </div>
              )}
              {visibility.canopy && <div><i className="legend-dot canopy" />Existing canopy</div>}
              {visibility.greenspace && <div><i className="legend-dot greenspace" />Green space</div>}
              {visibility.planting && <div><i className="legend-dot planting" />Potential planting</div>}
              {visibility.buildings && <div><i className="legend-dot buildings" />Buildings</div>}
              {visibility.parking && <div><i className="legend-dot parking" />Parking</div>}
              {visibility.paths && <div><i className="legend-line" />Walkways</div>}
              {visibility.heat && <div><i className="legend-dot heat" />Historical average LST</div>}
              {proposedGeometry && <div><i className="legend-dash" />PROPOSED site (scenario)</div>}
            </div>
          </div>
          <div className="map-caption">
            <span>Basemap: Esri World Imagery · MapLibre GL JS</span>
            <span>Overlays: USF Facilities / Community Maps + USF Water Institute 2021 · screening metrics, not surveyed</span>
          </div>
        </section>

        <aside className="right-panel panel">
          <div className="tab-bar" role="tablist">
            {[['scan', 'EcoScan'], ['plan', 'EcoPlan'], ['data', 'Data']].map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'selected' : ''} onClick={() => setTab(k)}>{label}</button>
            ))}
          </div>

          {tab === 'scan' && (
            <ScanPanel
              mission={mission} scan={scan} ranked={ranked} weights={weights}
              onWeights={(m, w) => setWeights((prev) => ({ ...prev, [m]: w }))}
              onResetWeights={() => setWeights((prev) => ({ ...prev, [mission]: { ...DEFAULT_WEIGHTS[mission] } }))}
              onAnalyze={analyze} canAnalyze={blockers.length === 0} blockers={blockers}
              selectedId={selectedId} onSelect={(id) => { setSelectedId(id); const c = missionRank?.ranked.find((x) => x.id === id); if (c) controls?.flyToGeometry(c.geometry); }}
              selectedCandidate={selectedCandidate} onAddToPlan={addToPlan} onFly={() => controls?.flyToGeometry(selectedCandidate?.geometry)}
              settings={settings} onSettings={(patch) => setSettings((prev) => ({ ...prev, ...patch }))}
            />
          )}

          {tab === 'plan' && (
            <PlannerPanel
              candidate={planCandidate} components={components} onComponents={setComponents}
              assumptions={assumptions} onAssumptions={(patch) => setAssumptions((prev) => ({ ...prev, ...patch }))}
              evidence={evidence} evidenceError={evidenceError} pv={pv} pvState={pvState} onPv={getPv}
              health={health} proposalState={proposalState} onGenerate={generate}
              onClear={() => { setPlanCandidate(null); setPv(null); }}
            />
          )}

          {tab === 'data' && (
            <div className="data-tab">
              <div className="health-card">
                <div className="health-topline"><strong>Vector feature data</strong><StatusDot status={errorKeys.length ? 'error' : readyCount === CORE_KEYS.length ? 'ready' : 'loading'} /></div>
                <div className="health-number">{readyCount}<span>/{CORE_KEYS.length}</span></div>
                <div className="health-track"><span style={{ width: `${(readyCount / CORE_KEYS.length) * 100}%` }} /></div>
                <div className="health-foot">{errorKeys.length ? `${errorKeys.length} source(s) need attention — loaded layers remain usable.` : cachedKeys.length ? 'Some layers use a cached public snapshot (see below).' : 'Map imagery loads independently of GIS features.'}</div>
              </div>
              <div className="inspector-section">
                <div className="section-title">SOURCE STATUS</div>
                <div className="service-list">
                  {CORE_KEYS.map((key) => (
                    <div className="service-row" key={key} title={statuses[key]?.message}>
                      <div><span>{VECTOR_LABEL[key]}</span><small>{statuses[key]?.status === 'error' ? `Unavailable — ${statuses[key].message}` : statuses[key]?.message}</small></div>
                      <StatusDot status={statuses[key]?.status} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="inspector-section">
                <div className="section-title">SELECTED FEATURE</div>
                {inspected ? (
                  <div className="selected-card">
                    <span className="selected-type">{inspected.layerTitle}</span>
                    <strong>{inspected.title}</strong>
                    <span className="selected-hint">Feature ID: {inspected.objectId}</span>
                    <div className="attribute-list">
                      {(inspected.facts || []).length ? inspected.facts.map(([key, value]) => (
                        <div className="attribute-row" key={key}><span>{key}</span><strong>{String(value)}</strong></div>
                      )) : <span className="selected-hint">No display attributes were returned for this feature.</span>}
                    </div>
                  </div>
                ) : (
                  <div className="empty-state"><div className="empty-icon">⌖</div><strong>Nothing selected</strong><span>Click a walkway, building, parking lot or canopy polygon on the map.</span></div>
                )}
              </div>
              <div className="panel-footnote right-note">
                <strong>Analysis boundary</strong>
                <span>Measurements are geodesic WGS84 screening metrics computed with Turf.js on validated GeoJSON. Gemini only explains supplied metrics and never creates numbers. No hydrological model, structural review, grid analysis or shade-hour simulation is performed.</span>
              </div>
            </div>
          )}
        </aside>
      </section>

      <footer className="bottom-bar">
        <span>BULLS ECOOPS <b>·</b> independent student prototype — not an official USF recommendation</span>
        <span>Imagery © Esri and contributors · GIS data © USF / USF Water Institute</span>
      </footer>

      {report && <ReportView report={report} evidence={report.evidence} onClose={() => setReport(null)} />}
    </main>
  );
}
