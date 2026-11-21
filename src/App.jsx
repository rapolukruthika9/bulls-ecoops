import { useMemo, useState } from 'react';
import MapView from './components/MapView.jsx';

const LAYERS = [
  { key: 'campus', label: 'USF Tampa campus boundary', description: 'Official USF campus polygon', swatch: 'campus' },
  { key: 'buildings', label: 'Building footprints', description: 'USF Facilities GIS · layer 1', swatch: 'buildings' },
  { key: 'parking', label: 'Surface parking lots', description: 'USF Parking GIS · layer 1', swatch: 'parking' },
  { key: 'canopy', label: 'Existing tree canopy', description: 'Tampa UTC polygons · 2021', swatch: 'canopy' },
  { key: 'planting', label: 'Potential planting zones', description: 'Tampa UTC study layer 10 · 2021', swatch: 'planting' },
  { key: 'heat', label: 'Historical heat zones', description: 'Average land-surface temperature · 2021', swatch: 'heat' },
];

const INITIAL_VISIBILITY = {
  campus: true,
  buildings: true,
  parking: true,
  canopy: true,
  planting: false,
  heat: false,
};

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

export default function App() {
  const [visibility, setVisibility] = useState(INITIAL_VISIBILITY);
  const [statuses, setStatuses] = useState({
    campus: { status: 'loading', message: 'Waiting for the official campus boundary query.' },
    buildings: { status: 'loading', message: 'Waiting for the USF building footprint query.' },
    parking: { status: 'loading', message: 'Waiting for the USF parking query.' },
    canopy: { status: 'loading', message: 'Waiting for the Tampa canopy query.' },
    planting: { status: 'ready', message: 'USF Water Institute potential-planting layer 10; raster overlay loads on demand.' },
    heat: { status: 'ready', message: 'Tampa 2021 average land-surface-temperature raster; not live air temperature.' },
  });
  const [mapReady, setMapReady] = useState(false);
  const [selected, setSelected] = useState(null);
  const [counts, setCounts] = useState({ campus: '—', buildings: 0, parking: 0, canopy: 0 });
  const [mapBase, setMapBase] = useState('satellite');
  const [controls, setControls] = useState(null);

  const coreKeys = ['campus', 'buildings', 'parking', 'canopy'];
  const readyCount = useMemo(() => coreKeys.filter((key) => statuses[key]?.status === 'ready').length, [statuses]);
  const errorCount = useMemo(() => coreKeys.filter((key) => statuses[key]?.status === 'error').length, [statuses]);
  const loadedFeatures = counts.buildings + counts.parking + counts.canopy;

  function updateStatus(key, status, message) {
    setStatuses((previous) => ({ ...previous, [key]: { status, message } }));
  }

  function toggleLayer(key) {
    setVisibility((previous) => ({ ...previous, [key]: !previous[key] }));
  }

  function preset(name) {
    if (name === 'green') {
      setVisibility({ campus: true, buildings: false, parking: false, canopy: true, planting: true, heat: false });
    } else if (name === 'assets') {
      setVisibility({ campus: true, buildings: true, parking: true, canopy: false, planting: false, heat: false });
    } else if (name === 'heat') {
      setVisibility({ campus: true, buildings: false, parking: false, canopy: false, planting: false, heat: true });
    } else {
      setVisibility({ campus: true, buildings: true, parking: true, canopy: true, planting: false, heat: false });
    }
  }

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
          <span className="connection-pill"><StatusDot status={mapReady ? 'ready' : 'loading'} /> MAPLIBRE {mapReady ? 'MAP READY' : 'INITIALIZING'}</span>
          <a className="official-link" href="https://maps.usf.edu/" target="_blank" rel="noreferrer">USF Maps Portal ↗</a>
        </div>
      </header>

      <section className="workspace">
        <aside className="left-panel panel">
          <div className="panel-heading">
            <span className="eyebrow">WORKSPACE</span>
            <h2>Campus map</h2>
            <p>Independent GIS overlays on a campus-centered satellite basemap.</p>
          </div>

          <div className="mission-switcher">
            <button className="mission-button active" onClick={() => preset('all')}>
              <span className="mission-icon">◎</span>
              <span><strong>Campus overview</strong><small>All core layers</small></span>
            </button>
            <div className="mission-grid">
              <button className="mission-button compact" onClick={() => preset('green')}>
                <span className="mission-icon">♧</span>
                <span><strong>Green zones</strong><small>Existing canopy + planting potential</small></span>
              </button>
              <button className="mission-button compact" onClick={() => preset('assets')}>
                <span className="mission-icon">▦</span>
                <span><strong>Campus assets</strong><small>Buildings + lots</small></span>
              </button>
            </div>
            <button className="mission-button compact" onClick={() => preset('heat')}>
              <span className="mission-icon heat-icon">☼</span>
              <span><strong>Historical heat context</strong><small>2021 Tampa study raster</small></span>
            </button>
          </div>

          <div className="layer-group">
            <div className="layer-group-title">BASEMAP</div>
            <div className="base-toggle">
              <button className={mapBase === 'satellite' ? 'selected' : ''} onClick={() => setMapBase('satellite')}>Satellite</button>
              <button className={mapBase === 'street' ? 'selected' : ''} onClick={() => setMapBase('street')}>Street</button>
            </div>
          </div>

          <div className="layer-group">
            <div className="layer-group-title">GIS OVERLAYS · USF TAMPA</div>
            {LAYERS.map((layer) => (
              <LayerRow
                key={layer.key}
                layer={layer}
                visible={visibility[layer.key]}
                status={statuses[layer.key]?.status}
                onToggle={() => toggleLayer(layer.key)}
              />
            ))}
          </div>

          <div className="panel-footnote">
            <strong>How the campus filter works</strong>
            <span>Existing canopy is shown from the Tampa 2021 land-cover study. Potential planting zones are a separate study layer. Historical heat is the study's average land-surface-temperature raster. These are dated regional study layers, not live sensors or field-verified planting approvals. Map imagery is only the basemap.</span>
          </div>
        </aside>

        <section className="map-column">
          <div className="map-toolbar">
            <div>
              <span className="eyebrow">CAMPUS ENVIRONMENTAL MAP</span>
              <h1>University of South Florida · Tampa</h1>
              <p className="toolbar-subtitle">Campus-focused 2D GIS workspace</p>
            </div>
            <div className="map-actions">
              <span className="data-count"><b>{readyCount}/4</b> core sources{errorCount ? ` · ${errorCount} errors` : ''}</span>
              <button className="secondary-button" onClick={() => controls?.reload()} title="Reload campus data">↻ Reload</button>
              <button className="secondary-button" onClick={() => controls?.resetView()}>Reset view</button>
            </div>
          </div>

          <div className="map-frame">
            <MapView
              visibility={visibility}
              mapBase={mapBase}
              reloadToken={0}
              onStatus={updateStatus}
              onSelected={setSelected}
              onCounts={setCounts}
              onControlsReady={setControls}
              onMapReady={setMapReady}
            />
            <div className="map-overlay-tag"><span className="live-dot" /> USF TAMPA CAMPUS</div>
            <div className="map-mini-status">
              <span><StatusDot status={statuses.campus?.status} /> {statuses.campus?.status === 'ready' ? 'Campus boundary loaded' : 'Loading campus boundary'}</span>
              <span>{loadedFeatures.toLocaleString()} overlay features</span>
            </div>
            <div className="map-legend">
              <div><i className="legend-dot canopy" />Existing canopy</div>
              {visibility.planting && <div><i className="legend-dot planting" />Potential planting</div>}
              <div><i className="legend-dot buildings" />Buildings</div>
              <div><i className="legend-dot parking" />Parking</div>
              {visibility.heat && <div><i className="legend-dot heat" />Historical average LST</div>}
            </div>
          </div>
          <div className="map-caption">
            <span>Basemap: Esri World Imagery · rendered by MapLibre GL JS</span>
            <span>Overlays: USF Facilities + USF Water Institute 2021 study layers</span>
          </div>
        </section>

        <aside className="right-panel panel">
          <div className="panel-heading">
            <span className="eyebrow">INSPECTOR</span>
            <h2>Map intelligence</h2>
            <p>Real source status and selected feature attributes.</p>
          </div>

          <div className="health-card">
            <div className="health-topline"><strong>Vector feature data</strong><StatusDot status={errorCount ? 'error' : readyCount === 4 ? 'ready' : 'loading'} /></div>
            <div className="health-number">{readyCount}<span>/4</span></div>
            <div className="health-caption">Campus boundary, buildings, parking and canopy feature queries</div>
            <div className="health-track"><span style={{ width: `${(readyCount / 4) * 100}%` }} /></div>
            <div className="health-foot">{errorCount ? `${errorCount} source(s) need attention.` : 'Map imagery loads independently of GIS features.'}</div>
          </div>

          <div className="metric-grid">
            <div className="metric-card"><span>BUILDINGS</span><strong>{counts.buildings.toLocaleString()}</strong><small>footprint features</small></div>
            <div className="metric-card"><span>PARKING LOTS</span><strong>{counts.parking.toLocaleString()}</strong><small>surface lot features</small></div>
            <div className="metric-card"><span>TREE CANOPY</span><strong>{counts.canopy.toLocaleString()}</strong><small>2021 polygons</small></div>
            <div className="metric-card"><span>CAMPUS AREA</span><strong className="metric-word">{counts.campus === '—' ? 'Loading' : 'USF Tampa'}</strong><small>official boundary</small></div>
          </div>

          <div className="inspector-section">
            <div className="section-title">VECTOR SOURCE CHECK</div>
            <div className="service-list">
              {LAYERS.filter((layer) => layer.key !== 'heat').map((layer) => {
                const item = statuses[layer.key];
                return (
                  <div className="service-row" key={layer.key} title={item?.message || 'Waiting for source check'}>
                    <div><span>{layer.label}</span><small>{item?.message || 'Waiting for query'}</small></div>
                    <StatusDot status={item?.status} />
                  </div>
                );
              })}
              <div className="service-row" title="Historical map-image layer from the USF Water Institute study.">
                <div><span>Historical LST map service</span><small>2021 Tampa study · off by default</small></div>
                <StatusDot status="ready" />
              </div>
            </div>
          </div>

          <div className="inspector-section">
            <div className="section-title">SELECTED FEATURE</div>
            {selected ? (
              <div className="selected-card">
                <span className="selected-type">{selected.layerTitle}</span>
                <strong>{selected.title}</strong>
                <span className="selected-hint">Feature ID: {selected.objectId}</span>
                <div className="attribute-list">
                  {(selected.facts || []).length ? selected.facts.map(([key, value]) => (
                    <div className="attribute-row" key={key}><span>{key}</span><strong>{String(value)}</strong></div>
                  )) : <span className="selected-hint">No display attributes were returned for this feature.</span>}
                </div>
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-icon">⌖</div>
                <strong>Nothing selected</strong>
                <span>Click a campus building, parking lot or canopy polygon on the map.</span>
              </div>
            )}
          </div>

          {errorCount > 0 && (
            <div className="error-note">
              <strong>Data source attention</strong>
              {coreKeys.filter((key) => statuses[key]?.status === 'error').map((key) => (
                <p key={key}><b>{LAYERS.find((layer) => layer.key === key)?.label}:</b> {statuses[key].message}</p>
              ))}
            </div>
          )}

          <div className="panel-footnote right-note">
            <strong>Analysis boundary</strong>
            <span>The vector asset queries use the official Tampa campus boundary. The canopy, potential-planting and average surface-temperature overlays come from Tampa's 2021 urban tree-canopy study. They are historical study context, not real-time readings or confirmed project approvals.</span>
          </div>
        </aside>
      </section>

      <footer className="bottom-bar">
        <span>BULLS ECOOPS <b>·</b> MapLibre 2D campus build</span>
        <span>Imagery © Esri and imagery contributors · GIS data © USF / USF Water Institute</span>
      </footer>
    </main>
  );
}
