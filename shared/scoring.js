// EcoPrioritize: visible, adjustable screening scores. Relative rankings only —
// not a scientific risk index. Scores are never comparable across missions.

/** Clamp each weight to 0–1 and renormalise to sum to 1 (equal weights if all zero). */
export function normalizeWeights(weights) {
  const keys = Object.keys(weights);
  const clamped = {};
  let total = 0;
  for (const k of keys) {
    const v = Number(weights[k]);
    clamped[k] = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
    total += clamped[k];
  }
  const out = {};
  for (const k of keys) out[k] = total > 0 ? clamped[k] / total : 1 / keys.length;
  return out;
}

/** Min–max scale within the candidate set; all-equal values map to 0.5. */
export function minMax(values) {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return values.map(() => null);
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  return values.map((v) => {
    if (!Number.isFinite(v)) return null;
    return hi === lo ? 0.5 : (v - lo) / (hi - lo);
  });
}

/**
 * Generic ranker.
 * terms: [{ key, label, get(item) -> number|null, normalize: boolean }]
 * Terms whose values are missing for every candidate are dropped and the remaining
 * weights renormalised, and the dropped terms are reported so the UI can say so.
 */
export function rankCandidates(items, terms, requestedWeights) {
  const usable = terms.filter((t) => items.some((i) => Number.isFinite(t.get(i))));
  const dropped = terms.filter((t) => !usable.includes(t)).map((t) => t.key);
  const weights = normalizeWeights(
    Object.fromEntries(usable.map((t) => [t.key, requestedWeights?.[t.key] ?? 1 / usable.length])),
  );

  const normalized = {};
  for (const t of usable) {
    const raw = items.map((i) => t.get(i));
    normalized[t.key] = t.normalize ? minMax(raw) : raw.map((v) => (Number.isFinite(v) ? v : null));
  }

  const ranked = items.map((item, idx) => {
    let sum = 0;
    const parts = {};
    for (const t of usable) {
      const n = normalized[t.key][idx] ?? 0;
      parts[t.key] = n;
      sum += weights[t.key] * n;
    }
    return { ...item, score: Math.round(100 * sum * 100) / 100, scoreParts: parts };
  });
  ranked.sort((a, b) => b.score - a.score);
  ranked.forEach((r, i) => { r.rank = i + 1; });
  return { ranked, weights, droppedTerms: dropped };
}

export const MISSION_TERMS = {
  plant: [
    { key: 'area', label: 'Normalized open area', get: (c) => c.raw.mappedAreaM2, normalize: true },
    { key: 'shape', label: 'Normalized compactness (plantable block)', get: (c) => c.raw.compactness, normalize: true },
  ],
  green: [
    { key: 'exposure', label: 'Low-canopy exposure proxy', get: (c) => c.raw.lowCanopyPct / 100, normalize: false },
    { key: 'length', label: 'Normalized path length', get: (c) => c.raw.pathLengthM, normalize: true },
  ],
  solar: [
    { key: 'area', label: 'Normalized usable area', get: (c) => c.raw.usableAreaM2, normalize: true },
    { key: 'walk', label: 'Normalized path adjacency', get: (c) => (Number.isFinite(c.raw.pathDistanceM) ? -c.raw.pathDistanceM : null), normalize: true },
    // Closer to a building = shorter run to an existing electrical load (a screening proxy, not an interconnection study).
    { key: 'load', label: 'Normalized load proximity (nearer a building)', get: (c) => (Number.isFinite(c.raw.loadDistanceM) ? -c.raw.loadDistanceM : null), normalize: true },
  ],
  water: [
    { key: 'catchment', label: 'Normalized catchment area', get: (c) => c.raw.catchmentAreaM2, normalize: true },
    { key: 'paved', label: 'Normalized paved area', get: (c) => c.raw.pavedAreaM2, normalize: true },
    { key: 'green', label: 'Normalized green-space adjacency', get: (c) => (Number.isFinite(c.raw.greenDistanceM) ? -c.raw.greenDistanceM : null), normalize: true },
  ],
};

export const DEFAULT_WEIGHTS = {
  plant: { area: 0.6, shape: 0.4 },
  green: { exposure: 0.7, length: 0.3 },
  solar: { area: 0.5, walk: 0.2, load: 0.3 },
  water: { catchment: 0.4, paved: 0.3, green: 0.3 },
};

export const FORMULAS = {
  plant: 'plant_screen_score = 100 × (w_area × normalized_open_area + w_shape × normalized_compactness)',
  green: 'green_score = 100 × (w_exposure × low_canopy_fraction + w_length × normalized_path_length)',
  solar: 'solar_screen_score = 100 × (w_area × normalized_usable_area + w_walk × normalized_path_adjacency + w_load × normalized_load_proximity)',
  water: 'water_screen_score = 100 × (w_catchment × normalized_catchment_area + w_paved × normalized_paved_area + w_green × normalized_green_space_adjacency)',
};

export function rankMission(mission, items, weights) {
  return rankCandidates(items, MISSION_TERMS[mission], weights || DEFAULT_WEIGHTS[mission]);
}

/** Evidence confidence is about source completeness, not the environmental outcome. */
export function evidenceConfidence(candidate) {
  const missing = candidate.missing || [];
  if (candidate.approximate) return { level: 'partial', reason: 'Overlap area is approximate (canopy union failed).' };
  if (missing.length === 0) return { level: 'high', reason: 'All required source layers were available.' };
  if (missing.length === 1) return { level: 'partial', reason: `Missing: ${missing[0]}.` };
  return { level: 'low', reason: `Missing: ${missing.join(', ')}.` };
}
