'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Bookmark, Check, CheckCheck, ChevronRight, CircleHelp, Cloud, Compass, Database, Factory, FileDown, Flame, Leaf, LoaderCircle, MapPin, Orbit, ScanLine, ShieldAlert, Users, X } from 'lucide-react';
import { api, useApi } from '@/lib/api';
import { CLASSES, coordinates, formatDate, formatNumber, formatTime, satelliteName } from '@/lib/constants';
import type { Evidence, Review, ThermalEvent } from '@/lib/types';
import { ClassBadge, ErrorState, ExternalLink, PrimaryBadge, RiskBadge } from './ui';

export default function ObservationDrawer({ event, onClose, onReviewed, onEvidence, notify }: {event: ThermalEvent; onClose: () => void; onReviewed: () => void; onEvidence: (value: Evidence) => void; notify: (message: string, error?: boolean) => void}) {
  const [review, setReview] = useState<Review | null>(event.review || null);
  const [note, setNote] = useState(event.review?.note || '');
  const [saving, setSaving] = useState(false);
  const [loadContext, setLoadContext] = useState(false);
  const context = useApi<Evidence>(loadContext ? `/api/events/${event.id}/context` : null);
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    if (context.data) onEvidence(context.data);
  }, [context.data, onEvidence]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    const key = (keyboard: KeyboardEvent) => {
      if (keyboard.key === 'Escape') close.current();
      if (keyboard.key === 'Tab') {
        const nodes = ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],textarea,input');
        if (!nodes?.length) return;
        if (keyboard.shiftKey && (document.activeElement === nodes[0] || document.activeElement === ref.current)) { keyboard.preventDefault(); nodes[nodes.length-1].focus(); }
        if (!keyboard.shiftKey && document.activeElement === nodes[nodes.length-1]) { keyboard.preventDefault(); nodes[0].focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', key); previous?.focus(); };
  }, []);
  async function save(state: 'watching' | 'reviewed' | 'clear') {
    setSaving(true);
    try {
      const result = await api<{review: Review | null}>(`/api/events/${event.id}/review`, { method: 'POST', body: JSON.stringify({state, note}) });
      setReview(result.review); onReviewed();
      notify(state === 'watching' ? 'Observation added to your persistent review list.' : state === 'reviewed' ? 'Review saved. This does not confirm an incident or send an external alert.' : 'Observation removed from the review list.');
    } catch (error) { notify((error as Error).message, true); }
    finally { setSaving(false); }
  }
  function download() {
    const blob = new Blob([JSON.stringify({ observation: {...event, review}, evidence: context.data || null, warning: 'Satellite detection and provisional model output, not a confirmed incident. Requires ground verification.' }, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${event.id}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const color = CLASSES[event.prediction.classKey]?.color || '#8e9ca6';
  const confText = event.confidence === 'h' || event.confidence === 'H' ? 'High' : event.confidence === 'n' || event.confidence === 'N' ? 'Nominal' : event.confidence === 'l' || event.confidence === 'L' ? 'Low' : typeof event.confidence === 'number' ? `${event.confidence}%` : String(event.confidence || '—');

  return <div className="fixed inset-0 z-[2700] flex justify-end bg-[#17273330]" onMouseDown={click => {if (click.target === click.currentTarget) onClose();}}>
    <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Observation investigation" className="flex h-full w-full max-w-[480px] flex-col bg-white shadow-2xl outline-none">
      <div className="flex h-[65px] shrink-0 items-center justify-between border-b border-[#e9edf0] px-6"><div className="flex items-center gap-2 text-xs font-semibold"><ScanLine size={16} className="text-[#d69364]" />Observation investigation</div><div className="flex gap-1"><button onClick={download} aria-label="Download observation evidence" title="Download real observation and evidence" className="icon-button"><FileDown size={16} /></button><button onClick={onClose} aria-label="Close observation" className="icon-button"><X size={19} /></button></div></div>
      <div className="scroll-thin flex-1 overflow-y-auto p-6">
        <div className="flex items-center justify-between"><span className="section-label text-[#c1895f]">{event.mode === 'archive' ? 'Historical observation' : 'Near-real-time observation'}</span><div className="flex items-center gap-1.5"><PrimaryBadge primaryClass={event.prediction.primaryClass} compact /><ClassBadge classKey={event.prediction.classKey} compact /></div></div>
        <h2 className="mt-3 font-display text-[21px] font-semibold tracking-tight">{coordinates(event.latitude, event.longitude, 4)}</h2>
        <p className="mt-2 text-[11px] text-[#85949e]">{formatDate(event.acquiredAt)} <span className="mx-1.5">·</span> {formatTime(event.acquiredAt)} UTC <span className="mx-1.5">·</span> {satelliteName(event.satellite)} ({event.daynight === 'D' ? 'Day' : 'Night'})</p>
        <p className="mt-1 font-mono text-[9px] text-[#acb4bb]">{event.id}</p>
        <div className="mt-6 grid grid-cols-4 gap-2">
          {[
            ['Radiative power', event.frp.toFixed(1), 'MW'],
            ['I4 brightness', event.brightness.toFixed(0), 'K'],
            ['I5 brightness', event.backgroundBrightness.toFixed(0), 'K'],
            ['Confidence', confText, ''],
          ].map(([label,value,unit]) => <div className="rounded-lg border border-[#e8ecef] bg-[#fafbfc] px-2.5 py-3" key={label}><div className="text-[8.5px] text-[#95a0a9]">{label}</div><div className="tabular mt-1 text-[16px] font-semibold tracking-tight">{value}<span className="ml-0.5 text-[8.5px] font-normal text-[#93a0a9]">{unit}</span></div></div>)}
        </div>
        <div className="mt-2 flex items-center gap-1 text-[9px] leading-4 text-[#a3adb5]"><CircleHelp size={10} />Brightness temperature is a satellite-band measurement, not flame temperature.</div>

        <section className="mt-5 rounded-xl border border-[#eedfd6] bg-[#fdfaf7] p-4">
          <div className="flex items-center justify-between"><span className="section-label text-[#b37e5c]">Risk & Exposure Assessment</span><RiskBadge level={event.risk?.level} /></div>
          <div className="mt-3 flex items-baseline justify-between">
            <div><span className="font-display text-[22px] font-semibold tracking-tight text-[#33424d]">{event.risk ? (event.risk.score * 100).toFixed(1) : '—'}</span><span className="ml-1 text-[10px] text-[#84929d]">/ 100 Risk Score</span></div>
            <span className="text-[10px] text-[#8f9ca6]">Priority: <strong className="capitalize text-[#445562]">{event.risk?.level || 'Low'}</strong></span>
          </div>
          {event.risk?.formula && <p className="mt-2 rounded bg-white/70 px-2 py-1 font-mono text-[9px] text-[#788894] border border-[#e8ded6]">{event.risk.formula}</p>}
          {event.risk?.factors && event.risk.factors.length > 0 && <ul className="mt-2.5 space-y-1 border-t border-[#f0e4dc] pt-2">
            {event.risk.factors.map((factor, idx) => <li key={idx} className="flex items-center gap-2 text-[9.5px] text-[#758490]"><span className="h-1 w-1 rounded-full bg-[#c9622d]" />{factor}</li>)}
          </ul>}
          <p className="mt-2.5 border-t border-[#f0e4dc] pt-2 text-[8.5px] leading-4 text-[#a0aeb8]">Classification and risk are separated. Persistent fixed sources (furnaces, flares) are not automatically high-risk fires; elevated anomalies near settlements or facilities receive high priority.</p>
        </section>

        <section className="mt-5 rounded-xl border border-[#e7ebee] p-4">
          <div className="flex items-center justify-between"><span className="section-label text-[#94a0aa]">Classification Assessment</span><PrimaryBadge primaryClass={event.prediction.primaryClass} /></div>
          <h3 className="mt-3 flex items-center gap-2 text-[13px] font-semibold" style={{color}}><span className="h-2 w-2 rounded-full" style={{background:color}} />{event.prediction.label}</h3>
          <p className="mt-1.5 text-[9px] font-medium text-[#b07d39]">Provisional Satellite Detection · Requires Independent Ground Verification</p>
          {event.prediction.explanation && <div className="mt-2.5 rounded border border-[#edf1f4] bg-[#f8fafb] p-3 text-[10px] leading-5 text-[#5e717e]"><div className="font-semibold text-[#455562] mb-1">Classification Reason & Evidence:</div><p>{event.prediction.explanation}</p></div>}
          {event.prediction.abstentionReason && <p className="mt-2 text-[10px] leading-5 text-[#a38569]">Model abstained: {event.prediction.abstentionReason}. No trusted source type is assigned.</p>}
          <div className="mt-4 space-y-2.5">{event.prediction.probabilities.map(item => <div key={item.key}><div className="mb-1 flex justify-between text-[9px]"><span className="text-[#8997a1]">{item.label}</span><span className="tabular font-medium text-[#62717d]">{(item.score * 100).toFixed(1)}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-[#f0f3f5]"><div className="h-full rounded-full" style={{width:`${item.score*100}%`,background:CLASSES[item.key as keyof typeof CLASSES]?.color || '#8e9ca6'}} /></div></div>)}</div>
          {!event.prediction.probabilities.length && <p className="mt-3 text-xs text-[#98a3ac]">No model output available. Scores have not been fabricated.</p>}
          <p className="mt-4 border-t border-[#eff1f4] pt-3 text-[9px] leading-5 text-[#9aa5ae]"><strong>Important Safety Notice:</strong> FIRMS satellite detection alone must never be used to confirm an industrial explosion, blast, or accident. Uncalibrated source-type scores require ground verification.</p>
        </section>

        <section className="mt-5">
          <div className="flex items-center justify-between"><h3 className="text-xs font-semibold">Temporal evidence</h3><span className="text-[9px] text-[#a0aab2]">750 m · prior 30 days</span></div>
          {event.history ? <><div className="mt-3 grid grid-cols-3 rounded-lg border border-[#e8ecef] bg-[#fbfcfd] py-4 text-center"><div><div className="tabular text-lg font-semibold">{formatNumber(event.history.detections)}</div><div className="mt-1 text-[9px] text-[#9aa5ae]">Prior detections</div></div><div className="border-x border-[#e8ecef]"><div className="tabular text-lg font-semibold">{event.history.activeDays}</div><div className="mt-1 text-[9px] text-[#9aa5ae]">Active UTC dates</div></div><div><div className="tabular text-lg font-semibold">{event.history.coverageDays.toFixed(0)}<span className="ml-0.5 text-xs font-normal text-[#9aa5ae]">d</span></div><div className="mt-1 text-[9px] text-[#9aa5ae]">Archive coverage</div></div></div><p className="mt-2 text-[9px] leading-5 text-[#a0aab2]">Past observations only. Elapsed history is not cloud-free coverage; recurrence alone does not prove persistent industrial activity.</p></> : <p className="mt-3 rounded-lg bg-[#f6f8fa] p-3 text-[10px] text-[#9aa5ae]">Temporal evidence is not available for this observation.</p>}
        </section>

        <section className="mt-6 border-t border-[#edf0f2] pt-5">
          <div className="flex items-center justify-between"><h3 className="text-xs font-semibold">Spatial & spectral evidence</h3><span className="rounded bg-[#f0f4f6] px-2 py-1 text-[8px] text-[#8999a5]">REAL API QUERIES</span></div>
          <p className="mt-2 text-[10px] leading-5 text-[#99a5ae]">Look up current OSM infrastructure and the nearest usable Sentinel-2 scene on or before this detection. These are contextual evidence, not inputs to the thermal-only baseline.</p>
          {!loadContext && <button className="btn-secondary mt-3 w-full" onClick={() => setLoadContext(true)}><Compass size={14} />Fetch source evidence<ChevronRight size={13} /></button>}
          {context.loading && <div className="mt-4 flex items-center gap-2 rounded-lg bg-[#f4f7f9] p-4 text-[11px] text-[#8799a7]"><LoaderCircle className="animate-spin" size={16} />Querying OSM, Sentinel-2 and population sources…</div>}
          {context.error && <div className="mt-3"><ErrorState message={context.error} retry={context.reload} /></div>}
          {context.data && <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-[#e7ecef] p-3.5"><div className="flex items-center justify-between text-[11px] font-medium"><span className="flex items-center gap-2"><Factory size={14} className="text-[#94a4af]" />OSM infrastructure</span><span className={`text-[9px] ${context.data.osm.status === 'ready' ? 'text-[#5d9d83]' : 'text-[#b19477]'}`}>{context.data.osm.status === 'ready' ? 'Retrieved' : 'Unavailable'}</span></div>
              {context.data.osm.status === 'ready' ? <><p className="mt-3 text-[11px] text-[#6e808d]">{context.data.osm.nearest_industrial ? `${context.data.osm.nearest_industrial.name} · ${formatNumber(context.data.osm.nearest_industrial.distance_m)} m` : 'No mapped industrial feature returned within 1.5 km. This does not establish that none exists.'}</p>{context.data.osm.nearest_industrial && <ExternalLink href={context.data.osm.nearest_industrial.url} className="mt-2 text-[9px]">Inspect mapped feature</ExternalLink>}<p className="mt-2 text-[9px] leading-5 text-[#a0abb3]">{context.data.osm.note}</p></> : <p className="mt-2 text-[10px] leading-5 text-[#9da8b0]">{context.data.osm.message}</p>}
            </div>
            <div className="rounded-lg border border-[#e7ecef] p-3.5"><div className="flex items-center justify-between text-[11px] font-medium"><span className="flex items-center gap-2"><Orbit size={14} className="text-[#94a4af]" />Sentinel-2 L2A</span><span className={`text-[9px] ${context.data.sentinel.status === 'ready' ? 'text-[#5d9d83]' : 'text-[#b19477]'}`}>{context.data.sentinel.status === 'ready' ? 'Measured' : context.data.sentinel.status.replace('_',' ')}</span></div>
              {context.data.sentinel.status === 'ready' ? <><div className="mt-3 grid grid-cols-2 gap-3"><div className="rounded bg-[#f5f8f6] p-3"><div className="text-[9px] text-[#87a08d]">NDVI</div><div className="mt-1 text-lg font-semibold">{context.data.sentinel.ndvi?.toFixed(3)}</div></div><div className="rounded bg-[#f6f4f9] p-3"><div className="text-[9px] text-[#9a8bae]">NDBI</div><div className="mt-1 text-lg font-semibold">{context.data.sentinel.ndbi?.toFixed(3)}</div></div></div><p className="mt-3 text-[9px] leading-5 text-[#9da8b0]">{formatDate(context.data.sentinel.acquired_at)} · {context.data.sentinel.day_offset} days before detection · {((context.data.sentinel.valid_pixel_fraction || 0)*100).toFixed(0)}% valid pixels.</p>{context.data.sentinel.catalog_url && <ExternalLink href={context.data.sentinel.catalog_url} className="mt-2 text-[9px]">Open original STAC scene</ExternalLink>}<p className="mt-2 text-[9px] leading-5 text-[#a0abb3]">{context.data.sentinel.method}</p></> : <p className="mt-2 text-[10px] leading-5 text-[#9da8b0]">{context.data.sentinel.message}</p>}
            </div>
            <div className="rounded-lg border border-[#e7ecef] p-3.5"><div className="flex items-center gap-2 text-[11px] font-medium"><Users size={14} className="text-[#94a4af]" />Population exposure</div>{context.data.population.status === 'ready' ? <><p className="mt-3 text-lg font-semibold">~{formatNumber(context.data.population.estimated_people || 0)} <span className="text-[10px] font-normal text-[#94a0a9]">people within 1 km · {context.data.population.reference_year}</span></p><p className="mt-2 text-[9px] leading-5 text-[#a0abb3]">{context.data.population.note}</p></> : <p className="mt-2 text-[10px] leading-5 text-[#9da8b0]">{context.data.population.message}</p>}</div>
            <button onClick={context.reload} disabled={context.loading} className="text-[10px] text-[#9d8c7a] underline underline-offset-4">Recheck evidence sources</button>
          </div>}
        </section>
        <div className="mt-6 flex flex-wrap items-center gap-4 border-t border-[#edf0f2] pt-4 text-[10px]"><ExternalLink href={`https://firms.modaps.eosdis.nasa.gov/map/#@${event.longitude},${event.latitude},12z`}>NASA FIRMS viewer</ExternalLink><ExternalLink href={`https://www.openstreetmap.org/?mlat=${event.latitude}&mlon=${event.longitude}#map=14/${event.latitude}/${event.longitude}`}>OpenStreetMap</ExternalLink></div>
        <p className="mt-2 text-[9px] text-[#a7b0b7]">Set the FIRMS viewer date to {formatDate(event.acquiredAt)} for this observation.</p>
      </div>
      <div className="shrink-0 border-t border-[#e9edf0] bg-[#fbfcfd] p-5">
        <label className="mb-2 block text-[10px] font-medium text-[#80909b]" htmlFor="review-note">Analyst note <span className="font-normal text-[#a6afb7]">· does not create a training label</span></label>
        <textarea id="review-note" className="field h-14 resize-none" placeholder="Record what needs verification…" maxLength={1000} value={note} onChange={event => setNote(event.target.value)} />
        <div className="mt-3 flex gap-2"><button className="btn-secondary flex-1" disabled={saving} onClick={() => save(review?.state === 'watching' ? 'clear' : 'watching')}><Bookmark size={14} fill={review?.state === 'watching' ? 'currentColor' : 'none'} />{review?.state === 'watching' ? 'Remove from watchlist' : 'Add to watchlist'}</button><button className="btn-primary flex-1" disabled={saving} onClick={() => save('reviewed')}>{saving ? <LoaderCircle className="animate-spin" size={14} /> : <CheckCheck size={14} />}{review?.state === 'reviewed' ? 'Update review' : 'Mark reviewed'}</button></div>
        {review && <p className="mt-2 text-[9px] text-[#96a3ad]">{review.state === 'reviewed' ? 'Reviewed' : 'Watching'} · {formatDate(review.updatedAt)} {formatTime(review.updatedAt)} UTC · persisted to observation storage</p>}
      </div>
    </div>
  </div>;
}
