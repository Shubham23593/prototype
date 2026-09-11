'use client';
import { useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  CircleHelp,
  Database,
  FileCheck2,
  FileSpreadsheet,
  Flame,
  Info,
  Layers,
  LoaderCircle,
  Play,
  ShieldCheck,
  TrendingUp,
  UploadCloud,
} from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, useApi } from '@/lib/api';
import { formatDate, formatNumber } from '@/lib/constants';
import type { Page, Provenance } from '@/lib/types';
import { ErrorState, ExternalLink, Loading } from './ui';

export interface ImportedDataset {
  dataset_id: string;
  name: string;
  rows: number;
  classes: Record<string, number>;
  sha256: string;
  date_start: string;
  date_end: string;
  columns: string[];
  quality: {
    input_rows: number;
    valid_rows: number;
    invalid_or_unsupported_rows: number;
    duplicates_removed: number;
  };
}

interface HistoryData {
  rows: number;
  date_start: string;
  date_end: string;
  daily: { date: string; detections: number; mean_frp: number }[];
  quality: ImportedDataset['quality'];
  classes: { key: string; label: string; rows: number }[];
  provenance: Provenance;
  replay: { rows: number; date_start: string; date_end: string; selection: string };
  rawDownloaded: boolean;
}

function HistoryTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ value: number; payload: { date: string; detections: number; mean_frp?: number } }>;
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0]?.payload;
  if (!item) return null;
  const dateObj = new Date(item.date);
  const month = dateObj.getUTCMonth();
  let seasonContext = 'Baseline regional thermal activity';
  if (month >= 2 && month <= 4) seasonContext = '🔥 Peak pre-monsoon biomass & forest fires';
  else if (month >= 5 && month <= 7) seasonContext = '🌧️ Monsoon minimum (heavy precipitation)';
  else if (month >= 8 && month <= 10) seasonContext = '🌾 Autumn post-monsoon crop residue burning';

  return (
    <div className="rounded-xl border border-[#fed7aa] bg-white p-3.5 text-xs shadow-xl min-w-[200px]">
      <div className="font-bold text-[#0f172a] text-xs">{formatDate(item.date)}</div>
      <div className="mt-2 space-y-1.5 text-[11px]">
        <div className="flex items-center justify-between gap-4 text-[#ea580c]">
          <span className="font-medium">Observed Hotspots:</span>
          <span className="font-mono font-bold text-xs">{formatNumber(item.detections)}</span>
        </div>
        {typeof item.mean_frp === 'number' && item.mean_frp > 0 && (
          <div className="flex items-center justify-between gap-4 text-[#64748b]">
            <span className="font-medium">Mean Radiative Power:</span>
            <span className="font-mono font-semibold">{item.mean_frp.toFixed(1)} MW</span>
          </div>
        )}
      </div>
      <div className="mt-2.5 pt-2 border-t border-[#ffedd5] text-[10px] font-medium text-[#c2410c]">
        {seasonContext}
      </div>
    </div>
  );
}

