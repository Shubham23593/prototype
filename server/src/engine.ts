import fs from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { CLASSES, REGIONS } from '../../lib/constants';
import type { ClassKey, DataMode, Evidence, Overview, Prediction, Region, SourceStatus, ThermalEvent } from '../../lib/types';
import { FirmsFeed, parseFirmsCsv, type Observation } from './firms';
import { Store } from './store';

export async function mlRequest<T>(route: string, body?: unknown, timeout = 45000): Promise<T> {
  const headers: Record<string,string> = body === undefined ? {} : {'Content-Type': 'application/json'};
  const serviceKey = process.env.INTERNAL_SERVICE_KEY || process.env.ADMIN_API_KEY;
  if (serviceKey) headers['X-Service-Key'] = serviceKey;
  const response = await fetch(`${process.env.ML_SERVICE_URL || 'http://127.0.0.1:8000'}${route}`, {
    method: body === undefined ? 'GET' : 'POST', headers,
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout),
  });
  let result;
  try { result = await response.json(); }
  catch { throw new Error(`ML service returned a non-JSON response (HTTP ${response.status}). Inspect service health; no scores were substituted.`); }
  if (!response.ok) throw Object.assign(new Error(typeof result.detail === 'string' ? result.detail : 'ML request failed validation'), { status: response.status });
  return result as T;
}
export interface Filters { mode: DataMode; region: string; window: '24h' | '48h' | '7d'; classKey: ClassKey | 'all'; from?: string; to?: string; q?: string }

export class Engine {
  archive: Observation[] = [];
  archiveMeta: Record<string, any> | null = null;
  archiveError: string | null = null;
  firms = new FirmsFeed();
  store = new Store();
  contextSources: SourceStatus[] = [
    { id: 'sentinel', name: 'Sentinel-2', status: 'idle', detail: 'Real STAC search and cloud-masked COG sampling are available on demand.', url: 'https://earth-search.aws.element84.com/v1', cadence: 'Optical scene availability varies' },
    { id: 'osm', name: 'OpenStreetMap', status: 'idle', detail: 'Overpass infrastructure and land-use queries run for an inspected observation.', url: 'https://overpass-api.de/', cadence: 'Current OSM snapshot · cached 24 h' },
    { id: 'worldpop', name: 'WorldPop', status: 'not_configured', detail: 'Optional population-count raster is not configured. Exposure is unknown.', url: 'https://hub.worldpop.org/' },
  ];
  modelState: Overview['model'] = { available: false, modelId: null, featureMode: null, error: 'ML service has not been checked yet' };
  private predictions = new Map<string, Prediction & { history?: ThermalEvent['history'] }>();
  private stamp = '';
  private lastModelCheck = 0;
  private inference: Promise<void> | null = null;

  async initialize() {
    await Promise.all([this.store.initialize(), this.firms.restore()]);
    try {
      this.archiveMeta = JSON.parse(await fs.readFile('data/replay/manifest.json', 'utf8'));
      const compressed = await fs.readFile('data/replay/india-2025-q1.csv.gz');
      if (createHash('sha256').update(compressed).digest('hex') !== this.archiveMeta?.replay_sha256) throw new Error('Historical replay checksum mismatch');
      this.archive = parseFirmsCsv(gunzipSync(compressed).toString('utf8'), 'archive').observations;
      if (this.archive.length !== this.archiveMeta?.rows) throw new Error('Historical replay row count does not match its provenance manifest');
    } catch (error) {
      this.archive = [];
      this.archiveError = error instanceof Error ? error.message : 'Historical archive unavailable';
    }
  }

  async checkSources(force = false) {
    await Promise.all([
      this.firms.refresh(force).catch(() => {}),
      this.checkModel(true),
      mlRequest<{ sources: SourceStatus[] }>('/sources/probe', undefined, 30000).then(result => {
        this.contextSources = this.contextSources.map(source => ({ ...source, ...result.sources.find(item => item.id === source.id) }));
      }).catch(() => { this.contextSources = this.contextSources.map(source => source.id === 'worldpop' ? source : { ...source, status: 'unreachable', detail: 'Python context service is unavailable. No context values have been substituted.' }); }),
    ]);
  }

