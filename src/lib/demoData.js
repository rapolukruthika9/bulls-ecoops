// SYNTHETIC DEMO DATA — NOT USF DATA.
//
// Purpose: let the app (priority colours, rankings, planner, reports) be exercised when the live
// USF/ArcGIS layers are unreachable. Everything here is generated, deterministic (seeded) and
// flagged `DEMO: true`. Names are generic ("Demo building 012"), never real building names.
//
// What is grounded and what is assumed (so nothing is passed off as real):
//   • Counts: 275 building footprints and 106 surface-parking lots — the counts the live layers
//     returned in the team's own run.
//   • Campus centre/scale: approximate USF Tampa location and a campus-sized boundary (~7 km²).
//   • Everything else (footprint sizes, shapes, positions, the street-grid rotation) is a plausible
//     synthetic assumption: log-normal sizes with typical campus medians, denser building cores,
//     parking pushed toward the edges. They are NOT measurements of real USF buildings or lots.

export const DEMO_COUNTS = { buildings: 275, parking: 106 };
export const DEMO_CENTER = [-82.4139, 28.0587];
const ROTATION_DEG = 12; // common street-grid rotation applied to every footprint
const SEED = 20251121;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const M_PER_DEG_LAT = 110574;
const mPerDegLon = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);
const toLonLat = (e, n) => [
  Math.round((DEMO_CENTER[0] + e / mPerDegLon(DEMO_CENTER[1])) * 1e7) / 1e7,
  Math.round((DEMO_CENTER[1] + n / M_PER_DEG_LAT) * 1e7) / 1e7,
];
const rotate = (x, y) => {
  const t = (ROTATION_DEG * Math.PI) / 180;
  return [x * Math.cos(t) - y * Math.sin(t), x * Math.sin(t) + y * Math.cos(t)];
};

function pointInPolygon([px, py], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i]; const [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Deterministic synthetic USF-scale campus: boundary + building footprints + parking lots. */
export function generateDemoCampus() {
  const rand = mulberry32(SEED);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const logNormal = (median, sigma, lo, hi) => Math.min(hi, Math.max(lo, median * Math.exp(sigma * gauss())));

  // Campus boundary (ENU metres): an irregular blob roughly 2.9 km east–west × 3.1 km north–south.
  const A = 1450; const B = 1550; const VERTS = 32;
  const boundaryEN = Array.from({ length: VERTS }, (_, k) => {
    const th = (2 * Math.PI * k) / VERTS;
    const base = (A * B) / Math.hypot(B * Math.cos(th), A * Math.sin(th));
    const r = base * (1 + 0.07 * Math.sin(3 * th + 1.1) + 0.04 * Math.sin(5 * th + 0.4));
    return [r * Math.cos(th), r * Math.sin(th)];
  });

  const placed = []; // axis-aligned boxes in the rotated frame, for overlap rejection
  const overlaps = (x0, y0, x1, y1, margin) => placed.some((b) => !(x1 + margin < b[0] || x0 - margin > b[2] || y1 + margin < b[1] || y0 - margin > b[3]));

  function place({ areaM2, aspect, lShape, margin, accept }) {
    for (let attempt = 0; attempt < 6000; attempt += 1) {
      const cx = (rand() - 0.5) * 3300; const cy = (rand() - 0.5) * 3500; // rotated frame
      const [e, n] = rotate(cx, cy);
      if (rand() > accept(Math.hypot(e, n))) continue;
      const scale = lShape ? 1 / 0.7525 : 1;
      const w = Math.sqrt(areaM2 * scale * aspect);
      const h = (areaM2 * scale) / w;
      const x0 = cx - w / 2; const y0 = cy - h / 2; const x1 = cx + w / 2; const y1 = cy + h / 2;
      const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => rotate(x, y));
      if (!corners.every((c) => pointInPolygon(c, boundaryEN))) continue;
      if (overlaps(x0, y0, x1, y1, margin)) continue;
      placed.push([x0, y0, x1, y1]);
      const ring = lShape
        ? [[x0, y0], [x1, y0], [x1, y0 + 0.45 * h], [x0 + 0.55 * w, y0 + 0.45 * h], [x0 + 0.55 * w, y1], [x0, y1], [x0, y0]]
        : [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
      return ring.map(([x, y]) => { const [ee, nn] = rotate(x, y); return toLonLat(ee, nn); });
    }
    return null;
  }

  const feature = (ring, properties, id) => ({ type: 'Feature', id, properties: { OBJECTID: id, DEMO: true, ...properties }, geometry: { type: 'Polygon', coordinates: [ring] } });
  const buildings = []; const parking = [];

  // A few very large footprints with sports-facility names exercise the stadium/athletic exclusion.
  [['Demo stadium', 15000], ['Demo arena', 9000], ['Demo recreation center', 7000]].forEach(([name, area]) => {
    const ring = place({ areaM2: area, aspect: 1.5, lShape: false, margin: 25, accept: () => 1 });
    if (ring) buildings.push(feature(ring, { LONGNAME: name, BUILDINGID: `DEMO-B${String(buildings.length + 1).padStart(3, '0')}` }, buildings.length + 1));
  });
  // Ordinary buildings: denser toward the core.
  while (buildings.length < DEMO_COUNTS.buildings) {
    const area = logNormal(900, 0.75, 120, 9000);
    const ring = place({ areaM2: area, aspect: 1 + rand() * 2.5, lShape: rand() < 0.25, margin: 12, accept: (d) => 0.15 + 0.85 * Math.exp(-((d / 650) ** 2)) });
    if (!ring) break;
    const id = buildings.length + 1;
    buildings.push(feature(ring, { LONGNAME: `Demo building ${String(id).padStart(3, '0')}`, BUILDINGID: `DEMO-B${String(id).padStart(3, '0')}` }, id));
  }
  // Surface parking: larger, pushed toward the campus edge.
  while (parking.length < DEMO_COUNTS.parking) {
    const area = logNormal(3200, 0.7, 500, 22000);
    const ring = place({ areaM2: area, aspect: 1.2 + rand() * 2.8, lShape: false, margin: 8, accept: (d) => 0.25 + 0.75 * Math.min(1, (d / 1100) ** 1.4) });
    if (!ring) break;
    const id = parking.length + 1;
    parking.push(feature(ring, { LOT_ID: `Demo lot ${id}` }, id));
  }

  const campusRing = [...boundaryEN, boundaryEN[0]].map(([e, n]) => toLonLat(e, n));
  const campus = { type: 'Feature', id: 1, properties: { OBJECTID: 1, CAMPUS: 'Tampa (DEMO outline)', DEMO: true }, geometry: { type: 'Polygon', coordinates: [campusRing] } };
  return {
    campus,
    buildings: { type: 'FeatureCollection', features: buildings },
    parking: { type: 'FeatureCollection', features: parking },
    meta: { synthetic: true, seed: SEED, rotationDeg: ROTATION_DEG, counts: { buildings: buildings.length, parking: parking.length } },
  };
}