export default function HistoryView({
  onPage,
  onImported,
  imported,
  notify,
  refresh,
}: {
  onPage: (page: Page) => void;
  onImported: (value: ImportedDataset) => void;
  imported: ImportedDataset | null;
  notify: (message: string, error?: boolean) => void;
  refresh: number;
}) {
  const history = useApi<HistoryData>('/api/history', refresh);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [provenance, setProvenance] = useState('https://firms.modaps.eosdis.nasa.gov/download/');
  const fileInput = useRef<HTMLInputElement>(null);

  async function upload(file: File | undefined) {
    if (!file || busy) return;
    setError(null);
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Choose a FIRMS VIIRS CSV file (.csv).');
      return;
    }
    if (file.size > 80 * 1024 * 1024) {
      setError('This file exceeds 80 MB. Use the Python CLI for larger multi-gigabyte archives.');
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('provenanceUrl', provenance);
      form.append('file', file);
      const result = await api<ImportedDataset>('/api/history/import', { method: 'POST', body: form });
      if (result && result.rows > 0) {
        onImported(result);
        notify(`Validated ${formatNumber(result.rows)} real-format archive rows. Ready for training in Model Lab.`);
      } else {
        throw new Error('Parsed archive contains 0 valid FIRMS observations. Check coordinates and radiometric fields.');
      }
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  const data = history.data;
  const peakDay = data?.daily?.reduce((max, cur) => (cur.detections > (max?.detections || 0) ? cur : max), data.daily[0]);

  return (
    <div className="space-y-6">
      {/* 1. Header with Warm Orange/Ember Branding & Clear Workflow */}
      <div className="rounded-2xl border border-[#fed7aa]/60 bg-white p-6 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#fff7ed] text-[#ea580c] border border-[#fed7aa] shadow-xs">
              <Database size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display text-lg font-bold text-[#0f172a]">
                  Historical Ground-Truth Data Pipeline
                </h1>
                <span className="rounded-full bg-[#fff7ed] px-2.5 py-0.5 text-[10px] font-bold text-[#c2410c] border border-[#fed7aa]">
                  NASA VIIRS ARCHIVE
                </span>
              </div>
              <p className="mt-0.5 text-xs text-[#64748b]">
                Genuine satellite thermal observations, reproducible checksums, and custom CSV import for model training.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => fileInput.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#fed7aa] bg-white px-3.5 py-2 text-xs font-semibold text-[#7c2d12] shadow-xs hover:bg-[#fffaf5] transition-colors"
            >
              <UploadCloud size={14} className="text-[#ea580c]" />
              Upload Custom CSV
            </button>

            <button
              onClick={() => onPage('model')}
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#ea580c] to-[#c2410c] px-4 py-2 text-xs font-bold text-white shadow-sm hover:from-[#c2410c] hover:to-[#9a3412] transition-all transform hover:scale-[1.01]"
            >
              Next: Go to Model Lab
              <ArrowRight size={14} />
            </button>
          </div>
        </div>

        {/* 3-Step Clear Platform Flow Stepper with Brand Accents */}
        <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3 pt-5 border-t border-[#f1f5f9]">
          <div className="flex items-center gap-3 rounded-xl border-2 border-[#ea580c] bg-[#fffaf5] p-3.5 shadow-xs">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#ea580c] text-xs font-bold text-white shadow-xs">
              1
            </span>
            <div className="min-w-0">
              <div className="text-xs font-bold text-[#c2410c]">Step 1: Training Archives (Current)</div>
              <div className="text-[11px] text-[#9a3412] truncate">316,468 verified NASA detections or custom CSV</div>
            </div>
          </div>

          <button
            onClick={() => onPage('model')}
            className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5 text-left hover:border-[#fed7aa] hover:bg-[#fffaf5] transition-colors group cursor-pointer"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f5f3ff] text-xs font-bold text-[#7c3aed] border border-[#ede9fe]">
                2
              </span>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-800 group-hover:text-[#7c3aed]">Step 2: Model Lab</div>
                <div className="text-[11px] text-slate-500 truncate">Inspect 17 features & train XGBoost</div>
              </div>
            </div>
            <ArrowRight size={14} className="text-slate-400 shrink-0 group-hover:text-[#7c3aed] group-hover:translate-x-0.5 transition-all" />
          </button>

          <button
            onClick={() => onPage('overview')}
            className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5 text-left hover:border-sky-200 hover:bg-sky-50/50 transition-colors group cursor-pointer"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f0f9ff] text-xs font-bold text-[#0284c7] border border-[#e0f2fe]">
                3
              </span>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-800 group-hover:text-[#0284c7]">Step 3: Overview Map</div>
                <div className="text-[11px] text-slate-500 truncate">Live & historical hotspot classifications</div>
              </div>
            </div>
            <ArrowRight size={14} className="text-slate-400 shrink-0 group-hover:text-[#0284c7] group-hover:translate-x-0.5 transition-all" />
          </button>
        </div>
      </div>

      {/* 2. Top Grid: Active Archive Metrics & Provenance */}
      <div className="grid gap-6 lg:grid-cols-[1.65fr_1fr]">
        <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="section-label text-[#ea580c]">NASA OBSERVATION BENCHMARK</div>
                <h2 className="mt-1 font-display text-base font-bold text-[#0f172a]">
                  VIIRS Thermal Archive (India · S-NPP)
                </h2>
                <p className="mt-0.5 text-xs text-[#64748b]">
                  Genuine NASA science-grade observations with traceable source files, original acquisition timestamps, and checksums.
                </p>
              </div>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#fff7ed] text-[#ea580c] border border-[#fed7aa]">
                <Flame size={20} />
              </span>
            </div>

            {history.error && (
              <div className="mt-4">
                <ErrorState message={history.error} retry={history.reload} />
              </div>
            )}

            {history.loading && !data ? (
              <div className="py-12">
                <Loading text="Reading historical observation records..." />
              </div>
            ) : (
              data && (
                <>
                  {/* Top Stats Row */}
                  <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 rounded-xl border border-[#fed7aa]/50 bg-gradient-to-b from-[#fffaf5] to-white">
                    <div>
                      <div className="tabular font-display text-2xl font-bold text-[#0f172a]">
                        {formatNumber(data.rows)}
                      </div>
                      <div className="text-[11px] font-medium text-[#64748b]">Observations</div>
                    </div>
                    <div>
                      <div className="tabular font-display text-2xl font-bold text-[#0f172a]">
                        {data.daily.length}
                        <span className="ml-1 text-xs font-normal text-[#94a3b8]">days</span>
                      </div>
                      <div className="text-[11px] font-medium text-[#64748b]">Calendar Days</div>
                    </div>
                    <div>
                      <div className="tabular font-display text-2xl font-bold text-[#0f172a]">
                        {data.classes.length}
                      </div>
                      <div className="text-[11px] font-medium text-[#64748b]">Ground Classes</div>
                    </div>
                    <div>
                      <div className="tabular font-display text-2xl font-bold text-[#ea580c]">
                        {peakDay ? formatNumber(peakDay.detections) : '—'}
                      </div>
                      <div className="text-[11px] font-medium text-[#c2410c]">Peak Single Day</div>
                    </div>
                  </div>

                  {/* Enhanced Warm Orange AreaChart */}
                  <div className="mt-5">
                    <div className="flex items-center justify-between mb-2 text-xs">
                      <span className="font-semibold text-slate-700 text-xs">
                        Thermal Density Timeline (Seasonal Peaks)
                      </span>
                      {peakDay && (
                        <span className="text-[11px] font-semibold text-[#ea580c] flex items-center gap-1">
                          <Flame size={13} className="text-[#ea580c]" /> Peak: {formatDate(peakDay.date, { year: undefined })} ({formatNumber(peakDay.detections)} hotspots)
                        </span>
                      )}
                    </div>
                    <div className="h-[185px] min-w-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={data.daily} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                          <defs>
                            <linearGradient id="warm-history-fill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#ea580c" stopOpacity={0.4} />
                              <stop offset="50%" stopColor="#f97316" stopOpacity={0.12} />
                              <stop offset="100%" stopColor="#ea580c" stopOpacity={0.0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid vertical={false} stroke="#fed7aa" strokeOpacity={0.3} strokeDasharray="3 3" />
                          <XAxis
                            dataKey="date"
                            tick={{ fontSize: 9.5, fill: '#64748b' }}
                            axisLine={false}
                            tickLine={false}
                            minTickGap={35}
                            tickFormatter={value => formatDate(value, { year: undefined })}
                          />
                          <YAxis
                            tick={{ fontSize: 9, fill: '#64748b' }}
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={value => (value >= 1000 ? `${value / 1000}k` : String(value))}
                          />
                          <Tooltip content={<HistoryTooltip />} />
                          <Area
                            name="Observed pixels"
                            type="monotone"
                            dataKey="detections"
                            stroke="#ea580c"
                            strokeWidth={2.2}
                            fill="url(#warm-history-fill)"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Harmonious Seasonal Pills */}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-[#f1f5f9] text-[11px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-lg bg-[#fff7ed] border border-[#fed7aa] px-2.5 py-1 font-semibold text-[#c2410c]">
                        🔥 Pre-monsoon: March–May
                      </span>
                      <span className="rounded-lg bg-[#eff6ff] border border-[#bfdbfe] px-2.5 py-1 font-semibold text-[#0284c7]">
                        🌧️ Monsoon Low: June–Aug
                      </span>
                      <span className="rounded-lg bg-[#fef3c7] border border-[#fde68a] px-2.5 py-1 font-semibold text-[#b45309]">
                        🌾 Stubble Burning: Oct–Nov
                      </span>
                    </div>
                    <span className="font-mono text-slate-400 text-[10.5px]">
                      {formatDate(data.date_start)} — {formatDate(data.date_end)}
                    </span>
                  </div>
                </>
              )
            )}
          </div>
        </section>

        {/* Provenance & Quality Card */}
        <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
                <ShieldCheck size={16} className="text-[#16a34a]" />
                Provenance & Quality
              </h2>
              <span className="rounded-full bg-[#ecfdf5] px-2.5 py-0.5 text-[10px] font-bold text-[#15803d] border border-[#bbf7d0]">
                100% VERIFIED
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Traced directly to official NASA Earthdata telemetry.
            </p>

            {data ? (
              <>
                <dl className="mt-5 space-y-3 text-xs">
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <dt className="text-slate-500">Original NASA rows</dt>
                    <dd className="tabular font-semibold text-slate-900">
                      {formatNumber(data.quality.input_rows)}
                    </dd>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <dt className="text-slate-500">Duplicates removed</dt>
                    <dd className="tabular font-semibold text-slate-900">
                      {formatNumber(data.quality.duplicates_removed)}
                    </dd>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <dt className="text-slate-500">Invalid / unsupported</dt>
                    <dd className="tabular font-semibold text-slate-900">
                      {formatNumber(data.quality.invalid_or_unsupported_rows)}
                    </dd>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <dt className="text-slate-500">Satellite & Sensor</dt>
                    <dd className="font-semibold text-slate-900">Suomi NPP · VIIRS 375m</dd>
                  </div>
                  <div className="flex justify-between py-1">
                    <dt className="text-slate-500">Archive Storage</dt>
                    <dd className="font-semibold text-[#15803d]">
                      {data.rawDownloaded ? 'Downloaded Local Journal' : 'Reproducibly Downloadable'}
                    </dd>
                  </div>
                </dl>

                <div className="mt-5 rounded-xl border border-slate-200 bg-[#f8fafc] p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    SHA-256 Checksum
                  </div>
                  <code className="mt-1 block break-all font-mono text-[10px] leading-relaxed text-[#334155] select-all">
                    {data.provenance.sha256}
                  </code>
                </div>

                <div className="mt-4 flex flex-col gap-1">
                  <ExternalLink
                    href={data.provenance.mirror_url || data.provenance.primary_url}
                    className="text-xs font-semibold text-[#ea580c] hover:underline"
                  >
                    Inspect pinned NASA source file
                  </ExternalLink>
                </div>
              </>
            ) : (
              <Loading text="Reading provenance..." />
            )}
          </div>
        </section>
      </div>

      {/* 3. Bottom Grid: Bring Your Own Archive & Where to find data */}
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        {/* Upload Custom Archive */}
        <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="section-label text-[#ea580c]">CUSTOM DATASET INGESTION</div>
              <h2 className="mt-1 text-sm font-bold text-slate-900 flex items-center gap-2">
                <UploadCloud size={17} className="text-[#ea580c]" />
                Import Regional NASA FIRMS Archive
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Upload custom NASA FIRMS VIIRS CSV files to train a tailored XGBoost classifier.
              </p>
            </div>
          </div>

          <label className="mt-4 block text-[11px] font-semibold text-slate-700" htmlFor="provenance-url">
            Dataset Source URL / Provenance
          </label>
          <input
            id="provenance-url"
            type="url"
            className="field mt-1.5 text-xs"
            value={provenance}
            onChange={event => setProvenance(event.target.value)}
          />

          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            onChange={event => upload(event.target.files?.[0])}
            className="sr-only"
            id="historical-csv"
            disabled={busy}
          />

          <button
            disabled={busy}
            onClick={() => fileInput.current?.click()}
            onDragOver={event => {
              event.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={event => {
              event.preventDefault();
              setDrag(false);
              upload(event.dataTransfer.files[0]);
            }}
            className={`mt-4 flex w-full flex-col items-center rounded-xl border-2 border-dashed px-4 py-8 transition-all ${
              drag
                ? 'border-[#ea580c] bg-[#fffaf5] scale-[1.01]'
                : 'border-[#fed7aa] bg-[#fffaf5]/50 hover:border-[#ea580c] hover:bg-[#fffaf5]'
            }`}
          >
            {busy ? (
              <LoaderCircle className="mb-2 animate-spin text-[#ea580c]" size={28} />
            ) : (
              <FileSpreadsheet className="mb-2 text-[#ea580c]" size={30} strokeWidth={1.75} />
            )}
            <span className="text-xs font-bold text-[#0f172a]">
              {busy ? 'Validating schema and coordinates...' : 'Drop NASA FIRMS CSV here, or click to browse'}
            </span>
            <span className="mt-1 text-[11px] text-[#64748b]">
              Standard NASA format (.csv) · Up to 80 MB (~500k rows)
            </span>
          </button>

          {error && (
            <div className="mt-3">
              <ErrorState message={error} />
            </div>
          )}

          {/* Validation Success Card with ONE Clear Next Step Button */}
          {imported && imported.rows > 0 && (
            <div className="mt-4 rounded-xl border border-emerald-300 bg-[#ecfdf5] p-4.5 shadow-xs">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-bold text-[#065f46]">
                  <CheckCircle2 size={17} className="text-[#10b981]" />
                  Custom Archive Validated: {imported.name}
                </div>
                <span className="rounded-full bg-[#d1fae5] px-2.5 py-0.5 text-[9px] font-bold text-[#047857]">
                  READY TO TRAIN
                </span>
              </div>
              <p className="text-[11px] text-[#065f46] mt-1">
                {formatNumber(imported.rows)} observations validated ({formatDate(imported.date_start)} to {formatDate(imported.date_end)}).
              </p>
              <div className="mt-3">
                <button
                  className="inline-flex items-center gap-2 rounded-lg bg-[#059669] px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-[#047857] transition-all transform hover:scale-[1.01]"
                  onClick={() => onPage('model')}
                >
                  <Play size={12} fill="currentColor" />
                  Next Step: Open Model Lab to Train with this Dataset
                  <ArrowRight size={13} />
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Where to download training data */}
        <section className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs flex flex-col justify-between">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900">
              Where to Download Training Data
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Acquire official science-grade historical CSVs from NASA Earthdata:
            </p>

            <div className="mt-4 space-y-3">
              {[
                [
                  '01',
                  'Download from NASA FIRMS Archive Tool',
                  'Select S-NPP or NOAA-20 VIIRS, choose your geographic bounding box, and select your date range.',
                  'https://firms.modaps.eosdis.nasa.gov/download/',
                ],
                [
                  '02',
                  'Preserve Standard NASA Headers',
                  'Keep original column headers (latitude, longitude, brightness, scan, track, acq_date, acq_time, frp, type).',
                  'https://www.earthdata.nasa.gov/data/tools/firms/faq',
                ],
                [
                  '03',
                  'Verify Ground Class Labels',
                  '0 = Vegetation fire, 2 = Other static land heat, 3 = Offshore anomaly.',
                  'https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a',
                ],
              ].map(([number, title, body, url]) => (
                <div key={number} className="flex items-start gap-3 rounded-xl p-2.5 hover:bg-[#fffaf5] transition-colors">
                  <span className="tabular flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#fff7ed] text-[10px] font-bold text-[#ea580c] border border-[#fed7aa]">
                    {number}
                  </span>
                  <div>
                    <ExternalLink href={url} className="text-xs font-semibold !text-[#0f172a] hover:!text-[#ea580c]">
                      {title}
                    </ExternalLink>
                    <p className="mt-0.5 text-[11px] text-slate-500">{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <a
            href="https://firms.modaps.eosdis.nasa.gov/download/"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 flex items-center justify-center gap-2 rounded-xl border border-[#fed7aa] bg-[#fffaf5] py-2.5 text-xs font-bold text-[#c2410c] hover:bg-[#ffedd5] transition-colors"
          >
            Visit Official NASA FIRMS Portal
            <ArrowUpRight size={13} />
          </a>
        </section>
      </div>

      {/* Limitation alert */}
      <div className="flex items-start gap-3 rounded-2xl border border-[#fed7aa] bg-[#fffaf5] p-4.5">
        <CircleHelp size={18} className="mt-0.5 shrink-0 text-[#ea580c]" />
        <div>
          <h2 className="text-xs font-bold text-[#9a3412]">Scientific Rigor & Label Limitations</h2>
          <p className="mt-0.5 text-[11px] leading-relaxed text-[#7c2d12]">
            Standard FIRMS type labels differentiate between vegetation fires and static land heat, but do not differentiate industrial sub-types (e.g. flares vs kilns). Always ground-truth before acting on real-world industrial emergency responses.
          </p>
        </div>
      </div>
    </div>
  );
}
