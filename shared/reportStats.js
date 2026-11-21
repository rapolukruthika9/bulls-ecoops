// Headline numbers shown as stat cards in the on-screen report and the PDF. Values come straight
// from the computed evidence metrics (never from model prose).
const STAT_PRIORITY = [
  ['tot.capacity_kwdc', 'solar capacity'], ['tot.pv_kwh', 'modelled kWh / year'], ['tot.capture_m3', 'rainwater per event'], ['tot.trees', 'trees proposed'],
  ['scn.pv_ac_annual_kwh', 'modelled kWh / year'], ['scn.capacity_kwdc', 'solar capacity'], ['scn.capture_m3', 'rainwater per event'],
  ['scn.diverted_volume_m3', 'to rain garden'], ['scn.proposed_tree_count', 'trees proposed'], ['scn.planting_area_m2', 'planted area'],
  ['tot.area_m2', 'surface screened'], ['base.mapped_area_m2', 'mapped surface'], ['base.low_canopy_pct', 'low-canopy exposure'],
];

export function pickStats(evidence, max = 4) {
  const byId = new Map(evidence.metrics.map((m) => [m.id, m]));
  const stats = [];
  const seen = new Set();
  for (const [id, caption] of STAT_PRIORITY) {
    const m = byId.get(id);
    if (!m || seen.has(caption)) continue;
    seen.add(caption);
    stats.push({ m, caption });
    if (stats.length === max) break;
  }
  return stats;
}

export const statBadge = (status) => (status === 'measured' ? 'measured from GIS' : status === 'model' ? 'scenario estimate' : 'assumption');