  async checkModel(force = false) {
    if (!force && this.modelState.available && Date.now() - this.lastModelCheck < 15000) return;
    this.lastModelCheck = Date.now();
    try {
      const health = await mlRequest<{status: string; model_id: string; feature_mode: string; trained_at: string; message?: string}>('/health', undefined, 8000);
      if (health.status !== 'ready') throw new Error(health.message || 'No trained model');
      const nextStamp = `${health.model_id}:${health.trained_at}`;
      if (nextStamp !== this.stamp) { this.predictions.clear(); this.stamp = nextStamp; }
      this.modelState = { available: true, modelId: health.model_id, featureMode: health.feature_mode, error: null };
    } catch {
      this.modelState = { available: false, modelId: null, featureMode: null, error: 'Python ML service or trained artifact is unavailable. Observations remain unclassified; no scores are invented.' };
    }
  }

  invalidateModel() { this.lastModelCheck = 0; this.stamp = ''; this.predictions.clear(); }

  private async classify(observations: Observation[], precomputed: boolean) {
    await this.checkModel();
    if (!this.modelState.available || !observations.length) return;
    if (this.inference) await this.inference;
    const missing = observations.filter(item => !this.predictions.has(item.event.id));
    if (!missing.length) return;
    this.inference = (async () => {
      try {
        if (!precomputed) {
          // A single call supplies the complete live history. Chunking it would
          // incorrectly reset past-neighbour features at every chunk boundary.
          if (observations.length > 80000) throw new Error('Live inference limit exceeded; narrow the ingestion region before inference.');
          const result = await mlRequest<{predictions: (Prediction & {id: string; history: ThermalEvent['history']})[]}>('/predict', { observations: observations.map(item => item.raw), use_precomputed_history: false }, 120000);
          result.predictions.forEach(item => this.predictions.set(item.id, item));
        } else {
          for (let start = 0; start < missing.length; start += 12000) {
            const chunk = missing.slice(start, start + 12000);
            const result = await mlRequest<{predictions: (Prediction & {id: string; history: ThermalEvent['history']})[]}>('/predict', { observations: chunk.map(item => item.raw), use_precomputed_history: true }, 60000);
            result.predictions.forEach(item => this.predictions.set(item.id, item));
          }
        }
        await this.store.persistObservations(observations.map(item => this.decorate(item)));
      } catch (error) {
        this.modelState = { ...this.modelState, available: false, error: error instanceof Error ? error.message : 'Inference failed' };
      }
    })();
    try { await this.inference; } finally { this.inference = null; }
  }

  private decorate(observation: Observation): ThermalEvent {
    const prediction = this.modelState.available ? this.predictions.get(observation.event.id) : undefined;
    return { ...observation.event, prediction: prediction ? { classKey: prediction.classKey, rawClassKey: prediction.rawClassKey, label: prediction.label, score: prediction.score,
      modelId: prediction.modelId, featureMode: prediction.featureMode, abstentionReason: prediction.abstentionReason, probabilities: prediction.probabilities } : observation.event.prediction,
      history: prediction?.history || observation.event.history, review: this.store.getReview(observation.event.id) };
  }

