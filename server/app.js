import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SOURCES } from '../shared/sources.js';
import { SiteEvidenceSchema } from '../shared/proposal.js';
import { GIS_UPSTREAMS, ALLOWED_GIS_PATH } from '../shared/gis-upstreams.js';
import { generateVerifiedProposal, DEFAULT_MODEL } from './services/gemini.js';
import { estimateSolar, SolarRequestSchema } from './services/pvwatts.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Build the Express app. Dependencies are injectable so tests never need real keys or network.
 */
export function createApp({
  env = process.env,
  geminiClient = null,
  fetchImpl = fetch,
  distDir = path.resolve(here, '..', 'dist'),
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Render sits behind a proxy; needed for per-IP rate limits

  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  const perMinute = Number(env.MAX_CHAT_REQUESTS_PER_MINUTE) || 8;

  app.use(helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'img-src': ["'self'", 'data:', 'blob:', 'https://server.arcgisonline.com'],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'worker-src': ["'self'", 'blob:'],
        'child-src': ["'self'", 'blob:'],
        'connect-src': ["'self'"],
      },
    },
  }));
  if (env.ALLOWED_ORIGIN) app.use(cors({ origin: env.ALLOWED_ORIGIN }));
  app.use('/api', express.json({ limit: '64kb' }));

  // ---------- health / registry ----------
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      gemini: Boolean(geminiClient),
      pvwatts: Boolean(env.NLR_API_KEY),
      model: geminiClient ? model : null,
    });
  });
  app.get('/api/sources', (_req, res) => res.json({ sources: SOURCES }));

  // ---------- PVWatts (optional validated model call) ----------
  app.post('/api/solar-estimate', rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }), async (req, res) => {
    const parsed = SolarRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid solar request', issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`) });
    const result = await estimateSolar(parsed.data, { apiKey: env.NLR_API_KEY, url: env.PVWATTS_URL || undefined, fetchImpl });
    return res.status(result.available ? 200 : 200).json(result);
  });

  // ---------- Gemini proposal ----------
  app.post('/api/proposal', rateLimit({
    windowMs: 60_000, limit: perMinute, standardHeaders: true, legacyHeaders: false,
    message: { error: `Rate limit: at most ${perMinute} proposal requests per minute.` },
  }), async (req, res) => {
    const parsed = SiteEvidenceSchema.safeParse(req.body?.evidence);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid evidence', issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`) });
    }
    const evidence = parsed.data;
    // Sources come from the server's registry, never from the client.
    const sources = Object.fromEntries(evidence.sourceIds.map((id) => [id, SOURCES[id]]));
    try {
      const result = await generateVerifiedProposal(evidence, { client: geminiClient, model });
      return res.json({ ...result, sources, generatedAt: new Date().toISOString(), verified: true });
    } catch (error) {
      return res.status(502).json({ error: 'Proposal generation could not be verified. Review the site metrics and source links.', detail: String(error?.message || error).slice(0, 160) });
    }
  });

  // ---------- GIS proxy (production replacement for the Vite dev proxy) ----------
  const gisLimiter = rateLimit({ windowMs: 60_000, limit: 1200, standardHeaders: true, legacyHeaders: false });
  app.use('/gis', gisLimiter, express.urlencoded({ extended: false, limit: '2mb' }), async (req, res) => {
    const [, name, ...rest] = req.path.split('/');
    const upstream = GIS_UPSTREAMS[name];
    const subPath = `/${rest.join('/')}`;
    if (!upstream || !ALLOWED_GIS_PATH.test(subPath) || !['GET', 'POST'].includes(req.method)) {
      return res.status(404).json({ error: 'Unknown GIS endpoint' });
    }
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const target = `${upstream.origin}${upstream.path}${subPath}${qs}`;
    try {
      const init = { method: req.method, signal: AbortSignal.timeout(45000), headers: { Accept: '*/*' } };
      if (req.method === 'POST') {
        init.body = new URLSearchParams(req.body).toString();
        init.headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
      }
      const r = await fetchImpl(target, init);
      const buffer = Buffer.from(await r.arrayBuffer());
      res.status(r.status);
      const type = r.headers.get('content-type');
      if (type) res.set('Content-Type', type);
      if (req.method === 'GET') res.set('Cache-Control', 'public, max-age=300');
      return res.send(buffer);
    } catch (error) {
      return res.status(502).json({ error: 'GIS upstream unavailable', detail: String(error?.message || error).slice(0, 120) });
    }
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // ---------- static React build ----------
  if (fs.existsSync(path.join(distDir, 'index.html'))) {
    app.use(express.static(distDir, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/(?:api|gis)\/).*/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
  }

  // ---------- error handler (no stack traces to the client) ----------
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    res.status(status).json({ error: status === 413 ? 'Request body too large' : status === 400 ? 'Malformed request' : 'Server error' });
  });

  return app;
}
