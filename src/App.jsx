import { useEffect, useMemo, useRef, useState } from 'react';
import MapView from './components/MapView.jsx';
import ScanPanel, { MISSIONS } from './components/ScanPanel.jsx';
import PlannerPanel from './components/PlannerPanel.jsx';
import IdeasPanel from './components/IdeasPanel.jsx';
import ReportView from './components/ReportView.jsx';
import { createEngine, rankAll, SITE_PREFIX, DEFAULTS } from './lib/gis.js';
import { loadLayerLegend } from './lib/data.js';
import { getHealth, requestBrainstorm, requestProposal, requestSolarEstimate } from './lib/api.js';
import { EXTRA_LAYERS, VECTOR_KEYS } from './lib/config.js';
import { DEFAULT_WEIGHTS } from '../shared/scoring.js';
import { DEFAULT_ASSUMPTIONS, solarCapacity } from '../shared/scenarios.js';
import { buildSiteEvidence } from '../shared/evidence.js';
import { buildFallbackProposal } from '../shared/proposal.js';
import { buildPortfolioEvidence, buildPortfolioFallback, MAX_PORTFOLIO_SITES } from '../shared/portfolio.js';
import { buildFallbackIdeas } from '../shared/brainstorm.js';

const ALL_LAYERS = [
  { key: 'priority', label: 'Priority surface (scan result)', description: 'Heat-map of screening scores for the active mission', swatch: 'priority' },
  { key: 'campus', label: 'USF Tampa campus boundary', description: 'Official USF campus polygon', swatch: 'campus' },
  { key: 'buildings', label: 'Building footprints', description: 'USF Facilities GIS · layer 1', swatch: 'buildings' },
  { key: 'parking', label: 'Surface parking lots', description: 'USF Parking GIS · layer 1', swatch: 'parking' },
  { key: 'paths', label: 'Sidewalks / footpaths', description: 'USF Community Maps · layer 11', swatch: 'paths', extra: true },
  { key: 'greenspace', label: 'Campus green space', description: 'USF Community Maps · layer 18', swatch: 'greenspace', extra: true },
  { key: 'canopy', label: 'Existing tree canopy', description: 'Tampa UTC 2021 study (map overlay)', swatch: 'canopy' },
  { key: 'planting', label: 'Potential planting zones', description: 'Tampa UTC study layer 10 · 2021', swatch: 'planting' },
  { key: 'heat', label: 'Historical heat zones', description: 'Average land-surface temperature · 2021', swatch: 'heat' },
];
// Optional layers (failing servers) are hidden unless VITE_ENABLE_EXTRA_LAYERS=true.
const LAYERS = ALL_LAYERS.filter((l) => !l.extra || EXTRA_LAYERS);

const ALL_OFF = Object.fromEntries(ALL_LAYERS.map((l) => [l.key, false]));
const PRESETS = {
  green: { ...ALL_OFF, campus: true, canopy: true, paths: true, greenspace: true, planting: true, priority: true },
  greenlens: { ...ALL_OFF, campus: true, canopy: true, planting: true },
  // Walkways / green space are only switched on when those optional layers are actually loaded.
  water: { ...ALL_OFF, campus: true, buildings: true, parking: true, greenspace: EXTRA_LAYERS, priority: true },
  solar: { ...ALL_OFF, campus: true, buildings: true, parking: true, paths: EXTRA_LAYERS, priority: true },
  plant: { ...ALL_OFF, campus: true, buildings: true, parking: true, canopy: true, priority: true },
  heat: { ...ALL_OFF, campus: true, heat: true },
};
const CORE_KEYS = ['campus', ...VECTOR_KEYS];
const VECTOR_LABEL = Object.fromEntries(ALL_LAYERS.map((l) => [l.key, l.label]));

