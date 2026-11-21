// NLR (formerly NREL) PVWatts V8 call. The API key stays server-side. PVWatts is an
// optional validated model call — the app works without it (capacity-only fallback).

import { z } from 'zod';

export const PVWATTS_URL = 'https://developer.nlr.gov/api/pvwatts/v8.json';

export const SolarRequestSchema = z.object({
  lat: z.number().min(24).max(50),   // continental US
  lon: z.number().min(-125).max(-66),
  systemCapacityKwdc: z.number().positive().max(500000),
  moduleType: z.number().int().min(0).max(2).default(0),
  arrayType: z.number().int().min(0).max(4).default(0),
  tiltDeg: z.number().min(0).max(90),
  azimuthDeg: z.number().min(0).max(359.9),
  lossesPct: z.number().min(-5).max(99),
});

const cache = new Map();
const keyOf = (r) => JSON.stringify([r.lat.toFixed(4), r.lon.toFixed(4), r.systemCapacityKwdc.toFixed(2), r.moduleType, r.arrayType, r.tiltDeg, r.azimuthDeg, r.lossesPct]);

export async function estimateSolar(req, { apiKey, url = PVWATTS_URL, timeoutMs = 15000, fetchImpl = fetch } = {}) {
  if (!apiKey) {
    return { available: false, reason: 'NLR_API_KEY is not configured; showing capacity only (no annual kWh).' };
  }
  const k = keyOf(req);
  try {
    const params = new URLSearchParams({
      api_key: apiKey,
      lat: String(req.lat),
      lon: String(req.lon),
      system_capacity: String(req.systemCapacityKwdc),
      module_type: String(req.moduleType),
      losses: String(req.lossesPct),
      array_type: String(req.arrayType),
      tilt: String(req.tiltDeg),
      azimuth: String(req.azimuthDeg),
    });
    const res = await fetchImpl(`${url}?${params}`, { signal: AbortSignal.timeout(timeoutMs) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || (json.errors && json.errors.length)) {
      const msg = (json.errors || [`HTTP ${res.status}`]).join('; ').replace(apiKey, '***');
      throw new Error(msg);
    }
    const ac = json?.outputs?.ac_annual;
    if (!Number.isFinite(ac)) throw new Error('PVWatts response had no outputs.ac_annual');
    const result = {
      available: true,
      acAnnualKwh: ac,
      model: `NLR PVWatts V${json.version || '8'}`,
      retrievedAt: new Date().toISOString(),
      cached: false,
      inputs: { ...req },
      stationInfo: json.station_info || null,
      warnings: json.warnings || [],
    };
    cache.set(k, result);
    return result;
  } catch (error) {
    const hit = cache.get(k);
    const reason = String(error?.message || error).replace(apiKey, '***').slice(0, 200);
    if (hit) return { ...hit, cached: true, warnings: [...hit.warnings, `Live call failed (${reason}); showing a previously retrieved result.`] };
    return { available: false, reason: `PVWatts unavailable: ${reason}. Showing capacity only (no annual kWh).` };
  }
}
