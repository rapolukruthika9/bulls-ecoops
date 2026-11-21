// Pure scenario calculators. All assumptions are passed in and echoed back — no hidden
// constants, no made-up yield factors. Gemini never does any of this arithmetic.

function num(name, value, { min = -Infinity, max = Infinity } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number`);
  }
  if (value < min || value > max) {
    throw new RangeError(`${name} must be between ${min} and ${max}`);
  }
  return value;
}

/** Solar canopy / rooftop capacity from mapped area + declared assumptions. */
export function solarCapacity({ mappedAreaM2, usableFractionPct, panelDensityKwdcPerM2 }) {
  num('mappedAreaM2', mappedAreaM2, { min: 0 });
  num('usableFractionPct', usableFractionPct, { min: 0, max: 100 });
  num('panelDensityKwdcPerM2', panelDensityKwdcPerM2, { min: 0 });
  const usableAreaM2 = mappedAreaM2 * (usableFractionPct / 100);
  const systemCapacityKwdc = usableAreaM2 * panelDensityKwdcPerM2;
  return { usableAreaM2, systemCapacityKwdc };
}

/**
 * Rainwater capture screening:
 *   capture_m3 = area_m2 * (rainfall_mm / 1000) * runoff_coefficient * collection_efficiency
 * If a tank capacity is supplied, the storage-limited volume cannot exceed it.
 */
export function rainwaterCapture({
  areaM2, rainfallMm, runoffCoefficient, collectionEfficiency, storageCapacityM3 = null,
}) {
  num('areaM2', areaM2, { min: 0 });
  num('rainfallMm', rainfallMm, { min: 0 });
  num('runoffCoefficient', runoffCoefficient, { min: 0, max: 1 });
  num('collectionEfficiency', collectionEfficiency, { min: 0, max: 1 });
  const potentialCaptureM3 = areaM2 * (rainfallMm / 1000) * runoffCoefficient * collectionEfficiency;
  let storageLimitedM3 = null;
  let limitedByStorage = false;
  if (storageCapacityM3 !== null && storageCapacityM3 !== undefined) {
    num('storageCapacityM3', storageCapacityM3, { min: 0 });
    storageLimitedM3 = Math.min(potentialCaptureM3, storageCapacityM3);
    limitedByStorage = potentialCaptureM3 > storageCapacityM3;
  }
  return { potentialCaptureM3, storageLimitedM3, limitedByStorage };
}

/**
 * Rain-garden / permeable-pavement scenario (no infiltration or runoff-reduction claim):
 *   treated_area = paved_area * treatment_fraction
 *   runoff_volume = treated_area-based paved_area * rainfall * coefficient
 *   diverted = runoff_volume * diversion_fraction
 */
export function rainGarden({
  pavedAreaM2, treatmentFraction, rainfallMm, runoffCoefficient, diversionFraction,
}) {
  num('pavedAreaM2', pavedAreaM2, { min: 0 });
  num('treatmentFraction', treatmentFraction, { min: 0, max: 1 });
  num('rainfallMm', rainfallMm, { min: 0 });
  num('runoffCoefficient', runoffCoefficient, { min: 0, max: 1 });
  num('diversionFraction', diversionFraction, { min: 0, max: 1 });
  const treatedAreaM2 = pavedAreaM2 * treatmentFraction;
  const runoffVolumeM3 = pavedAreaM2 * (rainfallMm / 1000) * runoffCoefficient;
  const divertedVolumeM3 = runoffVolumeM3 * diversionFraction;
  return { treatedAreaM2, runoffVolumeM3, divertedVolumeM3 };
}

/** annual_liters = count * (old - new L/min) * minutes/day * days/year */
export function fixtureSavings({
  fixtureCount, oldLitersPerMin, newLitersPerMin, minutesPerFixturePerDay, operatingDaysPerYear,
}) {
  num('fixtureCount', fixtureCount, { min: 0 });
  num('oldLitersPerMin', oldLitersPerMin, { min: 0 });
  num('newLitersPerMin', newLitersPerMin, { min: 0 });
  num('minutesPerFixturePerDay', minutesPerFixturePerDay, { min: 0 });
  num('operatingDaysPerYear', operatingDaysPerYear, { min: 0, max: 366 });
  const annualLitersSaved = fixtureCount
    * (oldLitersPerMin - newLitersPerMin)
    * minutesPerFixturePerDay
    * operatingDaysPerYear;
  return { annualLitersSaved };
}

/** Proposed planting count in an open space from declared planting fraction and spacing. */
export function plantingCountArea({ areaM2, plantableFractionPct, spacingM }) {
  num('areaM2', areaM2, { min: 0 });
  num('plantableFractionPct', plantableFractionPct, { min: 0, max: 100 });
  num('spacingM', spacingM, { min: 0.5 });
  const plantingAreaM2 = areaM2 * (plantableFractionPct / 100);
  return { plantingAreaM2, proposedTreeCount: Math.floor(plantingAreaM2 / (spacingM * spacingM)) };
}

/** Proposed planting count along a corridor from declared spacing (no canopy-growth claim). */
export function plantingCount({ pathLengthM, spacingM, sides }) {
  num('pathLengthM', pathLengthM, { min: 0 });
  num('spacingM', spacingM, { min: 0.5 });
  num('sides', sides, { min: 1, max: 2 });
  const perSide = Math.floor(pathLengthM / spacingM);
  return { proposedTreeCount: perSide * Math.round(sides) };
}

export const DEFAULT_ASSUMPTIONS = {
  usableFractionPct: 60,
  panelDensityKwdcPerM2: 0.18,
  pvTiltDeg: 5,
  pvAzimuthDeg: 180,
  pvLossesPct: 14,
  pvModuleType: 0,
  pvArrayType: 0,
  rainfallMm: 25.4,
  runoffCoefficient: 0.9,
  collectionEfficiency: 0.85,
  storageCapacityM3: null,
  treatmentFraction: 0.2,
  diversionFraction: 0.5,
  plantingSpacingM: 8,
  plantingSides: 2,
  plantingAreaFractionPct: 50,
  bufferM: 10,
};

export const ASSUMPTION_META = {
  usableFractionPct: { label: 'Usable fraction of mapped area', unit: '%' },
  panelDensityKwdcPerM2: { label: 'Panel power density (demo assumption)', unit: 'kWdc/m²' },
  pvTiltDeg: { label: 'PV tilt (demo assumption)', unit: '°' },
  pvAzimuthDeg: { label: 'PV azimuth (demo assumption)', unit: '°' },
  pvLossesPct: { label: 'PV system losses', unit: '%' },
  rainfallMm: { label: 'Rainfall depth (scenario input, per event)', unit: 'mm' },
  runoffCoefficient: { label: 'Runoff coefficient', unit: '' },
  collectionEfficiency: { label: 'Collection efficiency', unit: '' },
  storageCapacityM3: { label: 'Tank storage capacity', unit: 'm³' },
  treatmentFraction: { label: 'Treated fraction of paved area', unit: '' },
  diversionFraction: { label: 'Diverted fraction of runoff', unit: '' },
  plantingSpacingM: { label: 'Tree spacing', unit: 'm' },
  plantingSides: { label: 'Planting sides of path', unit: '' },
  plantingAreaFractionPct: { label: 'Share of open space planted', unit: '%' },
  buildingBufferM: { label: 'Exclusion buffer around buildings', unit: 'm' },
  parkingBufferM: { label: 'Exclusion buffer around parking', unit: 'm' },
  athleticBufferM: { label: 'Exclusion buffer around stadiums/athletic buildings', unit: 'm' },
  bufferM: { label: 'Corridor buffer', unit: 'm' },
};
