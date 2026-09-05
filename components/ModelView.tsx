'use client';
import { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Beaker, Box, BrainCircuit, Check, ChevronRight, CircleHelp, Code2, Copy, Cpu, GitBranch, Layers, LoaderCircle, Play, ShieldAlert, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { api, useApi } from '@/lib/api';
import { CLASSES, formatDate, formatNumber } from '@/lib/constants';
import type { ModelCard, Page, TrainingJob } from '@/lib/types';
import type { ImportedDataset } from './HistoryView';
import { ErrorState, Loading, Modal } from './ui';

const FEATURE_LABELS: Record<string,string> = { prior_active_days_30d: 'Prior active dates · 30 d', prior_detections_30d: 'Prior detections · 30 d', recurrence_fraction: 'Observed recurrence fraction', temperature_delta: 'I4–I5 brightness difference', bright_ti4: 'I4 brightness temperature', bright_ti5: 'I5 brightness temperature', log_frp: 'Log fire radiative power', frp_density: 'FRP / pixel footprint', scan: 'Scan footprint', track: 'Track footprint', is_day: 'Day / night', confidence_score: 'NASA confidence category', hour_sin: 'Overpass hour · sine', hour_cos: 'Overpass hour · cosine', season_sin: 'Day of year · sine', season_cos: 'Day of year · cosine', history_coverage_days: 'Available history span', ndvi: 'Measured Sentinel NDVI', ndbi: 'Measured Sentinel NDBI', industrial_distance_capped_m: 'OSM distance · capped at 1.5 km', industrial_within_1000m: 'Mapped industrial features · 1 km' };

export default function ModelView({ refresh, imported, onPage, onModelChanged, notify }: {refresh: number; imported: ImportedDataset | null; onPage: (page: Page) => void; onModelChanged: () => void; notify: (message: string, error?: boolean) => void}) {
  const model = useApi<ModelCard>('/api/model',refresh);
  const datasetsApi = useApi<{ datasets: Array<{ dataset_id: string; name: string; rows: number; quality?: Record<string, number>; columns?: string[]; has_sentinel?: boolean; has_osm?: boolean; has_context?: boolean }> }>('/api/datasets', refresh);
  const [split, setSplit] = useState<'spatial_temporal'|'temporal'>('spatial_temporal');
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
        if (result.status === 'completed') { setJobId(null); model.reload(); onModelChanged(); notify('Training completed. The model card now contains the newly measured holdout results.'); }
        else if (result.status === 'failed') { setJobId(null); notify(`Training failed: ${result.message}`,true); }
        else timer = setTimeout(check, 1800);
      } catch (error) { if (!stopped) { setJobId(null); notify((error as Error).message,true); } }
    }
    check();
    return () => { stopped = true; clearTimeout(timer); };
  }, [jobId]);
  async function train() {
    setStarting(true); setTrainError(null);
    try {
      const result = await api<TrainingJob>('/api/model/train',{method:'POST',body:JSON.stringify({dataset_id:dataset,with_context:withContext})});
      setJob(result); setJobId(result.id); setTrainModal(false);
    } catch (error) { setTrainError((error as Error).message); }
    finally { setStarting(false); }
  }
  const data = model.data;
  if (model.error && !data) return <ErrorState message={model.error} retry={model.reload} />;
  if (!data) return <div className="panel"><Loading text="Reading the trained artifact and measured evaluation results…" /></div>;
  const evaluation = data.metrics[split];
  const staticMetrics = evaluation.per_class['Static thermal source'];
  const importance = [...data.features].sort((a,b)=>b.importance-a.importance).slice(0,8);
  const maximum = Math.max(...importance.map(feature=>feature.importance),.001);
  const poorClasses = data.classes.filter(item => {const metric=evaluation.per_class[item.label]; return metric && (metric.recall<.5 || metric.support<30);});
  return <div className="space-y-5">
    <section className="panel overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-5 p-6"><div className="flex items-start gap-4"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#e9e4f0] bg-[#f4f1f8] text-[#a091b8]"><BrainCircuit size={25} strokeWidth={1.3} /></div><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-display text-[19px] font-semibold tracking-tight">Thermal source classifier</h2><span className="rounded-full bg-[#edf5f0] px-2 py-1 text-[8px] font-medium text-[#7a9e88]">TRAINED ARTIFACT</span></div><p className="mt-1.5 text-[11px] text-[#8c9ba6]">{data.feature_mode} <span className="mx-1.5 text-[#ccd3d9]">·</span> {data.model_id}</p><p className="mt-1 text-[9px] text-[#a7b1b9]">Trained {formatDate(data.trained_at)} · {data.feature_names.length} measured/derived features · NASA inferred type targets</p></div></div><div className="flex gap-2"><a href="/api/model/card" className="btn-secondary"><ArrowDownToLine size={13} />Model card</a><button onClick={()=>setTrainModal(true)} disabled={Boolean(jobId)} className="btn-primary"><Play size={12} />{jobId?'Training in progress':'Train model'}</button></div></div>
      <div className="flex items-center gap-2 border-t border-[#edf0f3] bg-[#fbfcfd] px-6 py-3 text-[9px] text-[#98a6b1]"><ShieldCheck size={12} className="text-[#9cae9f]" />Artifact checksum verified before serving <span className="mx-2 text-[#d2d9de]">·</span> No synthetic records <span className="mx-2 text-[#d2d9de]">·</span> No random-row holdout</div>
    </section>
    {job && <div className={`flex items-center gap-3 rounded-lg border p-4 text-xs ${job.status==='failed'?'border-[#ecd9cd] bg-[#fff8f1] text-[#b28b67]':'border-[#dfe8eb] bg-[#f1f6f8] text-[#8499a7]'}`}>{['queued','running'].includes(job.status)?<LoaderCircle size={17} className="shrink-0 animate-spin"/>:job.status==='completed'?<Check size={17}/>:<ShieldAlert size={17}/>}<div><p className="font-medium">{job.status==='completed'?'Training complete':job.status==='failed'?'Training did not complete':'Real training job running'}</p><p className="mt-1 text-[10px] opacity-80">{job.message}</p></div><code className="ml-auto hidden text-[9px] text-[#a3b1ba] sm:block">{job.id.slice(0,8)}</code></div>}
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2 text-xs font-semibold"><Beaker size={15} className="text-[#a0adb6]" />Held-out evaluation</div><div className="flex rounded-lg border border-[#e6ebee] bg-white p-1 text-[10px]">{([['spatial_temporal','Unseen dates + places'],['temporal','Unseen dates · seen places']] as const).map(([key,label])=><button key={key} onClick={()=>setSplit(key)} className={`rounded-md px-3 py-2 ${split===key?'bg-[#eef2f5] font-medium text-[#6f8493]':'text-[#a0adb7]'}`}>{label}</button>)}</div></div>
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      {[[`${(evaluation.macro_f1*100).toFixed(1)}%`,'Macro-F1','Unweighted across all source classes'],[`${((staticMetrics?.['f1-score']||0)*100).toFixed(1)}%`,'Static-source F1','NASA static class; not industrial incidents'],[formatNumber(evaluation.rows),'Holdout observations',`${formatDate(evaluation.date_start,{year:undefined})} — ${formatDate(evaluation.date_end)}`],[formatNumber(data.dataset.train_rows),'Training observations','Separate labels, dates and location blocks']].map(([value,label,detail])=><div key={label} className="panel p-5"><p className="text-[10px] text-[#95a4af]">{label}</p><div className="tabular mt-3 font-display text-[28px] font-semibold tracking-tight">{value}</div><p className="mt-2 text-[9px] leading-4 text-[#a9b2ba]">{detail}</p></div>)}
    </div>
    <div className="rounded-xl border border-[#ebdfd1] bg-[#fff9f2] px-5 py-4"><div className="flex items-start gap-3"><ShieldAlert size={17} className="mt-0.5 shrink-0 text-[#c0a17a]" /><div><h3 className="text-[11px] font-semibold text-[#a78967]">Accuracy alone hides class imbalance</h3><p className="mt-1.5 text-[10px] leading-6 text-[#b09b83]">Overall accuracy is {(evaluation.accuracy*100).toFixed(1)}%, but a majority-class baseline already achieves {(evaluation.majority_baseline_accuracy*100).toFixed(1)}%. Macro-F1 is the more useful summary here. {poorClasses.map(item=>`${item.label} has weak held-out evidence (${evaluation.per_class[item.label].support} examples; ${(evaluation.per_class[item.label].recall*100).toFixed(1)}% recall).`).join(' ')} Serving abstains for classes with insufficient validation.</p></div></div></div>
    <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
      <section className="panel min-w-0 p-5"><h3 className="text-xs font-semibold">Confusion matrix</h3><p className="mt-1.5 text-[9px] text-[#9ba9b3]">Rows: original NASA inferred type · columns: model prediction</p><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[360px] border-separate border-spacing-1.5 text-center text-[10px]"><thead><tr><th /><th colSpan={data.classes.length} className="pb-2 text-[8px] font-medium uppercase tracking-widest text-[#abb5bd]">Predicted source type</th></tr><tr><th className="w-32" />{data.classes.map(item=><th key={item.key} className="pb-2 text-[9px] font-medium text-[#9aa9b3]">{CLASSES[item.key as keyof typeof CLASSES].short}</th>)}</tr></thead><tbody>{evaluation.confusion_matrix.map((row,i)=><tr key={i}><th className="pr-2 text-right text-[9px] font-medium text-[#91a1ac]">{CLASSES[data.classes[i].key as keyof typeof CLASSES].short}</th>{row.map((value,j)=><td key={j} className="tabular rounded-md px-2 py-5 text-[15px] font-semibold" style={{background:i===j?`rgba(139,162,181,${.08+.34*value/Math.max(...row,1)})`:`rgba(216,178,138,${.06+.28*value/Math.max(...row,1)})`,color:i===j?'#657f93':'#b5a38e'}} title={`${data.classes[i].label} → ${data.classes[j].label}: ${value} actual holdout observations`}>{formatNumber(value)}</td>)}</tr>)}</tbody></table></div><div className="mt-4 overflow-x-auto"><table className="w-full text-left text-[9px]"><thead className="border-b border-[#eaf0f3] text-[#a7b2bb]"><tr><th className="py-2 font-medium">Class</th><th className="font-medium">Precision</th><th className="font-medium">Recall</th><th className="font-medium">F1</th><th className="text-right font-medium">Support</th></tr></thead><tbody>{data.classes.map(item=>{const metric=evaluation.per_class[item.label];return <tr key={item.key} className="border-b border-[#f2f4f6] text-[#8a9ba8]"><td className="py-2.5">{CLASSES[item.key as keyof typeof CLASSES].short}</td><td>{(metric.precision*100).toFixed(1)}%</td><td>{(metric.recall*100).toFixed(1)}%</td><td>{(metric['f1-score']*100).toFixed(1)}%</td><td className="tabular text-right">{formatNumber(metric.support)}</td></tr>;})}</tbody></table></div></section>
      <section className="panel p-5"><div className="flex items-center justify-between"><h3 className="text-xs font-semibold">What the model uses</h3><span className="rounded-md bg-[#f2f4f7] px-2 py-1 text-[8px] text-[#95a4af]">NORMALIZED GAIN</span></div><p className="mt-1.5 text-[9px] text-[#9ba9b3]">Feature importance from the actual fitted XGBoost artifact</p><div className="mt-6 space-y-4">{importance.map(feature=><div key={feature.name}><div className="mb-2 flex justify-between gap-4 text-[9px]"><span className="text-[#899aa7]">{FEATURE_LABELS[feature.name]||feature.name}</span><span className="tabular text-[#9fadb7]">{(feature.importance*100).toFixed(1)}%</span></div><div className="h-[5px] overflow-hidden rounded-full bg-[#f1f4f6]"><div className="h-full rounded-full bg-[#a6b6c5]" style={{width:`${feature.importance/maximum*100}%`}} /></div></div>)}</div><p className="mt-5 border-t border-[#edf1f4] pt-4 text-[9px] leading-6 text-[#a2afb8]">Feature importance is not causal evidence. The NASA type field and exact coordinates are excluded from input features. Missing optical data is never filled with fabricated NDVI/NDBI values.</p></section>
    </div>
    <section className="panel p-6"><div className="grid gap-6 lg:grid-cols-2"><div><h3 className="flex items-center gap-2 text-xs font-semibold"><GitBranch size={15} className="text-[#98a9b5]" />Reproducible, leakage-aware split</h3><dl className="mt-4 space-y-3 text-[10px]"><div className="flex justify-between gap-3"><dt className="text-[#9cabb5]">Chronological cutoff</dt><dd className="text-[#7c929f]">{formatDate(data.split.cutoff)}</dd></div><div className="flex justify-between gap-3"><dt className="text-[#9cabb5]">Spatial blocks</dt><dd className="text-[#7c929f]">0.1° · {formatNumber(data.split.train_blocks)} train / {formatNumber(data.split.test_blocks)} test</dd></div><div className="flex justify-between gap-3"><dt className="text-[#9cabb5]">Overlapping train/test blocks</dt><dd className="font-semibold text-[#84a090]">{data.split.overlapping_blocks}</dd></div><div className="flex justify-between gap-3"><dt className="text-[#9cabb5]">Holdout used for hyperparameter tuning</dt><dd className="text-[#7c929f]">{data.split.test_used_for_tuning?'Yes':'No'}</dd></div></dl><p className="mt-4 text-[9px] leading-6 text-[#a2afb8]">{data.split.history}</p></div><div><div className="flex items-center justify-between"><h3 className="text-xs font-semibold">Reproduce from the real source</h3><button aria-label="Copy training commands" className="icon-button" onClick={()=>navigator.clipboard.writeText('npm run data:download\nnpm run model:train').then(()=>notify('Training commands copied.')).catch(()=>notify('Clipboard is unavailable. Select and copy the commands below.',true))}><Copy size={13} /></button></div><pre className="mt-3 overflow-x-auto rounded-lg bg-[#263741] p-4 font-mono text-[10px] leading-7 text-[#acbeca]"><span className="text-[#758e9e]"># Pinned, checksum-verified historical mirror</span>{'\n'}npm run data:download{'\n'}npm run model:train</pre><button onClick={()=>onPage('history')} className="mt-3 inline-flex items-center gap-2 text-[10px] text-[#b18f71]">Import a freshly reprocessed NASA archive<ArrowRight size={12} /></button></div></div></section>
    <section className="panel p-6"><h3 className="text-xs font-semibold">Limitations you should know</h3><ul className="mt-4 grid gap-x-8 gap-y-3 lg:grid-cols-2">{data.warnings.map(warning=><li className="flex items-start gap-2 text-[10px] leading-6 text-[#97a7b2]" key={warning}><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[#c8b29a]" />{warning}</li>)}</ul></section>
    {trainModal && (() => {
      const availableDatasets: Array<{ id: string; name: string; rows: number; has_context: boolean; columns: string[] }> = [];
      const defaultServer = datasetsApi.data?.datasets?.find(d => d.dataset_id === 'default');
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

      if (imported && imported.rows > 0 && !availableDatasets.some(d => d.id === imported.dataset_id)) {
        availableDatasets.push({
          id: imported.dataset_id,
          name: imported.name,
          rows: imported.rows,
          has_context: imported.columns.includes('ndvi') && imported.columns.includes('industrial_distance_m'),
          columns: imported.columns,
        });
      }

      const selectedItem = availableDatasets.find(d => d.id === dataset) || availableDatasets[0];
      const selectedRows = selectedItem ? selectedItem.rows : 0;
      const hasContext = Boolean(selectedItem?.has_context);
      const isTrainDisabled = starting || selectedRows === 0 || (withContext && !hasContext);

      return (
        <Modal title="Train XGBoost on real observations" onClose={()=>!starting&&setTrainModal(false)}>
          <p className="text-xs leading-6 text-[#8b9ca8]">Run Python feature engineering, leak-free spatial/chronological holdout evaluation, and training of a real XGBoost artifact without synthetic data.</p>
          
          <div className="mt-5 space-y-4">
            <div>
              <label className="block text-[10px] font-medium text-[#91a2ae]" htmlFor="training-dataset">Selected training archive</label>
              <select id="training-dataset" className="field mt-1.5" value={dataset} onChange={event=>{setDataset(event.target.value);}}>
                {availableDatasets.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {formatNumber(item.rows)} rows
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="block text-[10px] font-medium text-[#91a2ae]">Model type</span>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setWithContext(false)}
                  className={`rounded-lg border p-3 text-left transition-all ${!withContext ? 'border-[#dfa47d] bg-[#fdf9f4]' : 'border-[#e4e9ec] bg-white hover:bg-[#fafbfc]'}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-[#485764]">A. Thermal baseline</span>
                    {!withContext && <span className="h-1.5 w-1.5 rounded-full bg-[#dfa47d]" />}
                  </div>
                  <p className="mt-1 text-[9px] leading-4 text-[#8a99a4]">FIRMS thermal + 750m 30-day temporal recurrence features</p>
                </button>

                <button
                  type="button"
                  onClick={() => setWithContext(true)}
                  className={`rounded-lg border p-3 text-left transition-all ${withContext ? 'border-[#dfa47d] bg-[#fdf9f4]' : 'border-[#e4e9ec] bg-white hover:bg-[#fafbfc]'}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-[#485764]">B. Multi-source fused</span>
                    {withContext && <span className="h-1.5 w-1.5 rounded-full bg-[#dfa47d]" />}
                  </div>
                  <p className="mt-1 text-[9px] leading-4 text-[#8a99a4]">Thermal + Recurrence + Sentinel-2 NDVI/NDBI + OSM features</p>
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-[#e5eaee] bg-[#f8fafb] p-3.5 text-[10px]">
              <div className="flex justify-between py-1 border-b border-[#edf1f4]">
                <span className="text-[#8c9ca8]">Archive observations</span>
                <span className="font-semibold text-[#495864]">{formatNumber(selectedRows)}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#edf1f4]">
                <span className="text-[#8c9ca8]">Sentinel-2 context coverage</span>
                <span className="font-semibold text-[#495864]">{hasContext ? 'Enriched archive (≥60%)' : 'Missing in archive (0%)'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[#edf1f4]">
                <span className="text-[#8c9ca8]">OSM infrastructure coverage</span>
                <span className="font-semibold text-[#495864]">{hasContext ? 'Enriched archive (≥60%)' : 'Missing in archive (0%)'}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-[#8c9ca8]">Active model ID</span>
                <span className="font-mono text-[9px] text-[#697a86]">{data.model_id}</span>
              </div>
            </div>

            {withContext && !hasContext && (
              <div className="rounded-lg border border-[#f3d9c7] bg-[#fff6f0] p-3 text-[10px] leading-5 text-[#b0673d]">
                <strong>Coverage warning:</strong> The selected archive does not contain pre-extracted Sentinel-2 (NDVI/NDBI) or OSM infrastructure columns with ≥60% measured coverage. Multi-source fused training requires an enriched archive. Select <em>A. Thermal baseline</em> to train using FIRMS thermal and temporal recurrence features, or upload an enriched dataset in Historical data.
              </div>
            )}
          </div>

          {trainError&&<div className="mt-4"><ErrorState message={trainError}/></div>}
          <div className="mt-6 flex justify-end gap-2">
            <button className="btn-secondary" disabled={starting} onClick={()=>setTrainModal(false)}>Cancel</button>
            <button className="btn-primary" disabled={isTrainDisabled} onClick={train}>
              {starting?<LoaderCircle className="animate-spin" size={13}/>:<Play size={12}/>}
              Start {withContext ? 'fused' : 'baseline'} training
            </button>
          </div>
        </Modal>
      );
    })()}
  </div>;
}