  async query(filters: Filters): Promise<{events: ThermalEvent[]; overview: Omit<Overview, 'events' | 'total' | 'truncated' | 'mapLimit' | 'stats' | 'distribution' | 'timeline'>}> {
    if (filters.mode === 'live') await this.firms.refresh();
    const data = filters.mode === 'archive' ? this.archive : this.firms.observations;
    await this.classify(data, filters.mode === 'archive');
    const region = REGIONS.find(region => region.id === filters.region) || REGIONS[0];
    let availableFrom: string | null = null, availableTo: string | null = null;
    for (const item of data) {
      const time = item.event.acquiredAt;
      if (!availableFrom || time < availableFrom) availableFrom = time;
      if (!availableTo || time > availableTo) availableTo = time;
    }
    // Historic windows anchor to the source date, never the wall clock. Live
    // windows anchor to now, so last year's cache cannot masquerade as recent.
    const anchor = filters.mode === 'archive' ? (availableTo ? Date.parse(availableTo) : Date.now()) : Date.now();
    const hours = { '24h': 24, '48h': 48, '7d': 168 }[filters.window];
    let start = filters.from ? Date.parse(filters.from + 'T00:00:00Z') : anchor - hours * 3600000;
    const end = filters.to ? Date.parse(filters.to + 'T23:59:59.999Z') : anchor;
    if (filters.mode === 'archive' && availableFrom && availableTo) {
      if (filters.from && (filters.from < availableFrom.slice(0, 10) || filters.to! > availableTo.slice(0, 10))) {
        throw Object.assign(new Error(`The bundled map archive covers ${availableFrom.slice(0,10)} through ${availableTo.slice(0,10)} only. Other historical dates require importing/downloading the original archive.`), {status: 400});
      }
      start = Math.max(start, Date.parse(availableFrom.slice(0, 10) + 'T00:00:00Z'));
    }
    const [west, south, east, north] = region.bbox;
    let events = data.filter(({ event }) => event.latitude >= south && event.latitude <= north && event.longitude >= west && event.longitude <= east
      && Date.parse(event.acquiredAt) >= start && Date.parse(event.acquiredAt) <= end).map(item => this.decorate(item));
    if (filters.classKey !== 'all') events = events.filter(event => event.prediction.classKey === filters.classKey);
    if (filters.q) {
      const search = filters.q.toLowerCase().trim();
      events = events.filter(event => [event.id, String(event.latitude), String(event.longitude), event.prediction.label, event.satellite].some(value => value.toLowerCase().includes(search)));
    }
    const archive = filters.mode === 'archive';
    const stale = !archive && (this.firms.source.status !== 'connected' || !this.firms.lastSuccess || Date.now() - Date.parse(this.firms.lastSuccess) > 90 * 60000 || (!!availableTo && Date.now() - Date.parse(availableTo) > 24 * 3600000));
    const availability = !data.length && (archive ? !!this.archiveError : this.firms.source.status === 'unreachable') ? 'unavailable' : stale ? 'stale' : 'ready';
    const overview = { mode: filters.mode, availability, notice: archive ?
      'Real historical FIRMS observations · 25–31 March 2025. This is archive analysis, not a live feed. Model outputs are source-type candidates, not confirmed incidents.' :
      availability === 'unavailable' ? 'NASA cannot be reached from this environment. No live observations are available. Open the separately labelled historical workspace to analyze real archived data.' :
      stale ? 'Live feed is partial, delayed, or currently unreachable. Only real cached observations within the selected current-time window are shown; inspect source freshness.' :
      'Real NASA near-real-time detections. Satellite overpasses and processing introduce latency; this is not continuous monitoring or an emergency dispatch system.',
      range: { from: new Date(start).toISOString(), to: new Date(end).toISOString(), availableFrom, availableTo },
      source: { name: archive ? 'NASA FIRMS · attributed historical mirror' : 'NASA FIRMS · VIIRS NRT',
        url: archive ? this.archiveMeta?.source?.mirror_url || 'https://firms.modaps.eosdis.nasa.gov/download/' : this.firms.source.url!,
        retrievedAt: archive ? this.archiveMeta?.source?.retrieved_at || null : this.firms.lastSuccess,
        lastAttempt: archive ? null : this.firms.lastAttempt, sha256: archive ? this.archiveMeta?.source_sha256 : undefined },
      model: { ...this.modelState }, generatedAt: new Date().toISOString(), region, window: filters.window };
    return { events, overview: overview as ReturnType<Engine['query']> extends Promise<infer R> ? R extends { overview: infer O } ? O : never : never };
  }

