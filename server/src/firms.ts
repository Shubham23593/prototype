import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ThermalEvent, SourceStatus } from '../../lib/types';

export interface Observation { event: ThermalEvent; raw: Record<string, unknown> }
export function makeObservation(row: Record<string, unknown>, mode: 'archive' | 'live'): Observation | null {
  const numeric = (name: string) => row[name] === '' || row[name] == null ? NaN : Number(row[name]);
  const latitude = numeric('latitude'), longitude = numeric('longitude'), frp = numeric('frp');
  const brightness = numeric('bright_ti4'), background = numeric('bright_ti5');
  const scan = numeric('scan'), track = numeric('track');
  if (![latitude, longitude, frp, brightness, background, scan, track].every(Number.isFinite)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || frp < 0 || frp > 100000 || brightness < 150 || brightness > 600 || background < 150 || background > 600 || scan < .1 || scan > 2 || track < .1 || track > 2) return null;
  if (row.instrument && String(row.instrument).toUpperCase() !== 'VIIRS') return null;
  const date = String(row.acq_date || '');
  const time = String(row.acq_time || '0').replace(/\.0$/, '').padStart(4, '0');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}$/.test(time) || Number(time.slice(0, 2)) > 23 || Number(time.slice(2)) > 59) return null;
  const acquiredAt = `${date}T${time.slice(0, 2)}:${time.slice(2)}:00.000Z`;
  const parsedTime = Date.parse(acquiredAt);
  if (!Number.isFinite(parsedTime) || new Date(parsedTime).toISOString().slice(0, 10) !== date) return null;
  const daynight = String(row.daynight).toUpperCase();
  if (!['D', 'N'].includes(daynight)) return null;
  const satellite = String(row.satellite || 'unknown');
  const id = 'ts-' + createHash('sha256').update(`${latitude.toFixed(5)},${longitude.toFixed(5)},${acquiredAt},${satellite}`).digest('hex').slice(0, 16);
  const raw = { ...row, id, latitude, longitude, frp, bright_ti4: brightness, bright_ti5: background, scan, track, acq_date: date, acq_time: time, daynight, satellite };
  const hasHistory = ['prior_detections_30d', 'prior_active_days_30d', 'history_coverage_days'].every(key => row[key] != null && Number.isFinite(Number(row[key])));
  const event: ThermalEvent = { id, latitude, longitude, acquiredAt, frp, brightness, backgroundBrightness: background, scan, track, satellite, daynight,
    confidence: String(row.confidence || 'unknown'), mode, nasaType: row.type !== undefined && row.type !== '' && Number.isFinite(Number(row.type)) ? Number(row.type) : null,
    prediction: { classKey: 'unclassified', label: 'Not classified', score: null, modelId: null, probabilities: [] },
    history: hasHistory ? { detections: Number(row.prior_detections_30d), activeDays: Number(row.prior_active_days_30d), coverageDays: Number(row.history_coverage_days) } : null,
  };
  return { event, raw };
}

export function parseFirmsCsv(csv: string, mode: 'archive' | 'live'): { observations: Observation[]; rejected: number; duplicates: number } {
  const header = csv.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0].toLowerCase();
  if (!header.includes('latitude') || !header.includes('longitude') || !(header.includes('bright_ti4') || header.includes('brightness'))) throw new Error('Source did not return a valid FIRMS CSV. Login pages and API errors are not observations.');
  const rows = parse(csv, { columns: true, skip_empty_lines: true, bom: true, trim: true }) as Record<string, unknown>[];
  const unique = new Map<string, Observation>();
  let rejected = 0, duplicates = 0;
  for (const input of rows) {
    const row = { ...input, bright_ti4: input.bright_ti4 ?? input.brightness, bright_ti5: input.bright_ti5 ?? input.bright_t31 };
    const observation = makeObservation(row, mode);
    if (!observation) { rejected++; continue; }
    if (unique.has(observation.event.id)) { duplicates++; continue; }
    unique.set(observation.event.id, observation);
  }
  return { observations: Array.from(unique.values()), rejected, duplicates };
}

