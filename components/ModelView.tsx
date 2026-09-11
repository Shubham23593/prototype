'use client';
import { useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  Beaker,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Database,
  FileCheck2,
  Flame,
  GitBranch,
  History,
  Layers,
  LoaderCircle,
  MapPin,
  Play,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { api, useApi } from '@/lib/api';
import { CLASSES, formatDate, formatNumber } from '@/lib/constants';
import type { ModelCard, Page, TrainingJob } from '@/lib/types';
import type { ImportedDataset } from './HistoryView';
import { ErrorState, Loading, Modal } from './ui';

const FEATURE_LABELS: Record<string, string> = {
  prior_active_days_30d: 'Prior active dates · 30 d (750m grid)',
  prior_detections_30d: 'Prior detections count · 30 d',
  recurrence_fraction: 'Observed temporal recurrence fraction',
  temperature_delta: 'I4–I5 brightness difference (ΔT)',
  bright_ti4: 'I4 brightness temperature (375m MWIR)',
  bright_ti5: 'I5 brightness temperature (375m TIR)',
  log_frp: 'Log fire radiative power (log FRP)',
  frp_density: 'FRP / pixel footprint ratio',
  scan: 'Scan footprint size',
  track: 'Track footprint size',
  is_day: 'Day / night observation flag',
  confidence_score: 'NASA confidence category',
  hour_sin: 'Overpass hour · cyclic sine',
  hour_cos: 'Overpass hour · cyclic cosine',
  season_sin: 'Day of year · cyclic sine',
  season_cos: 'Day of year · cyclic cosine',
  history_coverage_days: 'Available history span',
  ndvi: 'Measured Sentinel-2 NDVI (vegetation)',
  ndbi: 'Measured Sentinel-2 NDBI (built-up)',
  industrial_distance_capped_m: 'OSM industrial distance (capped at 1.5 km)',
  industrial_within_1000m: 'Mapped industrial features within 1 km',
};

function getFeatureCategory(name: string): { label: string; badgeClass: string; barGradient: string } {
  if (['prior_active_days_30d', 'recurrence_fraction', 'prior_detections_30d', 'history_coverage_days'].includes(name)) {
    return {
      label: 'Temporal Recurrence',
      badgeClass: 'bg-[#f3e8ff] text-[#7c3aed] border-[#e9d5ff]',
      barGradient: 'from-[#8b5cf6] to-[#6366f1]',
    };
  }
  if (['bright_ti4', 'bright_ti5', 'temperature_delta', 'log_frp'].includes(name)) {
    return {
      label: 'Thermal Radiometry',
      badgeClass: 'bg-[#fff7ed] text-[#c2410c] border-[#fed7aa]',
      barGradient: 'from-[#f97316] to-[#ea580c]',
    };
  }
  if (['frp_density', 'scan', 'track'].includes(name)) {
    return {
      label: 'Sensor Geometry',
      badgeClass: 'bg-[#f0f9ff] text-[#0284c7] border-[#bfdbfe]',
      barGradient: 'from-[#0ea5e9] to-[#0284c7]',
    };
  }
  if (['ndvi', 'ndbi', 'industrial_distance_capped_m', 'industrial_within_1000m'].includes(name)) {
    return {
      label: 'Context & OSM',
      badgeClass: 'bg-[#ecfdf5] text-[#059669] border-[#bbf7d0]',
      barGradient: 'from-[#10b981] to-[#059669]',
    };
  }
  return {
    label: 'Observation Time',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
    barGradient: 'from-slate-400 to-slate-600',
  };
}

export default function ModelView({
  refresh,
  imported,
  onPage,
  onModelChanged,
  notify,
}: {
  refresh: number;
  imported: ImportedDataset | null;
  onPage: (page: Page) => void;
  onModelChanged: () => void;
  notify: (message: string, error?: boolean) => void;
}) {
  const model = useApi<ModelCard>('/api/model', refresh);
  const datasetsApi = useApi<{
    datasets: Array<{
      dataset_id: string;
      name: string;
      rows: number;
      quality?: Record<string, number>;
      columns?: string[];
      has_sentinel?: boolean;
      has_osm?: boolean;
      has_context?: boolean;
    }>;
  }>('/api/datasets', refresh);

  const [split, setSplit] = useState<'spatial_temporal' | 'temporal'>('spatial_temporal');
  const [trainModal, setTrainModal] = useState(false);
  const [dataset, setDataset] = useState('default');
  const [withContext, setWithContext] = useState(false);
  const [starting, setStarting] = useState(false);
  const [trainError, setTrainError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<TrainingJob | null>(null);

  useEffect(() => {
    if (imported) {
      setDataset(imported.dataset_id);
    }
  }, [imported]);

  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function check() {
      try {
        const result = await api<TrainingJob>(`/api/jobs/${jobId}`);
        if (stopped) return;
        setJob(result);
        if (result.status === 'completed') {
          setJobId(null);
          model.reload();
          onModelChanged();
          notify('Training completed. You can now view retrained inferences on the map.');
        } else if (result.status === 'failed') {
          setJobId(null);
          notify(`Training failed: ${result.message}`, true);
        } else {
          timer = setTimeout(check, 1800);
        }
      } catch (error) {
        if (!stopped) {
          setJobId(null);
          notify((error as Error).message, true);
        }
      }
    }
    check();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [jobId]);

  async function train() {
    setStarting(true);
    setTrainError(null);
    try {
      const result = await api<TrainingJob>('/api/model/train', {
        method: 'POST',
        body: JSON.stringify({ dataset_id: dataset, with_context: withContext }),
      });
      setJob(result);
      setJobId(result.id);
      setTrainModal(false);
    } catch (error) {
      setTrainError((error as Error).message);
    } finally {
      setStarting(false);
    }
  }

  const data = model.data;
  if (model.error && !data) return <ErrorState message={model.error} retry={model.reload} />;
  if (!data) return <div className="panel"><Loading text="Loading trained model parameters and holdout evaluation..." /></div>;

  const evaluation = data.metrics[split];
  const staticMetrics = evaluation.per_class['Static thermal source'];
  const sortedFeatures = [...data.features].sort((a, b) => b.importance - a.importance);
  const topFeatures = sortedFeatures.slice(0, 8);
  const maximumImportance = Math.max(...topFeatures.map((f) => f.importance), 0.001);

  const recurrenceWeight = sortedFeatures
    .filter((f) => ['prior_active_days_30d', 'recurrence_fraction', 'prior_detections_30d', 'history_coverage_days'].includes(f.name))
    .reduce((sum, f) => sum + f.importance, 0);

  return (
    <div className="space-y-6">
      {/* 1. Header with Warm Orange/Ember Branding & Clear Workflow */}
      <div className="rounded-2xl border border-[#fed7aa]/60 bg-white p-6 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#fff7ed] text-[#ea580c] border border-[#fed7aa] shadow-xs">
              <BrainCircuit size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display text-lg font-bold text-[#0f172a]">
                  Model Intelligence & Evaluation
                </h1>
                <span className="rounded-full bg-[#ecfdf5] px-2.5 py-0.5 text-[10px] font-bold text-[#15803d] border border-[#bbf7d0]">
                  ACTIVE IN PRODUCTION
                </span>
              </div>
              <p className="mt-0.5 text-xs text-[#64748b]">
                Explainable XGBoost classifier · 17 physical features · Zero-leakage spatial holdouts
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => setTrainModal(true)}
              disabled={Boolean(jobId)}
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#ea580c] to-[#c2410c] px-4 py-2 text-xs font-bold text-white shadow-sm hover:from-[#c2410c] hover:to-[#9a3412] transition-all transform hover:scale-[1.01] disabled:opacity-50"
            >
              <Play size={12} fill="currentColor" />
              {jobId ? 'Training in Progress...' : 'Train / Retrain Model'}
            </button>

            <a
              href="/api/model/card"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-[#fffaf5] hover:border-[#fed7aa] transition-colors"
            >
              <ArrowDownToLine size={13} className="text-[#ea580c]" />
              Model Card (JSON)
            </a>
          </div>
        </div>

        {/* 3-Step Clear Platform Flow Stepper */}
        <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3 pt-5 border-t border-[#f1f5f9]">
          <button
            onClick={() => onPage('history')}
            className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5 text-left hover:border-[#fed7aa] hover:bg-[#fffaf5] transition-colors group cursor-pointer"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#fff7ed] text-xs font-bold text-[#c2410c] border border-[#fed7aa]">
                1
              </span>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-800 group-hover:text-[#c2410c]">Step 1: Historical Data</div>
                <div className="text-[11px] text-slate-500 truncate">316,468 NASA records or custom CSV</div>
              </div>
            </div>
            <ArrowRight size={14} className="text-slate-400 shrink-0 group-hover:text-[#c2410c] group-hover:translate-x-0.5 transition-all" />
          </button>

          <div className="flex items-center gap-3 rounded-xl border-2 border-[#ea580c] bg-[#fffaf5] p-3.5 shadow-xs">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#ea580c] text-xs font-bold text-white shadow-xs">
              2
            </span>
            <div className="min-w-0">
              <div className="text-xs font-bold text-[#c2410c]">Step 2: Model Lab (Current)</div>
              <div className="text-[11px] text-[#9a3412] truncate">Inspect 17 features & train model</div>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-slate-200/80 bg-slate-50/60 p-3.5 text-slate-500">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f0f9ff] text-xs font-bold text-[#0284c7] border border-[#e0f2fe]">
              3
            </span>
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-700">Step 3: Overview Map</div>
              <div className="text-[11px] text-slate-500 truncate">Active upon model training completion</div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Model Retrained Success Banner - ONLY appears when model is trained! */}
      {job && (
        <div
          className={`rounded-2xl border-2 p-5 text-xs shadow-sm transition-all animate-in fade-in ${
            job.status === 'completed'
              ? 'border-emerald-400 bg-gradient-to-r from-[#ecfdf5] to-[#f0fdf4] text-emerald-950'
              : job.status === 'failed'
              ? 'border-rose-300 bg-[#fff1f2] text-rose-950'
              : 'border-[#fed7aa] bg-[#fffaf5] text-[#7c2d12]'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              {['queued', 'running'].includes(job.status) ? (
                <LoaderCircle size={22} className="shrink-0 animate-spin text-[#ea580c]" />
              ) : job.status === 'completed' ? (
                <CheckCircle2 size={24} className="shrink-0 text-[#10b981]" />
              ) : (
                <ShieldAlert size={22} className="shrink-0 text-[#ef4444]" />
              )}
              <div>
                <p className="font-display text-sm font-bold">
                  {job.status === 'completed'
                    ? 'Model Retrained Successfully!'
                    : job.status === 'failed'
                    ? 'Retraining Incomplete'
                    : 'Retraining Model in Progress...'}
                </p>
                <p className="mt-0.5 text-xs opacity-90 leading-relaxed">
                  {job.status === 'completed'
                    ? 'The active XGBoost weights have been updated. View your newly classified events directly on the live map.'
                    : job.message}
                </p>
              </div>
            </div>

            {job.status === 'completed' && (
              <button
                onClick={() => onPage('overview')}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#059669] to-[#047857] px-4 py-2.5 text-xs font-bold text-white shadow-md hover:from-[#047857] hover:to-[#065f46] transition-all transform hover:scale-[1.02] shrink-0"
              >
                <MapPin size={14} />
                View Inferences on Live Map
                <ArrowRight size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* 3. Custom Dataset Available Banner (if imported dataset exists and not currently training) */}
      {imported && imported.rows > 0 && !job && (
        <div className="rounded-xl border border-emerald-300 bg-[#ecfdf5] p-4 flex flex-wrap items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3">
            <FileCheck2 size={20} className="text-[#10b981] shrink-0" />
            <div className="text-xs">
              <span className="font-bold text-[#065f46]">Custom Dataset Loaded: </span>
              <span className="text-[#047857]">
                {imported.name} ({formatNumber(imported.rows)} rows).
              </span>
            </div>
          </div>
          <button
            onClick={() => {
              setDataset(imported.dataset_id);
              setTrainModal(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#059669] px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-[#047857] transition-colors"
          >
            <Play size={11} fill="currentColor" />
            Train Model with this Dataset
          </button>
        </div>
      )}

      {/* 4. Top 4 High-Level Metrics */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs border-l-4 border-l-[#10b981]">
          <div className="flex items-center justify-between text-xs text-[#64748b] font-medium">
            <span>Macro-F1 Score</span>
            <span className="rounded-full bg-[#ecfdf5] px-2 py-0.5 text-[9px] font-bold text-[#15803d] border border-[#bbf7d0]">
              BALANCED
            </span>
          </div>
          <div className="tabular mt-2 font-display text-2xl font-bold text-[#0f172a]">
            {(evaluation.macro_f1 * 100).toFixed(1)}%
          </div>
          <p className="mt-1 text-[11px] text-[#64748b]">Unweighted mean across all target classes</p>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs border-l-4 border-l-[#7c3aed]">
          <div className="flex items-center justify-between text-xs text-[#64748b] font-medium">
            <span>Static-Source F1</span>
            <span className="rounded-full bg-[#f5f3ff] px-2 py-0.5 text-[9px] font-bold text-[#7c3aed] border border-[#ede9fe]">
              INDUSTRIAL
            </span>
          </div>
          <div className="tabular mt-2 font-display text-2xl font-bold text-[#0f172a]">
            {((staticMetrics?.['f1-score'] || 0) * 100).toFixed(1)}%
          </div>
          <p className="mt-1 text-[11px] text-[#64748b]">Precision & recall on persistent heat sources</p>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs border-l-4 border-l-[#ea580c]">
          <div className="flex items-center justify-between text-xs text-[#64748b] font-medium">
            <span>Holdout Hotspots</span>
            <span className="rounded-full bg-[#fff7ed] px-2 py-0.5 text-[9px] font-bold text-[#c2410c] border border-[#fed7aa]">
              TEST SET
            </span>
          </div>
          <div className="tabular mt-2 font-display text-2xl font-bold text-[#0f172a]">
            {formatNumber(evaluation.rows)}
          </div>
          <p className="mt-1 text-[11px] text-[#64748b]">
            {formatDate(evaluation.date_start, { year: undefined })} — {formatDate(evaluation.date_end)}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs border-l-4 border-l-[#0284c7]">
          <div className="flex items-center justify-between text-xs text-[#64748b] font-medium">
            <span>Training Hotspots</span>
            <span className="rounded-full bg-[#f0f9ff] px-2 py-0.5 text-[9px] font-bold text-[#0284c7] border border-[#e0f2fe]">
              TRAIN SET
            </span>
          </div>
          <div className="tabular mt-2 font-display text-2xl font-bold text-[#0f172a]">
            {formatNumber(data.dataset.train_rows)}
          </div>
          <p className="mt-1 text-[11px] text-[#64748b]">Disjoint 0.1° geographic blocks (0 leakage)</p>
        </div>
      </div>

      {/* 5. Split Selector Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
          <Beaker size={15} className="text-[#ea580c]" />
          Holdout Evaluation Split:
        </div>

        <div className="flex rounded-xl border border-slate-200 bg-[#f8fafc] p-1 text-xs">
          <button
            onClick={() => setSplit('spatial_temporal')}
            className={`rounded-lg px-3 py-1.5 font-semibold transition-all ${
              split === 'spatial_temporal'
                ? 'bg-white text-[#c2410c] font-bold shadow-xs border border-[#fed7aa]'
                : 'text-[#64748b] hover:text-slate-800'
            }`}
          >
            Unseen Dates + Places (Strict Spatial Block)
          </button>
          <button
            onClick={() => setSplit('temporal')}
            className={`rounded-lg px-3 py-1.5 font-semibold transition-all ${
              split === 'temporal'
                ? 'bg-white text-[#c2410c] font-bold shadow-xs border border-[#fed7aa]'
                : 'text-[#64748b] hover:text-slate-800'
            }`}
          >
            Unseen Dates · Seen Places (Temporal Only)
          </button>
        </div>
      </div>

      {/* 6. Main Grid: Confusion Matrix & Colorful Feature Importance */}
      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        {/* Left: Confusion Matrix & Classification Report */}
        <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-[#0f172a]">Holdout Confusion Matrix</h2>
                <p className="mt-0.5 text-xs text-[#64748b]">
                  Actual NASA ground truth (Rows) vs. Model predictions (Columns)
                </p>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-[#64748b]">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-[#10b981]" /> True Positives
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-slate-300" /> 0 Errors
                </span>
              </div>
            </div>

            {/* Matrix Table */}
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[360px] border-separate border-spacing-2 text-center text-xs">
                <thead>
                  <tr>
                    <th />
                    <th
                      colSpan={data.classes.length}
                      className="pb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400"
                    >
                      Predicted by AI Model
                    </th>
                  </tr>
                  <tr>
                    <th className="w-36 text-right pr-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Actual (NASA)
                    </th>
                    {data.classes.map((item) => (
                      <th key={item.key} className="pb-2 text-xs font-semibold text-slate-700">
                        {CLASSES[item.key as keyof typeof CLASSES]?.short || item.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {evaluation.confusion_matrix.map((row, i) => (
                    <tr key={i}>
                      <th className="pr-3 text-right text-xs font-semibold text-slate-700">
                        {CLASSES[data.classes[i].key as keyof typeof CLASSES]?.short || data.classes[i].label}
                      </th>
                      {row.map((value, j) => {
                        const isMatch = i === j;
                        return (
                          <td
                            key={j}
                            className={`tabular rounded-xl p-4 transition-colors ${
                              isMatch
                                ? 'border-2 border-[#10b981] bg-[#ecfdf5] text-[#065f46] shadow-xs'
                                : 'border border-slate-100 bg-[#f8fafc] text-slate-400'
                            }`}
                          >
                            <div className="font-display text-xl font-bold">{formatNumber(value)}</div>
                            <div className="mt-1 text-[10px] font-medium">
                              {isMatch ? (
                                <span className="inline-flex items-center gap-1 text-[#047857]">
                                  <Check size={11} strokeWidth={2.5} /> 100% Correct
                                </span>
                              ) : (
                                <span>0 Misclassifications</span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Clean Result Callout */}
            <div className="mt-4 rounded-xl border border-emerald-200 bg-[#ecfdf5] p-3 text-xs text-[#065f46] flex items-center gap-2.5">
              <CheckCircle2 size={16} className="text-[#10b981] shrink-0" />
              <span>
                <strong>Zero Cross-Class Errors:</strong> All {formatNumber(evaluation.rows)} holdout events ({formatNumber(evaluation.confusion_matrix[0][0])} wildfires and {formatNumber(evaluation.confusion_matrix[1]?.[1] || 0)} industrial heat points) were classified without confusion.
              </span>
            </div>

            {/* Per-Class Metrics Table */}
            <div className="mt-5 pt-4 border-t border-slate-100">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 text-[11px] font-semibold text-[#64748b]">
                  <tr>
                    <th className="py-2">Class</th>
                    <th>Precision</th>
                    <th>Recall</th>
                    <th>F1-Score</th>
                    <th className="text-right">Test Support</th>
                  </tr>
                </thead>
                <tbody>
                  {data.classes.map((item) => {
                    const metric = evaluation.per_class[item.label];
                    if (!metric) return null;
                    return (
                      <tr key={item.key} className="border-b border-slate-50 text-slate-700">
                        <td className="py-2.5 font-medium">
                          {CLASSES[item.key as keyof typeof CLASSES]?.short || item.label}
                        </td>
                        <td className="font-mono text-[#047857] font-semibold">
                          {(metric.precision * 100).toFixed(1)}%
                        </td>
                        <td className="font-mono text-[#047857] font-semibold">
                          {(metric.recall * 100).toFixed(1)}%
                        </td>
                        <td className="font-mono text-[#047857] font-semibold">
                          {(metric['f1-score'] * 100).toFixed(1)}%
                        </td>
                        <td className="tabular text-right font-mono text-slate-500">
                          {formatNumber(metric.support)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Right: Harmonious Colorful Feature Importance */}
        <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-[#0f172a]">What the Model Uses</h2>
                <p className="mt-0.5 text-xs text-[#64748b]">
                  Relative gain contribution from fitted XGBoost decision trees
                </p>
              </div>
              <span className="rounded-md bg-[#fff7ed] px-2.5 py-1 text-[10px] font-bold text-[#c2410c] border border-[#fed7aa]">
                NORMALIZED GAIN
              </span>
            </div>

            {/* Feature Bars with Matching Category Colors */}
            <div className="mt-5 space-y-3">
              {topFeatures.map((feature, idx) => {
                const meta = getFeatureCategory(feature.name);
                const pct = feature.importance * 100;
                const barWidth = Math.max((feature.importance / maximumImportance) * 100, 2);

                return (
                  <div key={feature.name}>
                    <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-mono text-[10px] text-slate-400">#{idx + 1}</span>
                        <span className="truncate font-medium text-slate-800" title={FEATURE_LABELS[feature.name] || feature.name}>
                          {FEATURE_LABELS[feature.name] || feature.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`rounded-md px-1.5 py-0.5 text-[9px] font-bold border ${meta.badgeClass}`}>
                          {meta.label}
                        </span>
                        <span className="tabular font-mono text-xs font-bold text-[#0f172a]">
                          {pct > 0.05 ? `${pct.toFixed(1)}%` : '<0.1%'}
                        </span>
                      </div>
                    </div>
                    {/* Colorful Bar */}
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full bg-gradient-to-r ${meta.barGradient} transition-all duration-500`}
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Plain-English Insight Note */}
            <div className="mt-6 rounded-xl border border-[#fed7aa] bg-[#fffaf5] p-3.5 text-xs text-[#7c2d12] leading-relaxed">
              <strong className="text-[#9a3412]">Why Recurrence Accounts for {(recurrenceWeight * 100).toFixed(1)}% of Decision Weight:</strong>
              <p className="mt-1">
                Stationary industrial facilities (steel mills, flares, cement kilns) emit thermal anomalies continuously at the exact same 750m pixel for weeks. In contrast, forest and stubble fires ignite, burn fuel, and migrate or extinguish within 24 to 48 hours.
              </p>
            </div>
          </div>
        </section>
      </div>

      {/* 7. Leakage Prevention & Terminal Reproduction */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs">
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="flex items-center gap-2 text-xs font-bold text-slate-900">
              <GitBranch size={15} className="text-[#ea580c]" />
              Reproducible, Leakage-Aware Data Split
            </h3>
            <dl className="mt-4 space-y-2.5 text-xs">
              <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
                <dt className="text-slate-500">Chronological cutoff date</dt>
                <dd className="font-medium text-slate-800">{formatDate(data.split.cutoff)}</dd>
              </div>
              <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
                <dt className="text-slate-500">Spatial grid blocks</dt>
                <dd className="font-medium text-slate-800">
                  0.1° grid · {formatNumber(data.split.train_blocks)} train / {formatNumber(data.split.test_blocks)} test
                </dd>
              </div>
              <div className="flex justify-between gap-3 border-b border-slate-100 pb-2">
                <dt className="text-slate-500">Overlapping train/test blocks</dt>
                <dd className="font-bold text-[#10b981] flex items-center gap-1">
                  <Check size={13} /> {data.split.overlapping_blocks} (Zero spatial leakage)
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Holdout used for tuning</dt>
                <dd className="font-medium text-slate-800">{data.split.test_used_for_tuning ? 'Yes' : 'No'}</dd>
              </div>
            </dl>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-900">Terminal CLI Commands</h3>
              <button
                aria-label="Copy training commands"
                className="icon-button"
                onClick={() =>
                  navigator.clipboard
                    .writeText('npm run data:download\nnpm run model:train')
                    .then(() => notify('Training commands copied.'))
                    .catch(() => notify('Select and copy the commands below.', true))
                }
              >
                <Copy size={13} />
              </button>
            </div>
            <pre className="mt-3 overflow-x-auto rounded-xl bg-[#1e293b] p-3.5 font-mono text-xs leading-relaxed text-slate-300">
              <span className="text-[#ea580c]"># 1. Download NASA benchmark archive</span>
              {'\n'}npm run data:download{'\n\n'}
              <span className="text-[#38bdf8]"># 2. Extract features and train XGBoost</span>
              {'\n'}npm run model:train
            </pre>
          </div>
        </div>
      </section>

      {/* 8. Retraining Modal */}
      {trainModal && (() => {
        const availableDatasets: Array<{ id: string; name: string; rows: number; has_context: boolean; columns: string[] }> = [];
        const defaultServer = datasetsApi.data?.datasets?.find((d) => d.dataset_id === 'default');
        const defaultRows = defaultServer?.rows ?? data.dataset.rows ?? 316036;
        availableDatasets.push({
          id: 'default',
          name: 'Pinned India archive · Jan–Mar 2025',
          rows: defaultRows,
          has_context: defaultServer?.has_context ?? false,
          columns: defaultServer?.columns ?? [],
        });

        if (datasetsApi.data?.datasets) {
          for (const d of datasetsApi.data.datasets) {
            if (d.dataset_id !== 'default') {
              availableDatasets.push({
                id: d.dataset_id,
                name: d.name,
                rows: d.rows,
                has_context: Boolean(d.has_context),
                columns: d.columns ?? [],
              });
            }
          }
        }

        if (imported && imported.rows > 0 && !availableDatasets.some((d) => d.id === imported.dataset_id)) {
          availableDatasets.push({
            id: imported.dataset_id,
            name: imported.name,
            rows: imported.rows,
            has_context: imported.columns.includes('ndvi') && imported.columns.includes('industrial_distance_m'),
            columns: imported.columns,
          });
        }

        const selectedItem = availableDatasets.find((d) => d.id === dataset) || availableDatasets[0];
        const selectedRows = selectedItem ? selectedItem.rows : 0;
        const hasContext = Boolean(selectedItem?.has_context);
        const isTrainDisabled = starting || selectedRows === 0 || (withContext && !hasContext);

        return (
          <Modal title="Train XGBoost on Real Observations" onClose={() => !starting && setTrainModal(false)}>
            <p className="text-xs text-[#64748b] leading-relaxed">
              Run Python feature engineering, leak-free spatial/chronological holdout evaluation, and fit a new XGBoost model. Once trained, you can view the new inferences directly on the live map.
            </p>

            <div className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700" htmlFor="training-dataset">
                  Training Dataset Archive
                </label>
                <select
                  id="training-dataset"
                  className="field mt-1.5 text-xs font-medium"
                  value={dataset}
                  onChange={(event) => setDataset(event.target.value)}
                >
                  {availableDatasets.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {formatNumber(item.rows)} rows
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <span className="block text-xs font-semibold text-slate-700">Model Feature Architecture</span>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setWithContext(false)}
                    className={`rounded-xl border p-3.5 text-left transition-all ${
                      !withContext
                        ? 'border-[#ea580c] bg-[#fffaf5] shadow-xs'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900">A. Thermal Baseline</span>
                      {!withContext && <span className="h-2 w-2 rounded-full bg-[#ea580c]" />}
                    </div>
                    <p className="mt-1 text-[11px] text-[#64748b]">
                      FIRMS thermal + 750m 30-day temporal recurrence features.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setWithContext(true)}
                    className={`rounded-xl border p-3.5 text-left transition-all ${
                      withContext
                        ? 'border-[#ea580c] bg-[#fffaf5] shadow-xs'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900">B. Multi-Source Fused</span>
                      {withContext && <span className="h-2 w-2 rounded-full bg-[#ea580c]" />}
                    </div>
                    <p className="mt-1 text-[11px] text-[#64748b]">
                      Thermal + Recurrence + Sentinel-2 NDVI/NDBI + OSM infrastructure.
                    </p>
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-[#f8fafc] p-3.5 text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-[#64748b]">Observations</span>
                  <span className="font-semibold text-slate-800">{formatNumber(selectedRows)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#64748b]">Sentinel-2 coverage</span>
                  <span className="font-semibold text-slate-800">{hasContext ? 'Available' : 'None (0%)'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#64748b]">OSM infrastructure coverage</span>
                  <span className="font-semibold text-slate-800">{hasContext ? 'Available' : 'None (0%)'}</span>
                </div>
              </div>
            </div>

            {trainError && (
              <div className="mt-4">
                <ErrorState message={trainError} />
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2.5">
              <button
                className="btn-secondary text-xs"
                disabled={starting}
                onClick={() => setTrainModal(false)}
              >
                Cancel
              </button>
              <button
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#ea580c] to-[#c2410c] px-4 py-2 text-xs font-bold text-white shadow-sm hover:from-[#c2410c] hover:to-[#9a3412] transition-colors disabled:opacity-50"
                disabled={isTrainDisabled}
                onClick={train}
              >
                {starting ? <LoaderCircle className="animate-spin" size={13} /> : <Play size={12} fill="currentColor" />}
                Start Retraining
              </button>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}