  async overview(filters: Filters): Promise<Overview & {latest: ThermalEvent[]}> {
    const { events, overview } = await this.query(filters);
    const distribution = (Object.keys(CLASSES) as ClassKey[]).map(key => ({ key, name: CLASSES[key].short, value: events.filter(event => event.prediction.classKey === key).length, color: CLASSES[key].color }));
    const bins = new Map<string, {date: string; detections: number; static: number; highFrp: number; meanFrp: number}>();
    if (overview.range.from && overview.range.to) {
      for (let day = Date.parse(overview.range.from.slice(0, 10)); day <= Date.parse(overview.range.to.slice(0, 10)); day += 86400000) {
        const date = new Date(day).toISOString().slice(0, 10);
        bins.set(date, { date, detections: 0, static: 0, highFrp: 0, meanFrp: 0 });
      }
    }
    for (const event of events) {
      const key = event.acquiredAt.slice(0, 10);
      const bin = bins.get(key) || { date: key, detections: 0, static: 0, highFrp: 0, meanFrp: 0 };
      bin.detections++; bin.static += event.prediction.classKey === 'static' ? 1 : 0; bin.highFrp += event.frp >= 50 ? 1 : 0; bin.meanFrp += event.frp;
      bins.set(key, bin);
    }
    const totalFrp = events.reduce((sum, event) => sum + event.frp, 0);
    const mapLimit = 3500;
    const mapped = [...events].sort((a, b) => b.frp - a.frp || b.acquiredAt.localeCompare(a.acquiredAt)).slice(0, mapLimit);
    const latest = [...events].sort((a, b) => b.acquiredAt.localeCompare(a.acquiredAt) || b.frp - a.frp).slice(0, 20);
    return { ...overview, events: mapped, latest, total: events.length, mapLimit, truncated: events.length > mapLimit,
      stats: { detections: events.length, staticCandidates: distribution.find(item => item.key === 'static')!.value, highFrp: events.filter(event => event.frp >= 50).length,
        meanFrp: events.length ? totalFrp / events.length : 0, totalFrp, uncertain: distribution.find(item => item.key === 'uncertain')!.value,
        reviewed: events.filter(event => event.review?.state === 'reviewed').length },
      distribution, timeline: [...bins.values()].sort((a,b) => a.date.localeCompare(b.date)).map(bin => ({ ...bin, meanFrp: bin.detections ? bin.meanFrp / bin.detections : 0 })) };
  }

  async findEvent(id: string): Promise<ThermalEvent | null> {
    const observation = this.archive.find(item => item.event.id === id) || this.firms.observations.find(item => item.event.id === id);
    if (!observation) { const snapshot = this.store.snapshots.get(id); return snapshot ? {...snapshot, review: this.store.getReview(id)} : null; }
    await this.classify(observation.event.mode === 'archive' ? this.archive : this.firms.observations, observation.event.mode === 'archive');
    return this.decorate(observation);
  }

  async scoreMeasuredContext(event: ThermalEvent, evidence: Evidence): Promise<Prediction | undefined> {
    if (!this.modelState.featureMode?.includes('measured context')) return;
    if (evidence.osm.status !== 'ready' || evidence.sentinel.status !== 'ready' || !event.history) return;
    if (!Number.isFinite(evidence.sentinel.ndvi) || !Number.isFinite(evidence.sentinel.ndbi) || typeof evidence.osm.industrial_within_1000m !== 'number') return;
    const observation = this.archive.find(item => item.event.id === event.id) || this.firms.observations.find(item => item.event.id === event.id);
    if (!observation) return;
    const raw = { ...observation.raw, ndvi: evidence.sentinel.ndvi, ndbi: evidence.sentinel.ndbi,
      industrial_distance_capped_m: Math.min(evidence.osm.nearest_industrial?.distance_m ?? 1500, 1500),
      industrial_within_1000m: evidence.osm.industrial_within_1000m,
      prior_detections_30d: event.history.detections, prior_active_days_30d: event.history.activeDays, history_coverage_days: event.history.coverageDays };
    const result = await mlRequest<{predictions: (Prediction & {id: string; history: ThermalEvent['history']})[]}>('/predict', {observations: [raw], use_precomputed_history: true});
    const prediction = result.predictions[0];
    if (prediction) this.predictions.set(event.id, prediction);
    return prediction;
  }

  sources(): SourceStatus[] {
    return [this.firms.source, ...this.contextSources,
      { id: 'archive', name: 'Historical FIRMS archive', status: this.archive.length ? 'connected' : 'unreachable', detail: this.archive.length ? `${this.archive.length.toLocaleString('en-IN')} genuine archived observations. SHA-256 and row count verified against the bundled provenance manifest.` : this.archiveError || 'No archive downloaded', url: this.archiveMeta?.source?.mirror_url },
      { id: 'model', name: 'XGBoost model', status: this.modelState.available ? 'connected' : 'unreachable', detail: this.modelState.available ? `${this.modelState.modelId} · ${this.modelState.featureMode}. Real inference; uncalibrated scores.` : this.modelState.error || 'Unavailable' },
      this.store.status];
  }
}