async function boundedText(response: Response, maximum = 30_000_000): Promise<string> {
  if (!response.body) throw new Error('Empty upstream response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximum) throw new Error('Upstream feed exceeds the download safety limit');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString('utf8');
}

export class FirmsFeed {
  observations: Observation[] = [];
  source: SourceStatus = { id: 'firms', name: 'NASA FIRMS', status: 'idle', detail: 'Waiting for the first real feed request', url: 'https://firms.modaps.eosdis.nasa.gov/active_fire/', cadence: 'VIIRS NRT · regional CSV updated hourly', authConfigured: Boolean(process.env.FIRMS_MAP_KEY) };
  lastSuccess: string | null = null;
  lastAttempt: string | null = null;
  errors: string[] = [];
  private inflight: Promise<void> | null = null;
  private cachePath = path.resolve('.runtime/live-cache.json');

  async restore() {
    try {
      const cache = JSON.parse(await fs.readFile(this.cachePath, 'utf8'));
      this.observations = (cache.rows as Record<string, unknown>[]).map(row => makeObservation(row, 'live')).filter((item): item is Observation => item !== null);
      this.lastSuccess = cache.fetchedAt;
      this.source = { ...this.source, status: 'degraded', lastSuccess: this.lastSuccess, detail: 'Restored previously fetched real observations; freshness has not yet been checked.' };
    } catch { /* No cache is a valid first-run state. */ }
  }

  async refresh(force = false): Promise<void> {
    if (this.inflight) return this.inflight;
    if (!force && this.lastAttempt && Date.now() - Date.parse(this.lastAttempt) < 15 * 60 * 1000) return;
    this.inflight = this.fetchAll();
    try { await this.inflight; } finally { this.inflight = null; }
  }

  private async fetchAll() {
    this.lastAttempt = new Date().toISOString();
    const key = process.env.FIRMS_MAP_KEY;
    const sources = [
      { name: 'NOAA-20', code: 'VIIRS_NOAA20_NRT', directory: 'noaa-20-viirs-c2', prefix: 'J1_VIIRS_C2' },
      { name: 'NOAA-21', code: 'VIIRS_NOAA21_NRT', directory: 'noaa-21-viirs-c2', prefix: 'J2_VIIRS_C2' },
      { name: 'Suomi NPP', code: 'VIIRS_SNPP_NRT', directory: 'suomi-npp-viirs-c2', prefix: 'SUOMI_VIIRS_C2' },
    ];
    this.errors = [];
    const results = await Promise.all(sources.map(async source => {
      const publicUrl = `https://firms.modaps.eosdis.nasa.gov/data/active_fire/${source.directory}/csv/${source.prefix}_South_Asia_7d.csv`;
      const urls = key ? [`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/${source.code}/60,5,100,40/7`, publicUrl] : [publicUrl];
      for (const url of urls) {
        try {
          const response = await fetch(url, { headers: { 'User-Agent': 'ThermoScan/0.1 research-prototype', Accept: 'text/csv' }, signal: AbortSignal.timeout(15000) });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const parsed = parseFirmsCsv(await boundedText(response), 'live');
          // An actual empty NASA CSV is valid. A future-dated record is not live data.
          return parsed.observations.filter(item => Date.parse(item.event.acquiredAt) <= Date.now() + 3600000);
        } catch { /* Only a real public NASA feed may replace a failed key-based request. */ }
      }
      this.errors.push(`${source.name}: upstream connection or CSV validation failed`);
      return null;
    }));
    const successful = results.filter((result): result is Observation[] => result !== null);
    if (successful.length) {
      const unique = new Map<string, Observation>();
      successful.flat().forEach(observation => unique.set(observation.event.id, observation));
      this.observations = [...unique.values()];
      this.lastSuccess = new Date().toISOString();
      const observedThrough = this.observations.length ? new Date(this.observations.reduce((max, item) => Math.max(max, Date.parse(item.event.acquiredAt)), 0)).toISOString() : null;
      this.source = { ...this.source, status: this.errors.length ? 'degraded' : 'connected', lastAttempt: this.lastAttempt, lastSuccess: this.lastSuccess, observedThrough,
        detail: `${successful.length}/3 genuine satellite feeds fetched. ${this.errors.length ? this.errors.join('; ') : 'No fabricated observations. NRT publication has satellite/processing latency.'}` };
      await fs.mkdir(path.dirname(this.cachePath), { recursive: true });
      const tmp = this.cachePath + '.tmp';
      await fs.writeFile(tmp, JSON.stringify({ fetchedAt: this.lastSuccess, rows: this.observations.map(item => item.raw) }));
      await fs.rename(tmp, this.cachePath);
    } else {
      this.source = { ...this.source, status: this.observations.length ? 'degraded' : 'unreachable', lastAttempt: this.lastAttempt, lastSuccess: this.lastSuccess,
        detail: this.observations.length ? 'NASA is unreachable. Showing previously fetched observations with their original acquisition times, not current live data.' : 'Direct NASA connections failed in this environment. Live detections are unavailable; the historical workspace is separate.' };
    }
  }
}
