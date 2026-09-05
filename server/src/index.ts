import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { Engine, mlRequest, type Filters } from './engine';
import { REGIONS } from '../../lib/constants';
import type { Evidence, ModelCard, TrainingJob } from '../../lib/types';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, frameguard: false, crossOriginResourcePolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use('/api', rateLimit({ windowMs: 60000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many requests. Please wait a minute.' } }));
const engine = new Engine();
const strictDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, 'Invalid calendar date');
const querySchema = z.object({
  mode: z.enum(['archive', 'live']).default('archive'), region: z.string().refine(value => engine.getRegions().some(region => region.id === value), 'Unknown region').default('india'),
  window: z.enum(['24h', '48h', '7d']).default('24h'), classKey: z.enum(['all', 'industrial', 'forest', 'agriculture', 'persistent', 'uncertain', 'unclassified', 'vegetation', 'static', 'offshore']).default('all'),
  from: strictDate.optional(), to: strictDate.optional(), q: z.string().max(100).optional(),
}).refine(value => Boolean(value.from) === Boolean(value.to), 'Provide both from and to dates')
  .refine(value => !value.from || !value.to || (value.from <= value.to && Date.parse(value.to) - Date.parse(value.from) <= 6 * 86400000), 'Select a date range of up to seven calendar days');
function filters(req: express.Request) { return querySchema.parse(req.query) as Filters; }

function authorize(req: express.Request, res: express.Response, next: express.NextFunction) {
  // Prototype/development mutations are open to the browser session without an admin key blocker.
  const origin = req.get('origin');
  if (origin) {
    try {
      const host = new URL(origin).hostname;
      const forwarded = (req.get('x-forwarded-host') || req.get('host') || '').split(':')[0];
      if (host !== forwarded && host !== 'localhost' && host !== '127.0.0.1' && !host.endsWith('.e2b.app')) { res.status(403).json({ error: 'Cross-origin mutations are not allowed' }); return; }
    } catch { res.status(403).json({ error: 'Invalid request origin' }); return; }
  }
  next();
}
const expensiveLimit = rateLimit({ windowMs: 60000, limit: 12, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Please wait before another upstream refresh.' } });
const trainingLimit = rateLimit({ windowMs: 3600000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Training rate limit exceeded. Please wait a few minutes.' } });
const importLimit = rateLimit({ windowMs: 3600000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Archive import rate limit exceeded. Please wait a few minutes.' } });
const uploads = path.resolve('data/uploads');
const uploader = multer({ storage: multer.diskStorage({ destination: (_req, _file, cb) => cb(null, uploads), filename: (_req, _file, cb) => cb(null, `${randomUUID()}.csv`) }),
  limits: { fileSize: 80 * 1024 * 1024, files: 1, fields: 10 },
  fileFilter: (_req, file, cb) => file.originalname.toLowerCase().endsWith('.csv') ? cb(null, true) : cb(new Error('Only genuine FIRMS .csv archives can be imported.')) });

app.get('/', (_req, res) => res.json({ service: 'ThermoScan API', health: '/api/health', documentation: '/api/docs', notice: 'Use the Next.js dashboard for the user interface.' }));
app.get('/api/health', async (_req, res) => {
  await engine.checkModel();
  res.json({ status: 'ready', version: '0.1.0', now: new Date().toISOString(), defaultMode: process.env.DEFAULT_DATA_MODE === 'live' ? 'live' : 'archive',
    model: engine.modelState, archiveAvailable: engine.archive.length > 0, sources: engine.sources(), mutationAuthRequired: false });
});
app.get('/api/sources', async (_req, res) => {
  await engine.checkModel();
  if (engine.contextSources.some(s => s.status !== 'connected' && s.id !== 'worldpop')) {
    await engine.checkSources().catch(() => {});
  }
  res.json({ sources: engine.sources(), checkedAt: new Date().toISOString(), publicFeedsNeedKey: false, mutationAuthRequired: false });
});
app.post('/api/sources/check', expensiveLimit, async (_req, res) => { await engine.checkSources(true); res.json({ sources: engine.sources(), checkedAt: new Date().toISOString() }); });
app.post('/api/sources/firms/refresh', expensiveLimit, async (_req, res) => {
  await engine.firms.refresh(true);
  res.json({ source: engine.firms.source, count: engine.firms.observations.length, checkedAt: new Date().toISOString() });
});
app.get('/api/overview', async (req, res) => { res.json(await engine.overview(filters(req))); });
app.get('/api/observations', async (req, res) => {
  const options = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(12), sort: z.enum(['recent', 'frp', 'score']).default('recent') }).parse(req.query);
  const { events, overview } = await engine.query(filters(req));
  events.sort(options.sort === 'frp' ? (a, b) => b.frp - a.frp : options.sort === 'score' ? (a, b) => (b.prediction.score || 0) - (a.prediction.score || 0) : (a, b) => b.acquiredAt.localeCompare(a.acquiredAt) || b.frp - a.frp);
  res.json({ events: events.slice((options.page - 1) * options.pageSize, options.page * options.pageSize), total: events.length, page: options.page, pageSize: options.pageSize, range: overview.range, mode: overview.mode });
});
app.get('/api/events/:id', async (req, res) => {
  const event = await engine.findEvent(String(req.params.id));
  if (!event) { res.status(404).json({ error: 'Observation not found in the available genuine data.' }); return; }
  res.json(event);
});
app.get('/api/events/:id/context', expensiveLimit, async (req, res) => {
  const event = await engine.findEvent(String(req.params.id));
  if (!event) { res.status(404).json({ error: 'Observation not found' }); return; }
  const evidence = await mlRequest<Evidence>('/context', { latitude: event.latitude, longitude: event.longitude, acquired_at: event.acquiredAt }, 120000);
  const prediction = await engine.scoreMeasuredContext(event, evidence);
  res.json({...evidence, ...(prediction ? {prediction} : {})});
});
app.post('/api/events/:id/review', authorize, async (req, res) => {
  const event = await engine.findEvent(String(req.params.id));
  if (!event) { res.status(404).json({ error: 'Observation not found' }); return; }
  const data = z.object({ state: z.enum(['watching', 'reviewed', 'clear']), note: z.string().max(1000).default('') }).parse(req.body);
  const review = await engine.store.setReview(event.id, data.state, data.note, event);
  res.json({ id: event.id, review, storage: engine.store.status });
});
app.get('/api/watchlist', async (_req, res) => {
  const events = await Promise.all([...engine.store.reviews.keys()].map(id => engine.findEvent(id)));
  res.json({ events: events.filter(Boolean), storage: engine.store.status, note: 'Analyst review list, not verified emergencies. No external notifications are sent.' });
});
app.get('/api/model', async (_req, res) => res.json(await mlRequest<ModelCard>('/model')));
app.get('/api/model/card', async (_req, res) => {
  res.attachment('thermoscan-model-card.json').type('application/json').send(JSON.stringify(await mlRequest<ModelCard>('/model'), null, 2));
});
app.post('/api/model/train', authorize, trainingLimit, async (req, res) => {
  const input = z.object({ dataset_id: z.union([z.literal('default'), z.string().uuid()]).default('default'), with_context: z.boolean().default(false) }).parse(req.body || {});
  const job = await mlRequest<TrainingJob>('/train', input, 15000);
  res.status(202).json(job);
});
const completedJobs = new Set<string>();
app.get('/api/jobs/:id', async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const job = await mlRequest<TrainingJob>(`/jobs/${id}`);
  if (job.status === 'completed' && !completedJobs.has(id)) { engine.invalidateModel(); await engine.reloadArchive(); completedJobs.add(id); }
  res.json(job);
});
app.get('/api/datasets', async (_req, res) => {
  try {
    const data = await mlRequest<{ datasets: Array<Record<string, unknown>> }>('/datasets');
    res.json(data);
  } catch (_error) {
    res.json({ datasets: [] });
  }
});
app.get('/api/history', async (_req, res) => {
  const summary = JSON.parse(await fs.readFile('data/dataset-summary.json', 'utf8'));
  res.json({ ...summary, replay: engine.archiveMeta, rawDownloaded: await fs.access('data/raw/india-viirs-2025.csv').then(() => true).catch(() => false) });
});
app.post('/api/history/import', authorize, importLimit, uploader.single('file'), async (req, res) => {
  if (!req.file) { res.status(400).json({ error: 'Choose a NASA FIRMS CSV file.' }); return; }
  const id = req.file.filename.replace('.csv', '');
  try {
    const rawUrl = String(req.body.provenanceUrl || '').trim() || 'https://firms.modaps.eosdis.nasa.gov/download/';
    const provenanceUrl = z.string().url().max(2000).refine(value => ['https:', 'http:'].includes(new URL(value).protocol), 'Use an HTTP(S) source URL').parse(rawUrl);
    const result = await mlRequest<Record<string, unknown>>(`/datasets/${id}/validate`, undefined, 120000);
    const rowCount = Number(result.rows) || 0;
    if (rowCount <= 0) {
      throw new Error('Parsed archive contains 0 valid FIRMS observations. Check that the file has valid coordinates, timestamps, and brightness/frp columns.');
    }
    const metadata = { name: path.basename(req.file.originalname).slice(0, 120), primary_source: 'User-provided FIRMS archive', primary_url: provenanceUrl,
      download_url: provenanceUrl, sha256: result.sha256, bytes: req.file.size, retrieved_at: new Date().toISOString(),
      notes: ['User-supplied file. Schema and SHA-256 checked; authenticity, label provenance and NASA reprocessing status must be independently verified.'] };
    await fs.writeFile(path.join(uploads, `${id}.provenance.json`), JSON.stringify(metadata, null, 2));
    res.status(201).json({ ...result, name: metadata.name, provenance: metadata });
  } catch (error) { await fs.unlink(req.file.path).catch(() => {}); throw error; }
});

export function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  // Avoid spreadsheet formula injection in user-authored text without changing
  // genuine negative numeric coordinates.
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}
app.get('/api/export', async (req, res) => {
  const format = z.enum(['csv', 'geojson']).default('csv').parse(req.query.format);
  const parsed = filters(req);
  const { events, overview } = await engine.query(parsed);
  const filename = `thermoscan-${parsed.mode}-${parsed.region}-${(overview.range.to || '').slice(0, 10)}`;
  if (format === 'geojson') {
    res.attachment(filename + '.geojson').type('application/geo+json').send(JSON.stringify({ type: 'FeatureCollection', metadata: { source: overview.source, range: overview.range, mode: parsed.mode, warning: 'Provisional source-type model scores, not confirmed incidents' },
      features: events.map(event => ({ type: 'Feature', id: event.id, geometry: { type: 'Point', coordinates: [event.longitude, event.latitude] }, properties: { ...event, latitude: undefined, longitude: undefined } })) }));
  } else {
    const columns = ['id', 'latitude', 'longitude', 'acquired_at_utc', 'frp_mw', 'bright_ti4_k', 'bright_ti5_k', 'satellite', 'nasa_confidence', 'model_class', 'uncalibrated_score', 'model_id', 'mode', 'source_url'];
    const rows = events.map(event => [event.id, event.latitude, event.longitude, event.acquiredAt, event.frp, event.brightness, event.backgroundBrightness, event.satellite, event.confidence, event.prediction.classKey, event.prediction.score, event.prediction.modelId, parsed.mode, overview.source.url].map(csvCell).join(','));
    res.attachment(filename + '.csv').type('text/csv').send([columns.join(','), ...rows].join('\r\n'));
  }
});
app.get('/api/docs', (_req, res) => res.sendFile(path.resolve('docs/HISTORICAL_DATA.md')));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof z.ZodError) { res.status(400).json({ error: 'Invalid request', details: error.issues.map(issue => issue.message) }); return; }
  if (error instanceof multer.MulterError) { res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'File exceeds the 80 MB upload limit. Use the CLI for larger archives.' : error.message }); return; }
  const status = Number((error as {status?: number})?.status) || 503;
  res.status(status >= 400 && status <= 599 ? status : 503).json({ error: error instanceof Error ? error.message : 'Service unavailable. No substitute data was generated.' });
});

async function main() {
  await fs.mkdir(uploads, { recursive: true });
  await engine.initialize();
  const port = Number(process.env.API_PORT || 4000);
  const server = app.listen(port, '0.0.0.0', () => console.log(`ThermoScan API listening on 0.0.0.0:${port}. Historical rows: ${engine.archive.length}.`));
  // Startup probe with retry until Python ML service is listening
  (async () => {
    for (let i = 0; i < 5; i++) {
      try {
        await engine.checkSources();
        if (engine.contextSources.filter(s => s.status === 'connected').length >= 2) break;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 2500));
    }
  })().catch(error => console.error('Source checks could not finish:', error.message));
  const pollMinutes = Math.max(5, Number(process.env.POLL_INTERVAL_MINUTES) || 15);
  const poller = setInterval(() => engine.checkSources().catch(() => {}), pollMinutes * 60000);
  poller.unref();
  process.on('SIGTERM', () => { clearInterval(poller); server.close(() => process.exit(0)); });
}
if (process.env.THERMOSCAN_TEST !== '1') main().catch(error => { console.error('ThermoScan startup failed:', error.message); process.exit(1); });
export { app, engine };
