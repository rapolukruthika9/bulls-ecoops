// Evidence pack builder. Turns a scanned candidate + declared assumptions into the typed
// SiteEvidence object that is sent to the proposal endpoint. Everything numeric is computed
// here in code; Gemini only ever sees (and may only repeat) these metrics.
//
// type Metric = { id, label, value, unit, method, sourceId, status: 'measured'|'model'|'assumption' }
// type SiteEvidence = { siteId, siteName, mission, intervention, metrics[], sourceIds[], assumptions{} }

import {
  solarCapacity, rainwaterCapture, rainGarden, plantingCount, plantingCountArea, ASSUMPTION_META,
} from './scenarios.js';

const round = (v, d = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v);

function metric(id, label, value, unit, method, sourceId, status) {
  return { id, label, value: round(value, 3), unit, method, sourceId, status };
}

/** Which scenario components apply to which candidate kind. */
export function availableComponents(kind) {
  if (kind === 'path' || kind === 'openspace') return ['planting'];
  if (kind === 'parking') return ['solar', 'rainwater', 'raingarden'];
  if (kind === 'building') return ['solar', 'rainwater'];
  return [];
}

export function interventionName(kind, components) {
  const has = (c) => components.includes(c);
  if (kind === 'path') return 'green-corridor';
  if (kind === 'openspace') return 'green-planting';
  if (has('solar') && (has('rainwater') || has('raingarden'))) return 'ecocanopy';
  if (has('solar')) return 'solar-canopy';
  if (has('rainwater') || has('raingarden')) return 'water-smart';
  return 'screening-only';
}

const KIND_SOURCE = { path: 'src-paths', parking: 'src-parking', building: 'src-buildings', openspace: 'src-openspace' };

/**
 * @param {object} p
 * @param {object} p.candidate  scanned candidate (see src/lib/gis.js)
 * @param {string[]} p.components  enabled scenario components
 * @param {object} p.assumptions  declared assumptions (see DEFAULT_ASSUMPTIONS)
 * @param {object|null} p.pv  PVWatts response ({acAnnualKwh, model, retrievedAt,...}) or null
 * @param {object|null} p.score  { value, weights, formula } from EcoPrioritize for the active mission
 * @returns {{evidence: object, scenario: object}}
 */
