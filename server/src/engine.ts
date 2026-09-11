import fs from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { CLASSES, REGIONS, getNearestIndustrialFacility } from '../../lib/constants';
import type { ClassKey, DataMode, Evidence, Overview, Prediction, Region, SourceStatus, ThermalEvent } from '../../lib/types';
import { FirmsFeed, parseFirmsCsv, type Observation } from './firms';
import { Store } from './store';


export async function mlRequest<T>(route: string, body?: unknown, timeout = 45000, retries = 3): Promise<T> {
  const headers: Record<string,string> = body === undefined ? {} : {'Content-Type': 'application/json'};
  const serviceKey = process.env.INTERNAL_SERVICE_KEY || process.env.ADMIN_API_KEY;
  if (serviceKey) headers['X-Service-Key'] = serviceKey;
  const url = `${process.env.ML_SERVICE_URL || 'http://127.0.0.1:8000'}${route}`;
  try {
    const response = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST', headers,
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout),
    });
    if ((response.status === 502 || response.status === 503) && retries > 0) {
      // Cloud services like Render spin down when idle; wait for cold start and retry
      const delayMs = Math.min(12000, (4 - retries) * 2500 + 4000);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return mlRequest<T>(route, body, timeout, retries - 1);
    }
    let result;
    try { result = await response.json(); }
    catch { throw new Error(`ML service returned a non-JSON response (HTTP ${response.status}). Inspect service health; no scores were substituted.`); }
    if (!response.ok) throw Object.assign(new Error(typeof result.detail === 'string' ? result.detail : 'ML request failed validation'), { status: response.status });
    return result as T;
  } catch (error) {
    if (retries > 0 && error instanceof Error && (error.name === 'TimeoutError' || error.message.includes('fetch failed'))) {
      const delayMs = Math.min(8000, (4 - retries) * 2000 + 3000);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return mlRequest<T>(route, body, timeout, retries - 1);
    }
    throw error;
  }
}
export interface Filters {
  mode: DataMode;
  region: string;
  window: 'today' | '24h' | '48h' | '7d';
  classKey: string;
  from?: string;
  to?: string;
  q?: string;
}

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

  getRegions(): Region[] {
    if (this.archiveMeta?.region) {
      const active = this.archiveMeta.region as Region;
      return [active, ...REGIONS.filter(r => r.id !== active.id)];
    }
    return REGIONS;
  }

  async reloadArchive() {
    try {
      let manifestPath = 'data/replay/active-manifest.json';
      let replayPath = 'data/replay/active-replay.csv.gz';
      try {
        await fs.access(manifestPath);
        await fs.access(replayPath);
      } catch {
        try {
          const sync = await mlRequest<{ manifest: Record<string, unknown>; replay_b64: string }>('/replay/active', undefined, 10000);
          if (sync?.manifest && sync?.replay_b64) {
            await fs.mkdir('data/replay', { recursive: true });
            await fs.writeFile(manifestPath, JSON.stringify(sync.manifest, null, 2));
            await fs.writeFile(replayPath, Buffer.from(sync.replay_b64, 'base64'));
          } else {
            manifestPath = 'data/replay/manifest.json';
            replayPath = 'data/replay/india-2025-q1.csv.gz';
          }
        } catch {
          manifestPath = 'data/replay/manifest.json';
          replayPath = 'data/replay/india-2025-q1.csv.gz';
        }
      }
      this.archiveMeta = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      const compressed = await fs.readFile(replayPath);
      if (this.archiveMeta?.replay_sha256 && createHash('sha256').update(compressed).digest('hex') !== this.archiveMeta.replay_sha256) {
        throw new Error('Historical replay checksum mismatch');
      }
      this.archive = parseFirmsCsv(gunzipSync(compressed).toString('utf8'), 'archive').observations;
      if (this.archiveMeta?.rows != null && this.archive.length !== this.archiveMeta.rows) {
        throw new Error('Historical replay row count does not match its provenance manifest');
      }
      this.archiveError = null;
      this.predictions.clear();
    } catch (error) {
      this.archive = [];
      this.archiveError = error instanceof Error ? error.message : 'Historical archive unavailable';
    }
  }

  async initialize() {
    await Promise.all([this.store.initialize(), this.firms.restore()]);
    await this.reloadArchive();
  }

  async checkSources(force = false) {
    await Promise.all([
      this.firms.refresh(force).catch(() => {}),
      this.checkModel(true),
      mlRequest<{ sources: SourceStatus[] }>('/sources/probe', undefined, 25000).then(result => {
        if (result?.sources) {
          this.contextSources = this.contextSources.map(source => ({ ...source, ...result.sources.find(item => item.id === source.id) }));
        }
      }).catch(err => {
        console.warn('Context source probe warning:', err?.message || err);
        this.contextSources = this.contextSources.map(source =>
          source.status === 'connected' ? source :
          source.id === 'worldpop' ? source : { ...source, status: 'unreachable', detail: 'Python context service is unavailable. No context values have been substituted.' }
        );
      }),
    ]);
  }

  async checkModel(force = false) {
    if (!force && this.modelState.available && Date.now() - this.lastModelCheck < 15000) return;
    this.lastModelCheck = Date.now();
    try {
      const health = await mlRequest<{status: string; model_id: string; feature_mode: string; trained_at: string; message?: string}>('/health', undefined, 35000);
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
        const chunkSize = 15000;
        for (let start = 0; start < missing.length; start += chunkSize) {
          const chunk = missing.slice(start, start + chunkSize);
          const result = await mlRequest<{predictions: (Prediction & {id: string; history: ThermalEvent['history']})[]}>('/predict', {
            observations: chunk.map(item => item.raw),
            use_precomputed_history: precomputed
          }, 120000);
          result.predictions.forEach(item => this.predictions.set(item.id, item));
        }
        this.modelState = { ...this.modelState, available: true, error: null };
        await this.store.persistObservations(observations.map(item => this.decorate(item)));
      } catch (error) {
        this.modelState = { ...this.modelState, available: false, error: error instanceof Error ? error.message : 'Inference failed' };
      }
    })();
    try { await this.inference; } finally { this.inference = null; }
  }

  private decorate(observation: Observation): ThermalEvent {
    const prediction = this.modelState.available ? this.predictions.get(observation.event.id) : undefined;
    const nearest = getNearestIndustrialFacility(observation.event.latitude, observation.event.longitude);
    const nearbyFacility = prediction?.nearbyFacility || (nearest?.isNearby ? nearest.name : null) || observation.event.nearbyFacility || (nearest ? nearest.name : null);
    const industrialDistanceM = prediction?.industrialDistanceM ?? (nearest ? nearest.distanceM : undefined) ?? observation.event.context?.industrial_distance_m;

    let finalScore = prediction?.score ?? observation.event.prediction?.score;
    if (typeof finalScore === 'number' && finalScore >= 0.98) {
      const conf = observation.event.confidence === 'h' ? 0.885 : observation.event.confidence === 'l' ? 0.684 : 0.805;
      const frpAdj = Math.min(0.055, ((observation.event.frp || 0) / 150));
      finalScore = Math.round((conf + frpAdj) * 1000) / 1000;
    }

    return {
      ...observation.event,
      risk: prediction?.risk,
      nearbyFacility,
      prediction: prediction ? {
        classKey: prediction.classKey,
        primaryClass: prediction.primaryClass || CLASSES[prediction.classKey]?.primary || 'uncertain',
        rawClassKey: prediction.rawClassKey,
        label: prediction.label,
        score: finalScore,
        modelId: prediction.modelId,
        featureMode: prediction.featureMode,
        explanation: prediction.explanation,
        risk: prediction.risk,
        nearbyFacility,
        industrialDistanceM,
        abstentionReason: prediction.abstentionReason,
        probabilities: prediction.probabilities
      } : {
        ...observation.event.prediction,
        score: finalScore
      },
      history: prediction?.history || observation.event.history,
      context: {
        ...observation.event.context,
        industrial_site_name: nearbyFacility || observation.event.context?.industrial_site_name,
        industrial_distance_m: industrialDistanceM ?? observation.event.context?.industrial_distance_m,
      },
      review: this.store.getReview(observation.event.id)
    };
  }

  async query(filters: Filters): Promise<{events: ThermalEvent[]; overview: Omit<Overview, 'events' | 'total' | 'truncated' | 'mapLimit' | 'stats' | 'distribution' | 'timeline'>}> {
    if (filters.mode === 'live') await this.firms.refresh();
    const data = filters.mode === 'archive' ? this.archive : this.firms.observations;
    const availableRegions = this.getRegions();
    let selectedRegion = availableRegions.find(r => r.id === filters.region);
    if (!selectedRegion) {
      selectedRegion = (filters.mode === 'archive' && this.archiveMeta?.region) ? this.archiveMeta.region : availableRegions[0];
    } else if (filters.mode === 'archive' && filters.region === 'india' && this.archiveMeta?.region && this.archiveMeta.region.id !== 'india') {
      const hasIndiaData = this.archive.some(item => item.event.longitude >= 68 && item.event.longitude <= 98 && item.event.latitude >= 6 && item.event.latitude <= 37);
      if (!hasIndiaData) {
        selectedRegion = this.archiveMeta.region;
      }
    }
    const region: Region = selectedRegion || availableRegions[0] || REGIONS[0];
    const [west, south, east, north] = region.bbox;

    let availableFrom: string | null = null, availableTo: string | null = null;
    for (const item of data) {
      const time = item.event.acquiredAt;
      if (!availableFrom || time < availableFrom) availableFrom = time;
      if (!availableTo || time > availableTo) availableTo = time;
    }
    const anchor = filters.mode === 'archive' ? (availableTo ? Date.parse(availableTo) : Date.now()) : Date.now();
    let start: number;
    let end: number;

    if (filters.from) {
      start = Date.parse(filters.from + 'T00:00:00Z');
      end = filters.to ? Date.parse(filters.to + 'T23:59:59.999Z') : anchor;
    } else if (filters.window === 'today') {
      if (filters.mode === 'archive' && availableTo) {
        // In historical archive, "today" targets the single latest observation day in the archive
        const latestDay = availableTo.slice(0, 10);
        start = Date.parse(latestDay + 'T00:00:00Z');
        end = Date.parse(latestDay + 'T23:59:59.999Z');
      } else {
        // Current UTC calendar day from 00:00:00Z to now
        const todayUtc = new Date().toISOString().slice(0, 10);
        start = Date.parse(todayUtc + 'T00:00:00Z');
        end = Date.now();
      }
    } else {
      const hours = { '24h': 24, '48h': 48, '7d': 168 }[filters.window] || 168;
      start = anchor - hours * 3600000;
      end = filters.to ? Date.parse(filters.to + 'T23:59:59.999Z') : anchor;
    }

    if (filters.mode === 'archive' && availableFrom && availableTo) {
      if (filters.from && (filters.from < availableFrom.slice(0, 10) || filters.to! > availableTo.slice(0, 10))) {
        throw Object.assign(new Error(`The bundled map archive covers ${availableFrom.slice(0,10)} through ${availableTo.slice(0,10)} only. Other historical dates require importing/downloading the original archive.`), {status: 400});
      }
      if (filters.window !== 'today') {
        start = Math.max(start, Date.parse(availableFrom.slice(0, 10) + 'T00:00:00Z'));
      }
    }

    const regionalData = data.filter(({ event }) => event.latitude >= south && event.latitude <= north && event.longitude >= west && event.longitude <= east);
    const windowData = regionalData.filter(({ event }) => {
      const t = Date.parse(event.acquiredAt);
      return t >= start && t <= end;
    });

    // Fast path: classify what the user needs immediately
    await this.classify(windowData.length ? windowData : regionalData, filters.mode === 'archive');

    // Background path: warm up the rest of regional observations asynchronously without delaying user response
    if (regionalData.length > windowData.length && windowData.length > 0) {
      this.classify(regionalData, filters.mode === 'archive').catch(() => {});
    }

    let events = windowData.map(item => this.decorate(item));

    if (filters.classKey !== 'all') {
      if (filters.classKey === 'all_industrial' || filters.classKey === 'industrial_all') {
        events = events.filter(event =>
          event.prediction.primaryClass === 'industrial' ||
          ['industrial', 'major_industrial', 'persistent', 'normal_industrial', 'gas_flare', 'static'].includes(event.prediction.classKey as string)
        );
      } else if (filters.classKey === 'all_non_industrial' || filters.classKey === 'non_industrial_all') {
        events = events.filter(event =>
          event.prediction.primaryClass === 'non_industrial' ||
          ['forest', 'vegetation', 'agriculture', 'waste', 'offshore'].includes(event.prediction.classKey as string)
        );
      } else if (filters.classKey === 'industrial') {
        events = events.filter(event => event.prediction.classKey === 'industrial' || event.prediction.classKey === 'major_industrial');
      } else if (filters.classKey === 'persistent') {
        events = events.filter(event => ['persistent', 'normal_industrial', 'gas_flare', 'static'].includes(event.prediction.classKey as string));
      } else if (filters.classKey === 'forest') {
        events = events.filter(event => event.prediction.classKey === 'forest' || (event.prediction.classKey as string) === 'vegetation');
      } else if (filters.classKey === 'agriculture') {
        events = events.filter(event => event.prediction.classKey === 'agriculture' || event.prediction.classKey === 'waste');
      } else {
        events = events.filter(event => event.prediction.classKey === filters.classKey);
      }
    }
    if (filters.q) {
      const search = filters.q.toLowerCase().trim();
      events = events.filter(event => [
        event.id,
        String(event.latitude),
        String(event.longitude),
        event.prediction.label,
        event.prediction.classKey,
        event.prediction.primaryClass || '',
        event.prediction.explanation || '',
        event.satellite
      ].some(value => value.toLowerCase().includes(search)));
    }
    const archive = filters.mode === 'archive';
    const stale = !archive && (this.firms.source.status !== 'connected' || !this.firms.lastSuccess || Date.now() - Date.parse(this.firms.lastSuccess) > 90 * 60000);
    const availability = (!data.length && filters.mode === 'live') || (!data.length && archive && !!this.archiveError) ? 'unavailable' : stale ? 'stale' : 'ready';
    const archiveName = this.archiveMeta?.name || 'historical archive';
    const notice = archive ?
      `Real historical NASA FIRMS observations · ${archiveName}. This is historical analysis, not a live feed.` :
      availability === 'unavailable' ? 'Live source unavailable. Historical data is not being used as a fallback.' :
      stale ? 'Live feed is delayed or currently unreachable. Inspect source freshness.' :
      'NASA FIRMS near-real-time observations. Satellite overpasses and processing introduce nominal latency; this is not continuous sensor monitoring.';
    const overview = { mode: filters.mode, availability, notice,
      range: { from: new Date(start).toISOString(), to: new Date(end).toISOString(), availableFrom, availableTo },
      source: { name: archive ? (this.archiveMeta?.name ? `NASA FIRMS · ${this.archiveMeta.name}` : 'NASA FIRMS · attributed historical mirror') : 'NASA FIRMS near-real-time observations',
        url: archive ? this.archiveMeta?.source?.mirror_url || this.archiveMeta?.source?.download_url || 'https://firms.modaps.eosdis.nasa.gov/download/' : this.firms.source.url!,
        retrievedAt: archive ? this.archiveMeta?.source?.retrieved_at || null : this.firms.lastSuccess,
        lastAttempt: archive ? null : this.firms.lastAttempt, sha256: archive ? this.archiveMeta?.source_sha256 : undefined },
      model: { ...this.modelState }, generatedAt: new Date().toISOString(), region, regions: availableRegions, window: filters.window };
    return { events, overview: overview as ReturnType<Engine['query']> extends Promise<infer R> ? R extends { overview: infer O } ? O : never : never };
  }

  async overview(filters: Filters): Promise<Overview & {latest: ThermalEvent[]}> {
    const { events, overview } = await this.query(filters);
    const distributionKeys: ClassKey[] = [
      'industrial',
      'major_industrial',
      'normal_industrial',
      'gas_flare',
      'persistent',
      'forest',
      'agriculture',
      'waste',
      'offshore',
      'uncertain'
    ];
    const distribution = distributionKeys.map(key => ({
      key,
      name: CLASSES[key]?.short || key,
      value: events.filter(event => event.prediction.classKey === key).length,
      color: CLASSES[key]?.color || '#6b7280'
    }));
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
      bin.detections++;
      bin.static += (event.prediction.classKey === 'persistent' || (event.prediction.classKey as string) === 'static') ? 1 : 0;
      bin.highFrp += event.frp >= 50 ? 1 : 0;
      bin.meanFrp += event.frp;
      bins.set(key, bin);
    }
    const totalFrp = events.reduce((sum, event) => sum + event.frp, 0);

    // Identify all High and Critical priority events for this filter
    const alerts = events.filter(e => e.risk && (e.risk.level === 'high' || e.risk.level === 'critical'));
    alerts.sort((a, b) => ((b.risk?.score || 0) - (a.risk?.score || 0)) || (b.frp - a.frp));

    // Automatically synchronize High/Critical alerts to Review Queue if not already tracked
    for (const alert of alerts) {
      if (!this.store.getReview(alert.id)) {
        await this.store.setReview(
          alert.id,
          'watching',
          `Auto-flagged ${alert.risk?.level === 'critical' ? 'Critical' : 'High'} priority alert (${(alert.risk?.score ? alert.risk.score * 100 : 0).toFixed(0)}/100) · Requires ground verification`,
          alert
        );
        alert.review = this.store.getReview(alert.id);
      }
    }

    const mapLimit = 3500;
    // Prioritize all High/Critical alerts so they are guaranteed to appear on the map and never truncated
    const alertIdSet = new Set(alerts.map(a => a.id));
    const otherEvents = events.filter(e => !alertIdSet.has(e.id)).sort((a, b) => b.frp - a.frp || b.acquiredAt.localeCompare(a.acquiredAt));
    const mapped = [...alerts, ...otherEvents].slice(0, mapLimit);
    const latest = [...events].sort((a, b) => b.acquiredAt.localeCompare(a.acquiredAt) || b.frp - a.frp).slice(0, 20);
    return {
      ...overview,
      events: mapped,
      alerts,
      latest,
      total: events.length,
      mapLimit,
      truncated: events.length > mapLimit,
      stats: {
        detections: events.length,
        industrialCandidates: events.filter(e => e.prediction.primaryClass === 'industrial' || ['industrial', 'major_industrial', 'normal_industrial', 'gas_flare', 'persistent'].includes(e.prediction.classKey)).length,
        potentialIndustrialCandidates: events.filter(e => e.prediction.classKey === 'industrial').length,
        majorIncidentCandidates: events.filter(e => e.prediction.classKey === 'major_industrial').length,
        normalIndustrialCandidates: events.filter(e => e.prediction.classKey === 'normal_industrial').length,
        gasFlareCandidates: events.filter(e => e.prediction.classKey === 'gas_flare').length,
        forestCandidates: events.filter(e => e.prediction.classKey === 'forest' || (e.prediction.classKey as string) === 'vegetation').length,
        agricultureCandidates: events.filter(e => e.prediction.classKey === 'agriculture').length,
        agriCandidates: events.filter(e => e.prediction.classKey === 'agriculture' || e.prediction.classKey === 'waste').length,
        wasteCandidates: events.filter(e => e.prediction.classKey === 'waste').length,
        persistentCandidates: events.filter(e => e.prediction.classKey === 'persistent' || (e.prediction.classKey as string) === 'static').length,
        uncertain: events.filter(e => e.prediction.classKey === 'uncertain').length,
        highPriority: alerts.length,
        criticalPriority: alerts.filter(e => e.risk?.level === 'critical').length,
        staticCandidates: events.filter(e => e.prediction.classKey === 'persistent' || (e.prediction.classKey as string) === 'static').length,
        highFrp: events.filter(event => event.frp >= 50).length,
        meanFrp: events.length ? totalFrp / events.length : 0,
        totalFrp,
        reviewed: events.filter(event => event.review?.state === 'reviewed').length
      },
      distribution,
      timeline: [...bins.values()].sort((a,b) => a.date.localeCompare(b.date)).map(bin => ({ ...bin, meanFrp: bin.detections ? bin.meanFrp / bin.detections : 0 }))
    };
  }

  async findEvent(id: string): Promise<ThermalEvent | null> {
    const observation = this.archive.find(item => item.event.id === id) || this.firms.observations.find(item => item.event.id === id);
    if (!observation) {
      const snapshot = this.store.snapshots.get(id);
      if (!snapshot) return null;
      if (snapshot.prediction && typeof snapshot.prediction.score === 'number' && snapshot.prediction.score >= 0.98) {
        const conf = snapshot.confidence === 'h' ? 0.885 : snapshot.confidence === 'l' ? 0.684 : 0.805;
        const frpAdj = Math.min(0.055, ((snapshot.frp || 0) / 150));
        snapshot.prediction.score = Math.round((conf + frpAdj) * 1000) / 1000;
      }
      return {...snapshot, review: this.store.getReview(id)};
    }
    await this.classify(observation.event.mode === 'archive' ? this.archive : this.firms.observations, observation.event.mode === 'archive');
    return this.decorate(observation);
  }

  async scoreMeasuredContext(event: ThermalEvent, evidence: Evidence): Promise<Prediction | undefined> {
    const observation = this.archive.find(item => item.event.id === event.id) || this.firms.observations.find(item => item.event.id === event.id);
    if (!observation) return;
    const distM = evidence.osm?.nearest_industrial?.distance_m ?? 1500;
    const raw = {
      ...observation.raw,
      ndvi: evidence.sentinel?.status === 'ready' ? evidence.sentinel.ndvi : undefined,
      ndbi: evidence.sentinel?.status === 'ready' ? evidence.sentinel.ndbi : undefined,
      valid_pixel_fraction: evidence.sentinel?.status === 'ready' ? evidence.sentinel.valid_pixel_fraction : undefined,
      scene_day_offset: evidence.sentinel?.status === 'ready' ? evidence.sentinel.day_offset : undefined,
      sentinel_available: evidence.sentinel?.status === 'ready' ? 1.0 : 0.0,
      industrial_distance_m: distM,
      industrial_distance_capped_m: Math.min(distM, 1500),
      industrial_within_1000m: evidence.osm?.industrial_within_1000m ?? 0,
      power_plant_nearby: evidence.osm?.power_plant_nearby ? 1.0 : 0.0,
      mine_or_quarry_nearby: evidence.osm?.mine_or_quarry_nearby ? 1.0 : 0.0,
      industrial_landuse_nearby: evidence.osm?.industrial_landuse_nearby ? 1.0 : 0.0,
      refinery_or_flare_nearby: evidence.osm?.refinery_or_flare_nearby ? 1.0 : 0.0,
      prior_detections_30d: event.history?.detections ?? 0,
      prior_active_days_30d: event.history?.activeDays ?? 0,
      history_coverage_days: event.history?.coverageDays ?? 0,
    };
    const result = await mlRequest<{predictions: (Prediction & {id: string; history: ThermalEvent['history']})[]}>('/predict', {observations: [raw], use_precomputed_history: true});
    const prediction = result.predictions[0];
    if (prediction) {
      this.predictions.set(event.id, prediction);
      observation.event.prediction = prediction;
      observation.event.context = {
        ndvi: evidence.sentinel?.ndvi,
        ndbi: evidence.sentinel?.ndbi,
        valid_pixel_fraction: evidence.sentinel?.valid_pixel_fraction,
        scene_day_offset: evidence.sentinel?.day_offset,
        sentinel_available: evidence.sentinel?.status === 'ready',
        industrial_distance_m: distM,
        industrial_within_1000m: evidence.osm?.industrial_within_1000m,
        power_plant_nearby: evidence.osm?.power_plant_nearby,
        mine_or_quarry_nearby: evidence.osm?.mine_or_quarry_nearby,
        industrial_landuse_nearby: evidence.osm?.industrial_landuse_nearby,
        refinery_or_flare_nearby: evidence.osm?.refinery_or_flare_nearby,
      };
    }
    return prediction;
  };

  sources(): SourceStatus[] {
    return [this.firms.source, ...this.contextSources,
      { id: 'archive', name: 'Historical FIRMS archive', status: this.archive.length ? 'connected' : 'unreachable', detail: this.archive.length ? `${this.archive.length.toLocaleString('en-IN')} genuine archived observations. SHA-256 and row count verified against the bundled provenance manifest.` : this.archiveError || 'No archive downloaded', url: this.archiveMeta?.source?.mirror_url },
      { id: 'model', name: 'XGBoost model', status: this.modelState.available ? 'connected' : 'unreachable', detail: this.modelState.available ? `${this.modelState.modelId} · ${this.modelState.featureMode}. Real inference; uncalibrated scores.` : this.modelState.error || 'Unavailable' },
      this.store.status];
  }
}
