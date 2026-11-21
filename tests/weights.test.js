import { describe, it, expect } from 'vitest';
import { rankMission } from '../shared/scoring.js';

const site = (id, area, load, walk = null) => ({ id, raw: { usableAreaM2: area, loadDistanceM: load, pathDistanceM: walk } });

describe('scoring weights', () => {
  const items = [site('big-far', 1000, 200), site('small-near', 200, 5), site('mid', 500, 60)];

  it('re-rank when two factors have data (area vs load proximity)', () => {
    const areaOnly = rankMission('solar', items, { area: 1, walk: 0, load: 0 }).ranked.map((x) => x.id);
    const loadOnly = rankMission('solar', items, { area: 0, walk: 0, load: 1 }).ranked.map((x) => x.id);
    expect(areaOnly[0]).toBe('big-far');
    expect(loadOnly[0]).toBe('small-near');
    expect(areaOnly).not.toEqual(loadOnly);
  });

  it('with a single factor, weights cannot change the order (UI locks the sliders)', () => {
    const one = items.map((i) => site(i.id, i.raw.usableAreaM2, null));
    const a = rankMission('solar', one, { area: 1, walk: 0, load: 0 });
    const b = rankMission('solar', one, { area: 0.1, walk: 0.5, load: 0.4 });
    expect(Object.keys(a.weights)).toEqual(['area']);
    expect(a.ranked.map((x) => x.id)).toEqual(b.ranked.map((x) => x.id));
    expect(b.weights.area).toBe(1);
    expect(a.droppedTerms.sort()).toEqual(['load', 'walk']);
  });
});