export function buildSiteEvidence({ candidate, components, assumptions, pv = null, score = null }) {
  const a = assumptions;
  const raw = candidate.raw;
  const kindSrc = KIND_SOURCE[candidate.kind];
  const metrics = [];
  const sourceIds = new Set([kindSrc]);
  const used = {}; // assumptions actually used → echoed in evidence
  const scenario = {};
  const useA = (key) => { used[key] = a[key]; };

  // ---- Measured baseline (computed from GIS geometry in code) ----
  if (candidate.kind === 'path') {
    sourceIds.add('src-canopy');
    metrics.push(
      metric('base.path_length_m', 'Path length', raw.pathLengthM, 'm', 'Turf length() on source geometry', 'src-paths', 'measured'),
      metric('base.buffer_area_m2', 'Corridor buffer area', raw.bufferAreaM2, 'm²', `Turf buffer() ${raw.bufferM} m around the path, area()`, 'src-paths', 'measured'),
      metric('base.canopy_overlap_m2', 'Canopy overlap within buffer', raw.canopyOverlapM2, 'm²', 'Turf intersect() of buffer with canopy polygons (dissolved), area()', 'src-canopy', 'measured'),
      metric('base.canopy_pct', 'Canopy coverage of corridor buffer', raw.canopyPct, '%', 'canopy_overlap ÷ buffer_area × 100', 'src-canopy', 'measured'),
      metric('base.low_canopy_pct', 'Low-canopy exposure proxy', raw.lowCanopyPct, '%', '100 − canopy coverage %; proxy, not measured temperature', 'src-canopy', 'measured'),
    );
    useA('bufferM');
  } else if (candidate.kind === 'openspace') {
    sourceIds.add('src-buildings'); sourceIds.add('src-parking');
    metrics.push(
      metric('base.mapped_area_m2', 'Unbuilt open-space area', raw.mappedAreaM2, 'm²', 'Turf difference(): campus boundary − buffered buildings/parking/stadiums; area()', 'src-openspace', 'measured'),
      metric('base.compactness', 'Compactness index (1 = circle)', raw.compactness, '', '4π × area ÷ perimeter²', 'src-openspace', 'measured'),
    );
    if (raw.exclusions) {
      metrics.push(
        metric('asm.excl_building_m', ASSUMPTION_META.buildingBufferM.label, raw.exclusions.buildingBufferM, 'm', 'Scan setting', 'src-assumption', 'assumption'),
        metric('asm.excl_parking_m', ASSUMPTION_META.parkingBufferM.label, raw.exclusions.parkingBufferM, 'm', 'Scan setting', 'src-assumption', 'assumption'),
        metric('asm.excl_athletic_m', ASSUMPTION_META.athleticBufferM.label, raw.exclusions.athleticBufferM, 'm', 'Scan setting', 'src-assumption', 'assumption'),
      );
      sourceIds.add('src-assumption');
    }
  } else {
    metrics.push(
      metric('base.mapped_area_m2', candidate.kind === 'building' ? 'Building footprint area (roof proxy)' : 'Mapped parking surface area',
        raw.mappedAreaM2, 'm²', 'Turf area() on source polygon', kindSrc, 'measured'),
    );
    if (candidate.kind === 'parking' && Number.isFinite(raw.loadDistanceM)) {
      metrics.push(metric('base.load_distance_m', 'Distance to nearest building', raw.loadDistanceM, 'm', 'Turf pointToLineDistance() from site centroid to building outlines (capped at 300 m)', KIND_SOURCE.building, 'measured'));
      sourceIds.add(KIND_SOURCE.building);
    }
    if (Number.isFinite(raw.pathDistanceM)) {
      sourceIds.add('src-paths');
      metrics.push(metric('base.path_distance_m', 'Distance to nearest mapped path', raw.pathDistanceM, 'm', 'Turf pointToLineDistance() from site centroid', 'src-paths', 'measured'));
    }
    if (Number.isFinite(raw.greenDistanceM)) {
      sourceIds.add('src-green');
      metrics.push(metric('base.green_distance_m', 'Distance to nearest green space', raw.greenDistanceM, 'm', 'Distance from site centroid to green-space boundary (0 if inside)', 'src-green', 'measured'));
    }
  }

  if (score) {
    sourceIds.add('src-method');
    metrics.push(metric('score.screen', `${score.missionLabel} screening score`, score.value, 'pts', score.formula, 'src-method', 'model'));
    for (const [k, v] of Object.entries(score.weights)) {
      metrics.push(metric(`score.weight_${k}`, `Active weight: ${k}`, v, '', 'Adjustable product choice, renormalised to sum 1', 'src-method', 'assumption'));
    }
  }

  // ---- Scenario components (SCENARIO ESTIMATE) ----
  let usableAreaM2 = null;
  if (components.includes('solar') && raw.mappedAreaM2 !== undefined) {
    sourceIds.add('src-assumption');
    ['usableFractionPct', 'panelDensityKwdcPerM2'].forEach(useA);
    const s = solarCapacity({
      mappedAreaM2: raw.mappedAreaM2,
      usableFractionPct: a.usableFractionPct,
      panelDensityKwdcPerM2: a.panelDensityKwdcPerM2,
    });
    usableAreaM2 = s.usableAreaM2;
    scenario.solar = s;
    metrics.push(
      metric('asm.usable_fraction_pct', ASSUMPTION_META.usableFractionPct.label, a.usableFractionPct, '%', 'User-declared', 'src-assumption', 'assumption'),
      metric('asm.panel_density', ASSUMPTION_META.panelDensityKwdcPerM2.label, a.panelDensityKwdcPerM2, 'kWdc/m²', 'User-declared', 'src-assumption', 'assumption'),
      metric('scn.usable_area_m2', 'Usable candidate area (scenario)', s.usableAreaM2, 'm²', 'mapped_area × usable_fraction', 'src-assumption', 'model'),
      metric('scn.capacity_kwdc', 'Assumed system capacity (scenario)', s.systemCapacityKwdc, 'kWdc', 'usable_area × panel_density', 'src-assumption', 'model'),
    );
    if (pv && Number.isFinite(pv.acAnnualKwh)) {
      sourceIds.add('src-pvwatts');
      ['pvTiltDeg', 'pvAzimuthDeg', 'pvLossesPct'].forEach(useA);
      scenario.pv = pv;
      metrics.push(metric('scn.pv_ac_annual_kwh', 'PVWatts modelled annual AC output', pv.acAnnualKwh, 'kWh/yr',
        `${pv.model || 'NLR PVWatts V8'} (tilt ${a.pvTiltDeg}°, azimuth ${a.pvAzimuthDeg}°, losses ${a.pvLossesPct}%); retrieved ${pv.retrievedAt || 'n/a'}${pv.cached ? ' (cached sample)' : ''}`,
        'src-pvwatts', 'model'));
    }
  }

  if (components.includes('rainwater') && raw.mappedAreaM2 !== undefined) {
    sourceIds.add('src-assumption');
    ['rainfallMm', 'runoffCoefficient', 'collectionEfficiency'].forEach(useA);
    const catchment = usableAreaM2 ?? raw.mappedAreaM2;
    const catchLabel = usableAreaM2 !== null ? 'proposed canopy (usable) area' : (candidate.kind === 'building' ? 'footprint proxy' : 'mapped parking area');
    const storage = Number.isFinite(a.storageCapacityM3) ? a.storageCapacityM3 : null;
    if (storage !== null) useA('storageCapacityM3');
    const r = rainwaterCapture({
      areaM2: catchment, rainfallMm: a.rainfallMm, runoffCoefficient: a.runoffCoefficient,
      collectionEfficiency: a.collectionEfficiency, storageCapacityM3: storage,
    });
    scenario.rainwater = { ...r, catchmentAreaM2: catchment, catchLabel };
    metrics.push(
      metric('asm.rainfall_mm', ASSUMPTION_META.rainfallMm.label, a.rainfallMm, 'mm', 'User-declared', 'src-assumption', 'assumption'),
      metric('asm.runoff_coefficient', ASSUMPTION_META.runoffCoefficient.label, a.runoffCoefficient, '', 'User-declared', 'src-assumption', 'assumption'),
      metric('asm.collection_efficiency', ASSUMPTION_META.collectionEfficiency.label, a.collectionEfficiency, '', 'User-declared', 'src-assumption', 'assumption'),
      metric('scn.catchment_area_m2', `Catchment area (${catchLabel})`, catchment, 'm²', catchLabel, usableAreaM2 !== null ? 'src-assumption' : kindSrc, usableAreaM2 !== null ? 'model' : 'measured'),
      metric('scn.capture_m3', 'Potential rainwater capture (scenario)', r.potentialCaptureM3, 'm³',
        'area × (rainfall_mm/1000) × runoff_coefficient × collection_efficiency', 'src-assumption', 'model'),
    );
    if (storage !== null) {
      metrics.push(
        metric('asm.storage_m3', ASSUMPTION_META.storageCapacityM3.label, storage, 'm³', 'User-declared', 'src-assumption', 'assumption'),
        metric('scn.capture_storage_limited_m3', 'Storage-limited capture (scenario)', r.storageLimitedM3, 'm³', 'min(potential capture, storage capacity)', 'src-assumption', 'model'),
      );
    }
  }

  if (components.includes('raingarden') && candidate.kind === 'parking') {
    sourceIds.add('src-assumption');
    ['rainfallMm', 'runoffCoefficient', 'treatmentFraction', 'diversionFraction'].forEach(useA);
    const g = rainGarden({
      pavedAreaM2: raw.mappedAreaM2, treatmentFraction: a.treatmentFraction, rainfallMm: a.rainfallMm,
      runoffCoefficient: a.runoffCoefficient, diversionFraction: a.diversionFraction,
    });
    scenario.raingarden = g;
    metrics.push(
      metric('asm.treatment_fraction', ASSUMPTION_META.treatmentFraction.label, a.treatmentFraction, '', 'User-declared', 'src-assumption', 'assumption'),
      metric('asm.diversion_fraction', ASSUMPTION_META.diversionFraction.label, a.diversionFraction, '', 'User-declared', 'src-assumption', 'assumption'),
      metric('scn.treated_area_m2', 'Treated paved area (scenario)', g.treatedAreaM2, 'm²', 'paved_area × treatment_fraction', 'src-assumption', 'model'),
      metric('scn.runoff_volume_m3', 'Paved-area runoff volume for stated rainfall (scenario)', g.runoffVolumeM3, 'm³', 'paved_area × rainfall/1000 × runoff_coefficient', 'src-assumption', 'model'),
      metric('scn.diverted_volume_m3', 'Diverted volume to rain garden (scenario)', g.divertedVolumeM3, 'm³', 'runoff_volume × diversion_fraction; no infiltration claim', 'src-assumption', 'model'),
    );
  }

  if (components.includes('planting') && candidate.kind === 'openspace') {
    sourceIds.add('src-assumption');
    ['plantingSpacingM', 'plantingAreaFractionPct'].forEach(useA);
    const p = plantingCountArea({ areaM2: raw.mappedAreaM2, plantableFractionPct: a.plantingAreaFractionPct, spacingM: a.plantingSpacingM });
    scenario.planting = p;
    metrics.push(
      metric('asm.planting_fraction_pct', ASSUMPTION_META.plantingAreaFractionPct.label, a.plantingAreaFractionPct, '%', 'User-declared', 'src-assumption', 'assumption'),
      metric('asm.planting_spacing_m', ASSUMPTION_META.plantingSpacingM.label, a.plantingSpacingM, 'm', 'User-declared', 'src-assumption', 'assumption'),
      metric('scn.planting_area_m2', 'Planted area (scenario)', p.plantingAreaM2, 'm²', 'open_area × planted_share', 'src-assumption', 'model'),
      metric('scn.proposed_tree_count', 'Proposed tree count (scenario)', p.proposedTreeCount, 'trees',
        'floor(planted_area ÷ spacing²); no canopy-growth, cooling or carbon claim', 'src-assumption', 'model'),
    );
  }

  if (components.includes('planting') && candidate.kind === 'path') {
    sourceIds.add('src-assumption');
    ['plantingSpacingM', 'plantingSides'].forEach(useA);
    const p = plantingCount({ pathLengthM: raw.pathLengthM, spacingM: a.plantingSpacingM, sides: a.plantingSides });
    scenario.planting = p;
    metrics.push(
      metric('asm.planting_spacing_m', ASSUMPTION_META.plantingSpacingM.label, a.plantingSpacingM, 'm', 'User-declared', 'src-assumption', 'assumption'),
      metric('asm.planting_sides', ASSUMPTION_META.plantingSides.label, a.plantingSides, '', 'User-declared', 'src-assumption', 'assumption'),
      metric('scn.proposed_tree_count', 'Proposed tree count (scenario)', p.proposedTreeCount, 'trees',
        'floor(path_length ÷ spacing) × sides; no canopy-growth or cooling claim', 'src-assumption', 'model'),
    );
  }

  const evidence = {
    siteId: candidate.id,
    siteName: candidate.name,
    mission: candidate.mission || (candidate.kind === 'openspace' ? 'plant' : candidate.kind === 'path' ? 'green' : components.includes('solar') ? 'solar' : 'water'),
    intervention: interventionName(candidate.kind, components),
    metrics,
    sourceIds: [...sourceIds],
    assumptions: Object.fromEntries(Object.entries(used).filter(([, v]) => v !== null && v !== undefined)),
  };
  return { evidence, scenario };
}
