'use client';
import { useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Check, ChevronRight, CircleHelp, Database, FileCheck2, FileSpreadsheet, FolderOpen, LoaderCircle, ShieldCheck, UploadCloud } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, useApi } from '@/lib/api';
import { formatDate, formatNumber } from '@/lib/constants';
import type { Page, Provenance } from '@/lib/types';
import { ErrorState, ExternalLink, Loading } from './ui';

export interface ImportedDataset { dataset_id: string; name: string; rows: number; classes: Record<string,number>; sha256: string; date_start: string; date_end: string; columns: string[]; quality: {input_rows: number; valid_rows: number; invalid_or_unsupported_rows: number; duplicates_removed: number} }
interface HistoryData { rows: number; date_start: string; date_end: string; daily: {date: string; detections: number; mean_frp: number}[]; quality: ImportedDataset['quality']; classes: {key: string; label: string; rows: number}[]; provenance: Provenance; replay: {rows: number; date_start: string; date_end: string; selection: string}; rawDownloaded: boolean }

export default function HistoryView({ onPage, onImported, imported, notify, refresh }: {onPage: (page: Page) => void; onImported: (value: ImportedDataset) => void; imported: ImportedDataset | null; notify: (message: string, error?: boolean) => void; refresh: number}) {
  const history = useApi<HistoryData>('/api/history', refresh);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [provenance, setProvenance] = useState('https://firms.modaps.eosdis.nasa.gov/download/');
  const fileInput = useRef<HTMLInputElement>(null);
  async function upload(file: File | undefined) {
    if (!file || busy) return;
    setError(null);
    if (!file.name.toLowerCase().endsWith('.csv')) { setError('Choose a FIRMS VIIRS CSV, not a PDF, image, ZIP, or model file.'); return; }
    if (file.size > 80*1024*1024) { setError('This file exceeds 80 MB. Use the Python CLI for a larger historical archive.'); return; }
    setBusy(true);
    try {
      const form = new FormData(); form.append('provenanceUrl',provenance); form.append('file',file);
      const result = await api<ImportedDataset>('/api/history/import', {method:'POST',body:form});
      if (result && result.rows > 0) {
        onImported(result);
        notify(`Validated ${formatNumber(result.rows)} real-format archive rows. Review their provenance before training.`);
      } else {
        throw new Error('Parsed archive contains 0 valid FIRMS observations. Check coordinates, dates, and thermal measurements.');
      }
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); if(fileInput.current) fileInput.current.value = ''; }
  }
  const data = history.data;
  return <div className="space-y-5">
    <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
      <section className="panel min-w-0 p-6">
        <div className="flex items-start justify-between gap-3"><div><div className="section-label text-[#b38b6b]">REAL TRAINING DATA</div><h2 className="mt-2 font-display text-[20px] font-semibold tracking-tight">An archive. Not a simulation.</h2><p className="mt-2 text-[11px] leading-6 text-[#8a9aa6]">Genuine NASA-format VIIRS observations with traceable source files, original acquisition dates, and reproducible checksums.</p></div><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#fbf1e8] text-[#cc9b70]"><Database size={21} strokeWidth={1.5} /></span></div>
        {history.error && <div className="mt-4"><ErrorState message={history.error} retry={history.reload} /></div>}
        {history.loading && !data ? <Loading /> : data && <><div className="mt-6 grid grid-cols-3 divide-x divide-[#e9eef1]"><div><div className="tabular font-display text-[26px] font-semibold tracking-tight">{formatNumber(data.rows)}</div><div className="mt-1 text-[9px] text-[#9ba8b2]">Valid historical observations</div></div><div className="pl-5"><div className="font-display text-[26px] font-semibold tracking-tight">{data.daily.length}<span className="ml-1 text-sm font-normal text-[#a0adb6]">days</span></div><div className="mt-1 text-[9px] text-[#9ba8b2]">Observed UTC calendar dates</div></div><div className="pl-5"><div className="font-display text-[26px] font-semibold tracking-tight">{data.classes.length}</div><div className="mt-1 text-[9px] text-[#9ba8b2]">NASA source-type labels</div></div></div>
          <div className="mt-7 h-[175px] min-w-0"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data.daily} margin={{top:10,right:2,left:-20,bottom:0}}><defs><linearGradient id="history-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#dda776" stopOpacity={.25} /><stop offset="100%" stopColor="#dda776" stopOpacity={.01} /></linearGradient></defs><CartesianGrid vertical={false} stroke="#eef1f3" strokeDasharray="3 3" /><XAxis dataKey="date" tick={{fontSize:9,fill:'#9dabb5'}} axisLine={false} tickLine={false} minTickGap={35} tickFormatter={value=>formatDate(value,{year:undefined})} /><YAxis tick={{fontSize:9,fill:'#a1adb6'}} axisLine={false} tickLine={false} tickFormatter={value=>value>=1000?`${value/1000}k`:value} /><Tooltip labelFormatter={value=>formatDate(String(value))} /><Area name="Observed pixels" type="monotone" dataKey="detections" stroke="#d8a274" strokeWidth={1.7} fill="url(#history-fill)" /></AreaChart></ResponsiveContainer></div>
          <div className="mt-3 flex flex-wrap justify-between gap-2 text-[9px] text-[#a2aeb7]"><span>{formatDate(data.date_start)} — {formatDate(data.date_end)} · India · S-NPP VIIRS</span><span>{formatNumber(data.replay.rows)} rows in the final 7-day map window</span></div></>}
      </section>
      <section className="panel p-6"><h3 className="flex items-center gap-2 text-xs font-semibold"><ShieldCheck size={16} className="text-[#95a9b5]" />Provenance & quality</h3>{data ? <><dl className="mt-5 space-y-4 text-[10px]">
        <div className="flex justify-between gap-3"><dt className="text-[#9ba8b2]">Original rows</dt><dd className="tabular font-medium text-[#6e808e]">{formatNumber(data.quality.input_rows)}</dd></div><div className="flex justify-between gap-3"><dt className="text-[#9ba8b2]">Duplicate rows removed</dt><dd className="tabular font-medium text-[#6e808e]">{formatNumber(data.quality.duplicates_removed)}</dd></div><div className="flex justify-between gap-3"><dt className="text-[#9ba8b2]">Invalid / unsupported rows</dt><dd className="tabular font-medium text-[#6e808e]">{formatNumber(data.quality.invalid_or_unsupported_rows)}</dd></div><div className="flex justify-between gap-3"><dt className="text-[#9ba8b2]">Archive access</dt><dd className="font-medium text-[#b48c6b]">Pinned public mirror</dd></div><div className="flex justify-between gap-3"><dt className="text-[#9ba8b2]">Raw file on this server</dt><dd className="font-medium text-[#6e808e]">{data.rawDownloaded?'Downloaded':'Reproducibly downloadable'}</dd></div>
        </dl><div className="mt-5 border-t border-[#ebeff2] pt-4"><div className="section-label text-[8px] text-[#a5afb7]">SOURCE SHA-256</div><code className="mt-2 block break-all rounded-md bg-[#f5f7f9] p-2.5 font-mono text-[9px] leading-5 text-[#8a9ba7]">{data.provenance.sha256}</code></div><ExternalLink href={data.provenance.mirror_url || data.provenance.primary_url} className="mt-3 text-[10px]">Inspect the pinned original file</ExternalLink><p className="mt-3 text-[9px] leading-5 text-[#a0adb6]">The mirror is explicitly attributed. Equivalence to a freshly reprocessed official NASA archive has not been verified. No mirror records are labelled “live”.</p></> : <Loading text="Reading provenance…" />}</section>
    </div>

    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <section className="panel p-6"><div className="flex items-center gap-2"><UploadCloud size={17} className="text-[#97a8b4]" /><h3 className="text-xs font-semibold">Bring your own historical archive</h3></div><p className="mt-2 text-[10px] leading-5 text-[#9aa8b2]">Import an actual labelled FIRMS VIIRS CSV. Validation checks coordinates, UTC times, sensor fields, duplicate detections, and NASA type labels.</p>
        <label className="mt-4 block text-[10px] text-[#91a0ab]" htmlFor="provenance-url">Original source URL</label><input id="provenance-url" type="url" className="field mt-2" value={provenance} onChange={event=>setProvenance(event.target.value)} />
        <input ref={fileInput} type="file" accept=".csv,text/csv" onChange={event=>upload(event.target.files?.[0])} className="sr-only" id="historical-csv" disabled={busy} />
        <button disabled={busy} onClick={()=>fileInput.current?.click()} onDragOver={event=>{event.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)} onDrop={event=>{event.preventDefault();setDrag(false);upload(event.dataTransfer.files[0]);}} className={`mt-4 flex w-full flex-col items-center rounded-xl border border-dashed px-4 py-7 transition-colors ${drag?'border-[#dca575] bg-[#fff8f1]':'border-[#dfe5e9] bg-[#fbfcfd] hover:bg-[#f8fafb]'}`}>
          {busy ? <LoaderCircle className="mb-3 animate-spin text-[#c49b78]" size={24} /> : <FileSpreadsheet className="mb-3 text-[#a6b4bd]" size={26} strokeWidth={1.2} />}<span className="text-[11px] font-medium text-[#8598a5]">{busy?'Uploading and validating actual records…':'Drop a FIRMS CSV here, or browse files'}</span><span className="mt-2 text-[9px] text-[#b0bac2]">CSV only · up to 80 MB · no synthetic labels</span>
        </button>{error && <div className="mt-3"><ErrorState message={error} /></div>}
        {imported && imported.rows > 0 && <div className="mt-4 rounded-lg border border-[#dcebe3] bg-[#f6faf7] p-4"><div className="flex items-center gap-2 text-[11px] font-medium text-[#739781]"><FileCheck2 size={15} />Archive schema validated</div><p className="mt-2 break-all text-[10px] text-[#7e9587]">{imported.name} · {formatNumber(imported.rows)} usable rows</p><p className="mt-1 text-[9px] text-[#9bac9f]">{formatDate(imported.date_start)} — {formatDate(imported.date_end)}</p><button className="mt-3 inline-flex items-center gap-2 text-[10px] font-semibold text-[#719b80]" onClick={()=>onPage('model')}>Train with this archive<ArrowRight size={12} /></button></div>}
      </section>
      <section className="panel p-6"><h3 className="text-xs font-semibold">Where do I find training data?</h3><p className="mt-2 text-[10px] leading-5 text-[#9aa8b2]">Start with official standard-processing history, not an unlabelled 7-day live feed.</p><div className="mt-5 space-y-5">
        {[['01','Download the NASA archive','Choose VIIRS S-NPP or NOAA-20, your region, and multiple years. Use standard science-quality CSV data.','https://firms.modaps.eosdis.nasa.gov/download/'],['02','Verify source-type labels','Keep the original type field. 0 = presumed vegetation, 2 = other static land, 3 = offshore. These are not incident-confirmed industrial labels.','https://www.earthdata.nasa.gov/data/tools/firms/faq'],['03','Add real contextual evidence','Use date-aligned Sentinel-2 reflectance and mapped OSM infrastructure. Missing imagery or map coverage must stay missing.','https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a']].map(([number,title,body,url])=><div key={number} className="flex items-start gap-3"><span className="tabular flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#f6f2ed] text-[9px] font-semibold text-[#bea283]">{number}</span><div><ExternalLink href={url} className="text-[11px] font-medium !text-[#6d808e]">{title}</ExternalLink><p className="mt-1.5 text-[10px] leading-5 text-[#9daab4]">{body}</p></div></div>)}
        </div><a href="/guide" target="_blank" rel="noopener noreferrer" className="btn-secondary mt-6 w-full">Read the full data & training guide<ArrowUpRight size={13} /></a></section>
    </div>
    <div className="flex items-start gap-3 rounded-xl border border-[#ede2d5] bg-[#fffaf4] p-5"><CircleHelp size={17} className="mt-0.5 shrink-0 text-[#c6a17c]" /><div><h3 className="text-[11px] font-medium text-[#ad8c68]">Label quality is a first-class limitation</h3><p className="mt-1.5 text-[10px] leading-6 text-[#b6a08a]">NASA corrected a Collection-2 source-type labelling issue in May 2025. The bundled mirror’s reprocessing status is unverified. Refresh from the official archive before scientific use, and collect independently verified incident labels before calling this an industrial-fire classifier.</p></div></div>
  </div>;
}
