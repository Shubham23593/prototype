export type DataMode = 'archive' | 'live';
export type PrimaryClass = 'industrial' | 'non_industrial' | 'uncertain';
export type WindowSize = 'today' | '24h' | '48h' | '7d';
export type FilterCategory = 'all' | 'all_industrial' | 'all_non_industrial' | ClassKey;
export type ClassKey =
  | 'normal_industrial'
  | 'persistent'
  | 'gas_flare'
  | 'industrial'
  | 'major_industrial'
  | 'forest'
  | 'agriculture'
  | 'waste'
  | 'offshore'
  | 'uncertain'
  | 'unclassified'
  | 'vegetation'
  | 'static';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type SourceState = 'connected' | 'unreachable' | 'not_configured' | 'idle' | 'local' | 'degraded';
export type Page = 'overview' | 'observations' | 'watchlist' | 'history' | 'model' | 'sources';

export interface RiskAssessment {
  score: number;
  level: RiskLevel;
  hazard: number;
  exposure: number;
  confidence: number;
  factors: string[];
  formula?: string;
}

export interface Prediction {
  classKey: ClassKey;
  primaryClass?: PrimaryClass;
  rawClassKey?: string;
  label: string;
  score: number | null;
  modelId: string | null;
  featureMode?: string;
  abstentionReason?: string | null;
  explanation?: string;
  risk?: RiskAssessment;
  nearbyFacility?: string | null;
  industrialDistanceM?: number | null;
  probabilities: { key: string; label: string; score: number }[];
}
export interface Review {
  state: 'watching' | 'reviewed'; note: string; updatedAt: string;
}
export interface ThermalEvent {
  id: string; latitude: number; longitude: number; acquiredAt: string;
  frp: number; brightness: number; backgroundBrightness: number;
  scan: number; track: number; confidence: string; satellite: string; daynight: string;
  mode: DataMode; nasaType: number | null; prediction: Prediction;
  risk?: RiskAssessment;
  nearbyFacility?: string | null;
  history: { detections: number; activeDays: number; coverageDays: number } | null;
  context?: {
    ndvi?: number; ndbi?: number; valid_pixel_fraction?: number; scene_day_offset?: number; sentinel_available?: boolean;
    industrial_distance_m?: number; industrial_within_1000m?: number; power_plant_nearby?: boolean;
    mine_or_quarry_nearby?: boolean; industrial_landuse_nearby?: boolean; refinery_or_flare_nearby?: boolean;
    industrial_site_name?: string | null;
  };
  review?: Review | null;
}
export interface SourceStatus {
  id: string; name: string; status: SourceState; detail: string; url?: string;
  lastAttempt?: string | null; lastSuccess?: string | null; observedThrough?: string | null;
  authConfigured?: boolean; cadence?: string;
  recordsFetched?: number; selectedSource?: string;
  acquisitionRange?: { from: string; to: string } | null;
  error?: string | null;
  errorMessage?: string | null;
}
export interface Region {
  id: string; name: string; bbox: [number, number, number, number]; center: [number, number]; zoom: number;
}
export interface Overview {
  mode: DataMode; availability: 'ready' | 'unavailable' | 'stale'; notice: string;
  events: ThermalEvent[]; alerts?: ThermalEvent[]; total: number; mapLimit: number; truncated: boolean;
  stats: {
    detections: number;
    industrialCandidates: number;
    potentialIndustrialCandidates?: number;
    majorIncidentCandidates?: number;
    normalIndustrialCandidates?: number;
    gasFlareCandidates?: number;
    forestCandidates: number;
    agricultureCandidates: number;
    agriCandidates?: number;
    wasteCandidates?: number;
    persistentCandidates: number;
    uncertain: number;
    highPriority: number;
    criticalPriority?: number;
    meanFrp: number;
    totalFrp: number;
    reviewed: number;
    staticCandidates?: number;
    highFrp?: number;
    lastRefreshedAt?: string;
  };
  distribution: { key: ClassKey; name: string; value: number; color: string }[];
  timeline: { date: string; detections: number; static: number; highFrp: number; meanFrp: number }[];
  range: { from: string | null; to: string | null; availableFrom: string | null; availableTo: string | null };
  source: { name: string; url: string; retrievedAt: string | null; lastAttempt: string | null; sha256?: string };
  model: { available: boolean; modelId: string | null; featureMode: string | null; error?: string | null };
  generatedAt: string; region: Region; regions?: Region[]; window: string;
}
export interface ClassMetric { precision: number; recall: number; 'f1-score': number; support: number }
export interface Evaluation {
  available: boolean; rows: number; accuracy: number; balanced_accuracy: number; macro_f1: number;
  majority_baseline_accuracy: number; majority_baseline_macro_f1: number;
  confusion_matrix: number[][]; per_class: Record<string, ClassMetric>; date_start: string; date_end: string; note: string;
}
export interface Provenance {
  name: string; primary_source: string; primary_url: string; download_url: string; mirror_url?: string;
  mirror_commit?: string; sha256: string; bytes: number; retrieved_at: string; notes: string[];
}
export interface ModelCard {
  status: string; model_id: string; trained_at: string; algorithm: string; feature_mode: string;
  target: string; classes: {code: number; key: string; label: string; rows: number}[];
  feature_names: string[]; features: { name: string; importance: number }[];
  metrics: { spatial_temporal: Evaluation; temporal: Evaluation };
  dataset: { rows: number; train_rows: number; test_rows: number; temporal_test_rows: number; date_start: string; date_end: string; sha256: string;
    quality: { input_rows: number; valid_rows: number; invalid_or_unsupported_rows: number; duplicates_removed: number }; provenance: Provenance };
  split: { method: string; cutoff: string; seed: number; train_blocks: number; test_blocks: number; overlapping_blocks: number; history: string; test_used_for_tuning: boolean };
  warnings: string[]; artifact_sha256: string; abstention_threshold: number;
}
export interface TrainingJob { id: string; status: 'queued' | 'running' | 'completed' | 'failed'; message: string; created_at: string; completed_at?: string }
export interface Evidence {
  cached: boolean;
  prediction?: Prediction;
  osm: { status: string; message?: string; source: string; fetched_at?: string; snapshot_at?: string; note?: string;
    nearest_industrial?: {name: string; distance_m: number; tags: Record<string, string>; url: string} | null;
    features?: { id: string; name: string; distance_m: number; industrial: boolean; latitude: number; longitude: number; tags: Record<string,string>; url: string }[];
    total_features?: number; industrial_within_1000m?: number; industrial_distance_m?: number;
    power_plant_nearby?: boolean; mine_or_quarry_nearby?: boolean; industrial_landuse_nearby?: boolean; refinery_or_flare_nearby?: boolean; };
  sentinel: { status: string; source: string; message?: string; note?: string; ndvi?: number; ndbi?: number; scene_id?: string; acquired_at?: string;
    scene_cloud_percent?: number; valid_pixel_fraction?: number; catalog_url?: string; thumbnail_url?: string; day_offset?: number; method?: string; sentinel_available?: boolean };
  population: { status: string; source: string; message?: string; estimated_people?: number; reference_year?: string; radius_m?: number; note?: string };
}