// Missions rank candidate sites (they need ANALYZE). Green planting appears only once the scan
// has actually found unbuilt open space.
const MISSION_BUTTONS = [
  { key: 'solar', icon: '▦', label: 'Solar', sub: 'Parking lots and roofs' },
  { key: 'water', icon: '◍', label: 'Water', sub: 'Roof & paved catchments' },
  ...(EXTRA_LAYERS ? [{ key: 'green', icon: '♧', label: 'Green corridors', sub: 'Canopy gaps on walkways' }] : []),
];
const PLANT_BUTTON = { key: 'plant', icon: '♧', label: 'Green planting', sub: 'Unbuilt open space (no parking, stadiums)' };
// Data views are reference overlays, not rankings.
const DATA_BUTTONS = [
  { key: 'greenlens', icon: '♧', label: 'Green zones', sub: '2021 canopy & planting study' },
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
  if (candidate.kind === 'path' || candidate.kind === 'openspace') return ['planting'];
  if (candidate.kind === 'parking') return mission === 'water' ? ['rainwater', 'raingarden'] : ['solar', 'rainwater', 'raingarden'];
  return mission === 'water' ? ['rainwater'] : ['solar'];
}

const PV_KEYS = ['usableFractionPct', 'panelDensityKwdcPerM2', 'pvTiltDeg', 'pvAzimuthDeg', 'pvLossesPct'];
const KIND_LABEL = { path: 'WALKWAY', parking: 'PARKING LOT', building: 'BUILDING', openspace: 'OPEN SPACE' };
const fmtN = (v, d = 0) => Number(v).toLocaleString('en-US', { maximumFractionDigits: d });

export default function App() {
  const [visibility, setVisibility] = useState({ ...PRESETS.solar });
  const [lens, setLens] = useState('solar');
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

  const [settings, setSettings] = useState({
    bufferM: DEFAULTS.bufferM, usableFractionPct: DEFAULTS.usableFractionPct,
    buildingBufferM: DEFAULTS.buildingBufferM, parkingBufferM: DEFAULTS.parkingBufferM, athleticBufferM: DEFAULTS.athleticBufferM, minOpenAreaM2: DEFAULTS.minOpenAreaM2,
  });
  const [filterOpen, setFilterOpen] = useState(true);
  const [heatLegend, setHeatLegend] = useState({ status: 'idle', data: null });
  const [scan, setScan] = useState({ status: 'idle', progress: null, result: null, error: null });
  const [weights, setWeights] = useState(() => JSON.parse(JSON.stringify(DEFAULT_WEIGHTS)));
  const [selectedId, setSelectedId] = useState(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const [pf, setPf] = useState({ kind: 'all', topOnly: false, topPct: 25 });

  const [plans, setPlans] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [planMessage, setPlanMessage] = useState('');
  const [pvState, setPvState] = useState({ status: 'idle' });
  const [proposalState, setProposalState] = useState({ status: 'idle' });
  const [report, setReport] = useState(null);

  const [ideaFocus, setIdeaFocus] = useState('');
  const [ideas, setIdeas] = useState({ status: 'idle', result: null });
  const scanAbort = useRef(null);

  useEffect(() => { getHealth().then(setHealth).catch(() => setHealth(null)); }, []);

  // Heat scale: ask the map service what its colours mean (once, when the heat layer is first shown).
  useEffect(() => {
    if (!visibility.heat || heatLegend.status !== 'idle') return undefined;
    const controller = new AbortController();
    setHeatLegend({ status: 'loading', data: null });
    loadLayerLegend('/gis/lst', 15, controller.signal)
      .then((data) => setHeatLegend({ status: data ? 'ready' : 'fallback', data }))
      .catch(() => setHeatLegend({ status: 'fallback', data: null }));
    return () => controller.abort();
  }, [visibility.heat]); // eslint-disable-line react-hooks/exhaustive-deps

  function updateStatus(key, status, message) {
    setStatuses((prev) => ({ ...prev, [key]: { status, message } }));
  }

  // ---------- engine & scan ----------
  const engine = useMemo(() => {
    if (!data) return null;
    return createEngine({
      campus: data.campus,
      paths: data.paths?.collection, canopy: data.canopy?.collection, parking: data.parking?.collection,
      buildings: data.buildings?.collection, greenspace: data.greenspace?.collection,
    }, { paths: EXTRA_LAYERS, greenspace: EXTRA_LAYERS });
  }, [data]);

  useEffect(() => { // a reload invalidates old scan results
    scanAbort.current?.abort();
    setScan({ status: 'idle', progress: null, result: null, error: null });
    setSelectedId(null);
    setPopupOpen(false);
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

  // Priority filter: parking / buildings / all, optionally only the top slice (solar & water missions).
  const filteredMissionRank = useMemo(() => {
    if (!missionRank) return null;
    let list = missionRank.ranked;
    if (mission === 'solar' || mission === 'water') {
      if (pf.kind !== 'all') list = list.filter((c) => c.kind === pf.kind);
      if (pf.topOnly && list.length) list = list.slice(0, Math.max(1, Math.ceil((list.length * pf.topPct) / 100)));
    }
    return { ...missionRank, ranked: list };
  }, [missionRank, mission, pf]);
  const viewRanked = useMemo(() => (ranked ? { ...ranked, [mission]: filteredMissionRank } : null), [ranked, mission, filteredMissionRank]);

  // Priority surface for the map: heat-map points + exact scored shapes for the active filter.
  const priority = useMemo(() => {
    if (!filteredMissionRank) return null;
    const points = []; const shapes = [];
    for (const c of filteredMissionRank.ranked) {
      const props = { score: c.score, id: c.id, rank: c.rank, layerKey: c.layerKey, __oid: c.objectId, name: c.name };
      points.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [c.lon, c.lat] } });
      shapes.push({ type: 'Feature', properties: props, geometry: c.geometry });
    }
    return { points: { type: 'FeatureCollection', features: points }, shapes: { type: 'FeatureCollection', features: shapes } };
  }, [filteredMissionRank]);

  // ---------- selection ----------
  function resolveCandidate(id, preferMission = mission) {
    if (!id) return null;
    for (const m of ['solar', 'water', 'plant', 'green']) {
      const hit = ranked?.[m]?.ranked.find((c) => c.id === id);
      if (hit && (m === preferMission || !ranked?.[preferMission]?.ranked.some((c) => c.id === id))) return hit;
    }
    if (!engine || !data) return null;
    const [prefix, ...rest] = id.split('-');
    const objectId = rest.join('-');
    const layerKey = Object.keys(SITE_PREFIX).find((k) => SITE_PREFIX[k] === prefix);
    const feature = data[layerKey]?.collection.features.find((f) => f.properties.__oid === objectId);
    if (!feature) return null;
    try {
      const c = layerKey === 'paths' ? engine.analyzePath(feature, { bufferM: settings.bufferM }) : engine.analyzeSite(feature, layerKey, settings);
      return c ? { ...c, mission: layerKey === 'paths' ? 'green' : (preferMission === 'water' ? 'water' : 'solar') } : null;
    } catch { return null; }
  }
  const selectedCandidate = useMemo(() => resolveCandidate(selectedId), [selectedId, ranked, engine, data, settings, mission]); // eslint-disable-line react-hooks/exhaustive-deps

  function selectSite(id, { fly = false, popup = true } = {}) {
    setSelectedId(id);
    setPopupOpen(popup);
    setTab((t) => (t === 'plan' || t === 'ideas' ? t : 'scan'));
    if (fly) {
      const c = resolveCandidate(id);
      if (c) controls?.flyToGeometry(c.geometry);
    }
  }

  function onMapSelect(info) {
    setInspected(info);
    if (info && SITE_PREFIX[info.layerKey]) {
      const kind = SITE_PREFIX[info.layerKey];
      if (kind === 'path' && mission !== 'green') setMission('green');
      else if (kind === 'openspace' && mission !== 'plant') setMission('plant');
      else if ((kind === 'parking' || kind === 'building') && (mission === 'green' || mission === 'plant')) setMission('solar');
      setSelectedId(`${kind}-${info.objectId}`);
      setPopupOpen(true);
      setTab('scan');
    }
  }

  function switchMission(key) {
    setLens(key);
    setVisibility(PRESETS[key]);
    if (key === 'solar' || key === 'water' || key === 'plant' || key === 'green') {
      setMission(key);
      setTab('scan');
      setPf((f) => ({ ...f, kind: 'all' }));
      if (selectedCandidate && selectedCandidate.mission !== key) { setSelectedId(null); setPopupOpen(false); }
    }
  }

  function setPriorityKind(kind) {
    setPf((f) => ({ ...f, kind }));
    setVisibility((v) => ({ ...v, priority: true, parking: kind !== 'building', buildings: kind !== 'parking' }));
  }

  // ---------- EcoPlan (multiple sites) ----------
  const makePlan = (c) => ({
    id: c.id, candidate: c, pv: null,
    components: defaultComponents(c, c.mission || mission),
    assumptions: { ...DEFAULT_ASSUMPTIONS, bufferM: c.raw.bufferM ?? DEFAULT_ASSUMPTIONS.bufferM, usableFractionPct: c.raw.usableFractionPct ?? DEFAULT_ASSUMPTIONS.usableFractionPct },
  });

  function addToPlan(candidate = selectedCandidate, { goToPlan = true } = {}) {
    if (!candidate) return;
    if (!plans.some((p) => p.id === candidate.id) && plans.length >= MAX_PORTFOLIO_SITES) {
      setPlanMessage(`EcoPlan holds up to ${MAX_PORTFOLIO_SITES} sites. Remove one to add another.`);
      setTab('plan');
      return;
    }
    setPlanMessage('');
    setPlans((prev) => (prev.some((p) => p.id === candidate.id) ? prev : [...prev, makePlan(candidate)]));
    setActiveId(candidate.id);
    setProposalState({ status: 'idle' });
    if (goToPlan) setTab('plan');
  }

  function updatePlan(id, patch) {
    setPlans((prev) => prev.map((p) => {
      if (p.id !== id) return p;
      const invalidatesPv = Boolean(patch.components) || Object.keys(patch.assumptions || {}).some((k) => PV_KEYS.includes(k));
      return {
        ...p,
        components: patch.components ?? p.components,
        assumptions: patch.assumptions ? { ...p.assumptions, ...patch.assumptions } : p.assumptions,
        pv: invalidatesPv ? null : p.pv,
      };
    }));
    if (patch.components || patch.assumptions) setPvState({ status: 'idle' });
  }

  function removePlan(id) {
    setPlans((prev) => prev.filter((p) => p.id !== id));
    setActiveId((cur) => (cur === id ? null : cur));
    setPlanMessage('');
  }

  const activePlan = plans.find((p) => p.id === activeId) || plans[0] || null;
  useEffect(() => { setPvState({ status: 'idle' }); }, [activeId]);

  const evidenceByPlan = useMemo(() => {
    const out = {};
    for (const plan of plans) {
      try {
        const c = plan.candidate;
        const fresh = ranked?.[c.mission]?.ranked.find((x) => x.id === c.id) || c;
        const scoreInfo = fresh.score !== undefined && ranked?.[c.mission]
          ? { missionLabel: MISSIONS[c.mission].short, value: fresh.score, weights: ranked[c.mission].weights, formula: ranked[c.mission].formula }
          : null;
        out[plan.id] = { ...buildSiteEvidence({ candidate: c, components: plan.components, assumptions: plan.assumptions, pv: plan.pv, score: scoreInfo }), error: null };
      } catch (error) {
        out[plan.id] = { evidence: null, error: error instanceof RangeError ? `Check your inputs: ${error.message}.` : 'Could not build the evidence pack.' };
      }
    }
    return out;
  }, [plans, ranked]);

  const portfolio = useMemo(() => {
    const ready = plans.map((p) => evidenceByPlan[p.id]).filter((e) => e?.evidence && e.evidence.metrics.some((m) => m.id.startsWith('scn.')));
    if (!ready.length) return null;
    try { return buildPortfolioEvidence(ready); } catch { return null; }
  }, [plans, evidenceByPlan]);

  async function getPv() {
    const plan = activePlan;
    if (!plan) return;
    try {
      setPvState({ status: 'loading' });
      const a = plan.assumptions;
      const { systemCapacityKwdc } = solarCapacity({
        mappedAreaM2: plan.candidate.raw.mappedAreaM2, usableFractionPct: a.usableFractionPct, panelDensityKwdcPerM2: a.panelDensityKwdcPerM2,
      });
      const res = await requestSolarEstimate({
        lat: plan.candidate.lat, lon: plan.candidate.lon, systemCapacityKwdc, moduleType: a.pvModuleType, arrayType: a.pvArrayType,
        tiltDeg: a.pvTiltDeg, azimuthDeg: a.pvAzimuthDeg, lossesPct: a.pvLossesPct,
      });
      if (res.available) {
        setPlans((prev) => prev.map((p) => (p.id === plan.id ? { ...p, pv: res } : p)));
        setPvState({ status: 'ready' });
      } else setPvState({ status: 'error', message: res.reason });
    } catch (error) {
      setPvState({ status: 'error', message: `${error.message} Capacity-only result retained.` });
    }
  }

  async function runProposal(evidence, scope) {
    if (!evidence) return;
    setProposalState({ status: 'loading', scope });
    try {
      const res = await requestProposal(evidence);
      setReport({ ...res, evidence });
    } catch (error) {
      // API unreachable/rate-limited: the report must still render from deterministic metrics.
      setReport({
        proposal: evidence.intervention === 'portfolio' ? buildPortfolioFallback(evidence) : buildFallbackProposal(evidence),
        source: 'fallback', model: null, evidence,
        warnings: [`Proposal API unavailable: ${error.message}`], generatedAt: new Date().toISOString(),
      });
    }
    setProposalState({ status: 'idle' });
  }
  const generate = () => runProposal(evidenceByPlan[activePlan?.id]?.evidence, 'site');
  const generatePortfolio = () => runProposal(portfolio, 'portfolio');

  // ---------- Ideas (Gemini brainstorm) ----------
  const siteNames = useMemo(() => {
    const out = {};
    for (const m of ['solar', 'water', 'plant', 'green']) for (const c of ranked?.[m]?.ranked || []) out[c.id] = c.name;
    return out;
  }, [ranked]);

  function buildBrainstormContext() {
    const sites = []; const metrics = [];
    const push = (id, label, value, unit, sourceId, status) => { if (Number.isFinite(value)) metrics.push({ id, label: label.slice(0, 160), value: Math.round(value * 100) / 100, unit, sourceId, status }); };
    for (const m of ['solar', 'water', 'plant', ...(EXTRA_LAYERS ? ['green'] : [])]) {
      for (const c of (ranked?.[m]?.ranked || []).slice(0, 5)) {
        if (sites.length >= 15) break;
        sites.push({ id: c.id, name: c.name, kind: c.kind, mission: m, rank: c.rank, score: Math.round(c.score * 10) / 10 });
        const slot = `x${sites.length}`;
        const src = c.kind === 'building' ? 'src-buildings' : c.kind === 'parking' ? 'src-parking' : c.kind === 'openspace' ? 'src-openspace' : 'src-paths';
        if (c.kind === 'path') {
          push(`${slot}.length_m`, `${c.name} — path length`, c.raw.pathLengthM, 'm', 'src-paths', 'measured');
          push(`${slot}.canopy_pct`, `${c.name} — canopy coverage`, c.raw.canopyPct, '%', 'src-canopy', 'measured');
        } else if (c.kind === 'openspace') {
          push(`${slot}.area_m2`, `${c.name} — unbuilt open area`, c.raw.mappedAreaM2, 'm²', src, 'measured');
          push(`${slot}.compact`, `${c.name} — compactness index`, c.raw.compactness, '', src, 'measured');
        } else {
          push(`${slot}.area_m2`, `${c.name} — mapped area (${m} mission)`, c.raw.mappedAreaM2, 'm²', src, 'measured');
          push(`${slot}.path_m`, `${c.name} — distance to nearest path`, c.raw.pathDistanceM, 'm', 'src-paths', 'measured');
        }
        push(`${slot}.score`, `${c.name} — ${m} screening score`, c.score, 'pts', 'src-method', 'model');
      }
    }
    push('c.solar_candidates', 'Solar candidates screened', scan.result?.solar.length, 'sites', 'src-method', 'model');
    push('c.plant_candidates', 'Open spaces found', scan.result?.plant.length, 'sites', 'src-method', 'model');
    push('c.water_candidates', 'Water candidates screened', scan.result?.water.length, 'sites', 'src-method', 'model');
    return {
      focus: ideaFocus, sites, metrics: metrics.slice(0, 60),
      layers: { buildings: Boolean(engine?.available.buildings), parking: Boolean(engine?.available.parking), canopyPolygons: Boolean(engine?.available.canopy), paths: Boolean(engine?.available.paths), greenspace: Boolean(engine?.available.greenspace) },
    };
  }

  async function brainstorm() {
    setIdeas((prev) => ({ ...prev, status: 'loading' }));
    const ctx = buildBrainstormContext();
    try {
      const res = await requestBrainstorm(ctx);
      setIdeas({ status: 'idle', result: res });
    } catch (error) {
      setIdeas({ status: 'idle', result: { ideas: buildFallbackIdeas(ctx), source: 'fallback', model: null, warnings: [`Brainstorm API unavailable: ${error.message}`] } });
    }
  }

  // ---------- derived UI ----------
  const readyCount = CORE_KEYS.filter((k) => ['ready', 'cached'].includes(statuses[k]?.status)).length;
  const errorKeys = CORE_KEYS.filter((k) => statuses[k]?.status === 'error');
  const cachedKeys = CORE_KEYS.filter((k) => statuses[k]?.status === 'cached');
  const showLegend = visibility.priority && filteredMissionRank;
  const proposedGeometry = tab === 'plan' && activePlan ? activePlan.candidate.geometry : null;

  const popupSite = useMemo(() => {
    const c = popupOpen ? selectedCandidate : null;
    if (!c) return null;
    const r = c.raw;
    const lines = c.kind === 'openspace'
      ? [`${fmtN(r.mappedAreaM2)} m² unbuilt open space`, 'Excludes buildings, parking, stadiums']
      : c.kind === 'path'
      ? [`${fmtN(r.pathLengthM)} m long · ${fmtN(r.canopyPct, 1)}% canopy cover`]
      : [`${fmtN(r.mappedAreaM2)} m² mapped${c.kind === 'building' ? ' (roof proxy)' : ''}`, ...(Number.isFinite(r.pathDistanceM) ? [`${fmtN(r.pathDistanceM)} m to nearest walkway`] : [])];
    return {
      id: c.id, name: c.name, kindLabel: KIND_LABEL[c.kind], score: c.score, rank: c.rank, lines, lon: c.lon, lat: c.lat,
      inPlan: plans.some((p) => p.id === c.id),
    };
  }, [popupOpen, selectedCandidate, plans]);

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
            <span className="eyebrow">EXPLORE</span>
            <h2>What to look at</h2>
            <p>Pick a lens. Each shows its own layers; Analyze then ranks candidate sites.</p>
          </div>

          <div className="nav-subhead">MISSIONS</div>
          <div className="mission-switcher">
            {[...MISSION_BUTTONS, ...(scan.status === 'done' && scan.result?.plant.length > 0 ? [PLANT_BUTTON] : [])].map((m) => (
              <button key={m.key} className={`mission-button ${lens === m.key ? 'active' : ''}`} onClick={() => switchMission(m.key)}>
                <span className="mission-icon">{m.icon}</span>
                <span><strong>{m.label}</strong><small>{m.sub}</small></span>
              </button>
            ))}
            {!(scan.status === 'done' && scan.result?.plant.length > 0) && (
              <p className="limit-text">Green planting appears after ANALYZE CAMPUS finds unbuilt open space (outside buildings, parking and stadiums).</p>
            )}
          </div>

          <div className="nav-subhead">DATA</div>
          <div className="mission-switcher">
            {DATA_BUTTONS.map((m) => (
              <button key={m.key} className={`mission-button ${lens === m.key ? 'active' : ''}`} onClick={() => switchMission(m.key)}>
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
              <p className="toolbar-subtitle">{MISSIONS[mission].label} · {scan.status === 'done' ? `${filteredMissionRank?.ranked.length ?? 0} ranked candidates shown` : 'run ANALYZE CAMPUS to rank sites'}</p>
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
              popupSite={popupSite} onPopupAdd={() => addToPlan(selectedCandidate, { goToPlan: false })} onPopupClose={() => setPopupOpen(false)}
              onStatus={updateStatus} onSelected={onMapSelect} onData={setData}
              onControlsReady={setControls} onMapReady={setMapReady}
            />
            <div className="map-overlay-tag"><span className="live-dot" /> USF TAMPA CAMPUS</div>
            {(statuses.buildings?.status === 'error' || statuses.parking?.status === 'error') && (
              <div className="map-banner" role="alert">Live USF layers are unavailable. Check the Data tab for the error, then press Reload.</div>
            )}

            {scan.status === 'done' && visibility.priority && (mission === 'solar' || mission === 'water') && (filterOpen ? (
              <div className="map-filter" role="group" aria-label="Priority filter">
                <span className="map-filter-label">PRIORITY</span>
                {[['all', 'All'], ['parking', 'Parking'], ['building', 'Buildings']].map(([k, label]) => (
                  <button key={k} className={pf.kind === k ? 'selected' : ''} aria-pressed={pf.kind === k} onClick={() => setPriorityKind(k)}>{label}</button>
                ))}
                <label className="map-filter-top">
                  <input type="checkbox" checked={pf.topOnly} onChange={(e) => setPf((f) => ({ ...f, topOnly: e.target.checked }))} /> High priority only
                </label>
                {pf.topOnly && (
                  <select aria-label="Top share shown" value={pf.topPct} onChange={(e) => setPf((f) => ({ ...f, topPct: Number(e.target.value) }))}>
                    <option value={10}>top 10%</option><option value={25}>top 25%</option><option value={50}>top 50%</option>
                  </select>
                )}
                <button className="map-filter-close" onClick={() => setFilterOpen(false)} aria-label="Close priority filter" title="Close">×</button>
              </div>
            ) : (
              <button className="map-filter-reopen" onClick={() => setFilterOpen(true)}>Priority filter ▾</button>
            ))}

            {statuses.campus?.status === 'loading' && <div className="map-loading" role="status">Loading USF campus layers…</div>}
            <div className="map-legend">
              {showLegend && (
                <div className="heat-legend">
                  <b>Priority · {MISSIONS[mission].short}{pf.kind !== 'all' ? ` · ${pf.kind === 'parking' ? 'parking only' : 'buildings only'}` : ''}{pf.topOnly ? ` · top ${pf.topPct}%` : ''}</b>
                  <i className="heat-ramp" />
                  <span><em>lower</em><em>higher rank</em></span>
                </div>
              )}
              {visibility.canopy && <div><i className="legend-dot canopy" />Existing canopy (2021)</div>}
              {visibility.greenspace && <div><i className="legend-dot greenspace" />Green space</div>}
              {visibility.planting && <div><i className="legend-dot planting" />Potential planting</div>}
              {visibility.buildings && <div><i className="legend-dot buildings" />Buildings</div>}
              {visibility.parking && <div><i className="legend-dot parking" />Parking</div>}
              {visibility.paths && <div><i className="legend-line" />Walkways</div>}
              {visibility.heat && <div><i className="legend-dot heat" />Historical average LST</div>}
              {proposedGeometry && <div><i className="legend-dash" />PROPOSED site (scenario)</div>}
            </div>
            {visibility.heat && (
              <div className="heat-scale" role="group" aria-label="Heat areas colour scale">
                <b>Heat areas — 2021 average surface temperature</b>
                {heatLegend.status === 'ready' && heatLegend.data ? (
                  <ul>
                    {heatLegend.data.items.map((item, i) => (
                      <li key={i}><img src={item.src} alt="" width="18" height="14" /><span>{item.label || '—'}</span></li>
                    ))}
                  </ul>
                ) : heatLegend.status === 'loading' ? (
                  <span className="limit-text">Loading the colour scale…</span>
                ) : (
                  <>
                    <i className="heat-ramp wide" />
                    <span className="heat-scale-ends"><em>cooler</em><em>hotter</em></span>
                    <span className="limit-text">Relative scale: the map service did not provide exact temperature values for its colours.</span>
                  </>
                )}
                <span className="limit-text">Satellite-derived land-surface temperature from a 2021 Tampa study — not air temperature or personal heat exposure.</span>
              </div>
            )}
          </div>
          <div className="map-caption">
            <span>Basemap: Esri World Imagery · MapLibre GL JS</span>
            <span>Overlays: USF Facilities + USF Water Institute 2021 · screening metrics, not surveyed</span>
          </div>
        </section>

        <aside className="right-panel panel">
          <div className="tab-bar" role="tablist">
            {[['scan', 'EcoScan'], ['plan', `EcoPlan${plans.length ? ` (${plans.length})` : ''}`], ['ideas', 'Ideas'], ['data', 'Data']].map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'selected' : ''} onClick={() => setTab(k)}>{label}</button>
            ))}
          </div>

          {tab === 'scan' && (
            <ScanPanel
              mission={mission} scan={scan} ranked={viewRanked} weights={weights}
              onWeights={(m, w) => setWeights((prev) => ({ ...prev, [m]: w }))}
              onResetWeights={() => setWeights((prev) => ({ ...prev, [mission]: { ...DEFAULT_WEIGHTS[mission] } }))}
              onAnalyze={analyze} canAnalyze={blockers.length === 0} blockers={blockers}
              selectedId={selectedId} onSelect={(id) => selectSite(id, { fly: true })}
              selectedCandidate={selectedCandidate} onAddToPlan={() => addToPlan(selectedCandidate)}
              inPlan={plans.some((p) => p.id === selectedCandidate?.id)}
              onFly={() => controls?.flyToGeometry(selectedCandidate?.geometry)}
              settings={settings} onSettings={(patch) => setSettings((prev) => ({ ...prev, ...patch }))}
            />
          )}

          {tab === 'plan' && (
            <>
              {planMessage && <p className="warn-text">{planMessage}</p>}
              <PlannerPanel
                plans={plans} activeId={activePlan?.id} onActivate={setActiveId} onRemove={removePlan}
                onClearAll={() => { setPlans([]); setActiveId(null); setPlanMessage(''); }}
                onUpdate={updatePlan} evidenceByPlan={evidenceByPlan} portfolio={portfolio} onGeneratePortfolio={generatePortfolio}
                pvState={pvState} onPv={getPv} health={health} proposalState={proposalState} onGenerate={generate}
              />
            </>
          )}

          {tab === 'ideas' && (
            <IdeasPanel
              focus={ideaFocus} onFocus={setIdeaFocus} state={ideas} onBrainstorm={brainstorm}
              hasScan={scan.status === 'done'} siteNames={siteNames} health={health}
              onOpenSite={(id) => { if (id.startsWith('path') && mission !== 'green') setMission('green'); else if (id.startsWith('openspace') && mission !== 'plant') setMission('plant'); else if ((id.startsWith('parking') || id.startsWith('building')) && (mission === 'green' || mission === 'plant')) setMission('solar'); selectSite(id, { fly: true }); setTab('scan'); }}
              onAddSite={(id) => { const c = resolveCandidate(id); if (c) addToPlan(c); }}
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
                {!EXTRA_LAYERS && <p className="limit-text">Optional layers (canopy polygons, walkways, green space) are switched off because their servers were unreachable. Scoring uses buildings and parking; canopy, planting and heat remain available as 2021 map overlays.</p>}
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
                  <div className="empty-state"><div className="empty-icon">⌖</div><strong>Nothing selected</strong><span>Click a building or parking lot on the map.</span></div>
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
