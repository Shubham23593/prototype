'use client';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { Activity, ArrowDownRight, ArrowRight, BarChart3, ChevronRight, CircleHelp, Factory, Flame, Focus, Leaf, LoaderCircle, Radio, ScanLine, ShieldAlert, TrendingUp, Zap } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Evidence, Overview, Page, Region, ThermalEvent } from '@/lib/types';
import { CLASSES, coordinates, formatDate, formatNumber, formatTime } from '@/lib/constants';
import { ClassBadge, EmptyState } from './ui';

const ThermalMap = dynamic(() => import('./ThermalMap'), { ssr: false, loading: () => <div className="flex h-full items-center justify-center bg-[#1a272f] text-xs text-[#a5b5c0]"><LoaderCircle className="mr-2 animate-spin" size={16} />Loading geospatial workspace…</div> });
export type OverviewData = Overview & { latest: ThermalEvent[] };

function Sparkline({ values, color }: {values: number[]; color: string}) {
  if (!values.length || values.every(value => value === 0)) return null;
  const min = Math.min(...values), max = Math.max(...values);
  const range = Math.max(max - min, 0.001);
  const w = 46, h = 20;
  const points = values.map((value, index) => [
    Math.round(index * (w - 4) / Math.max(values.length - 1, 1) + 2),
    Math.round(h - 2 - ((value - min) / range) * (h - 4))
  ]);
  const last = points[points.length - 1];
  return (
    <div className="shrink-0 overflow-hidden">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block overflow-hidden" aria-label="Daily trend">
        <path d={`M ${points.map(p => p.join(' ')).join(' L ')} L ${w - 2} ${h} L 2 ${h} Z`} fill={color} opacity=".09" />
        <polyline points={points.map(p => p.join(',')).join(' ')} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={last[0]} cy={last[1]} r="2" fill={color} />
      </svg>
    </div>
  );
}
function Metric({ label, value, unit, detail, icon, color, values, available, help }: {label: string; value: number; unit?: string; detail: string; icon: React.ReactNode; color: string; values: number[]; available: boolean; help: string}) {
  const hasTrend = available && values.length > 0 && !values.every(v => v === 0);
  return (
    <div className="panel min-w-0 overflow-hidden px-4.5 py-4">
      <div className="flex items-center justify-between gap-1.5">
        <span className="truncate text-[11px] font-medium text-[#75828c]">{label}</span>
        <span className="shrink-0" style={{color}}>{icon}</span>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-1">
        <div className="tabular whitespace-nowrap font-display text-[23px] font-semibold tracking-[-.035em] text-[#27333b] sm:text-[25px]">
          {available ? formatNumber(value, unit ? 1 : 0) : '—'}
          {unit && <span className="ml-1 text-[11px] font-medium tracking-normal text-[#99a1a8]">{unit}</span>}
        </div>
        {hasTrend && (
          <div className="hidden min-[1300px]:block shrink-0">
            <Sparkline values={values} color={color} />
          </div>
        )}
      </div>
      <div className="mt-2.5 flex items-center gap-1.5 text-[9px] text-[#929ba3]">
        <span className="truncate">{detail}</span>
        <span className="shrink-0" title={help} tabIndex={0} aria-label={help}><CircleHelp size={10} /></span>
      </div>
    </div>
  );
}

export default function OverviewView({ data, loading, region, selected, onSelect, onPage, onSources, fullScreen, onFullScreen, evidence }: {
  data?: OverviewData; loading: boolean; region: Region; selected: ThermalEvent | null; onSelect: (event: ThermalEvent) => void;
  onPage: (page: Page) => void; onSources: () => void; fullScreen: boolean; onFullScreen: () => void; evidence?: Evidence | null;
}) {
  const [feedTab, setFeedTab] = useState<'recent' | 'power'>('recent');
  const available = Boolean(data && data.availability !== 'unavailable');
  const stats = data?.stats;
  const timeline = data?.timeline || [];
  const feed = (feedTab === 'recent' ? data?.latest : data?.events.filter(event => event.frp >= 50))?.slice(0, 5) || [];
  const distribution = data?.distribution.filter(item => item.value > 0) || [];
  let cumulative = 0;
  const gradient = distribution.map(item => { const from = cumulative; cumulative += item.value / Math.max(data?.total || 0, 1) * 360; return `${item.color} ${from}deg ${cumulative}deg`; }).join(', ');
  return <div>
    <section aria-label="Observation metrics" className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 xl:gap-3.5">
      <Metric label="Total observations" value={stats?.detections || 0} detail="Observed satellite pixels" icon={<ScanLine size={15} />} color="#e48d53" values={timeline.map(item => item.detections)} available={available} help="Total NASA FIRMS VIIRS hotspot detections in the selected spatial/temporal window." />
      <Metric label="Potential industrial" value={stats?.industrialCandidates || 0} detail="Close to mapped facilities" icon={<Factory size={15} />} color="#d9534f" values={[]} available={available && Boolean(data?.model.available)} help="Thermal anomalies situated near mapped industrial infrastructure or land-use with non-persistent fire characteristics." />
      <Metric label="Persistent sources" value={stats?.persistentCandidates || 0} detail="Recurrent heat signature" icon={<Flame size={15} />} color="#9985c7" values={timeline.map(item => item.static)} available={available && Boolean(data?.model.available)} help="High-recurrence anomalies at stable locations, characteristic of industrial furnaces, flare stacks, or kilns." />
      <Metric label="High priority" value={stats?.highPriority || 0} detail="Elevated risk score" icon={<ShieldAlert size={15} />} color="#c9622d" values={[]} available={available} help="Hotspots with high risk index based on Hazard × Exposure × Confidence." />
      <Metric label="Forest / natural" value={stats?.forestCandidates || 0} detail="Vegetation land cover" icon={<Leaf size={15} />} color="#5c9a72" values={[]} available={available && Boolean(data?.model.available)} help="Detections in natural forest or wilderness areas away from heavy industrial infrastructure." />
      <Metric label="Agricultural / waste" value={stats?.agriCandidates || 0} detail="Cropland & crop residue" icon={<Activity size={15} />} color="#c49a45" values={[]} available={available && Boolean(data?.model.available)} help="Seasonal agricultural burning, crop residue clearing, or open biomass combustion." />
      <Metric label="Mean FRP" value={stats?.meanFrp || 0} unit="MW" detail="Fire radiative power" icon={<Zap size={15} />} color="#78a8b6" values={timeline.map(item => item.meanFrp)} available={available && Boolean(stats?.detections)} help="Average Fire Radiative Power (MW) across mapped detections." />
    </section>

    <div className="mt-7 grid gap-4.5 min-[1200px]:grid-cols-[minmax(0,1fr)_300px] min-[1500px]:grid-cols-[minmax(0,1fr)_325px]">
      <section className={fullScreen ? 'panel fixed inset-4 z-[2500] overflow-hidden shadow-2xl' : 'panel min-w-0 overflow-hidden'} aria-label="Geospatial overview">
        <div className="flex h-[63px] items-center justify-between px-5">
          <div className="flex items-center gap-2.5"><Focus className="text-[#819099]" size={17} strokeWidth={1.6} /><div><h2 className="text-[12px] font-semibold text-[#35414a]">Geospatial overview</h2><p className="mt-0.5 text-[9px] text-[#9aa3aa]">{region.name} <span className="mx-1">·</span> Click an observation to investigate</p></div></div>
          <span className="hidden items-center gap-1.5 rounded-full border border-[#e6e9ec] bg-[#f8f9fa] px-2.5 py-1 text-[9px] text-[#84919a] sm:inline-flex"><span className={`h-1 w-1 rounded-full ${data?.model.available ? 'bg-[#74a18b]' : 'bg-[#c7a67b]'}`} />{data?.model.available ? 'XGBoost inference' : data ? 'Model unavailable' : 'Model checking'}</span>
        </div>
        <div className="relative" style={{height: fullScreen ? 'calc(100% - 97px)' : 450}}>
          <ThermalMap events={data?.events || []} selected={selected} onSelect={onSelect} region={region} fullScreen={fullScreen} onFullScreen={onFullScreen} infrastructure={evidence?.osm.features} />
          {loading && !data && <div className="absolute inset-0 z-[1100] flex flex-col items-center justify-center gap-3 bg-[#1b2933ab] text-xs text-[#cfdae1]"><LoaderCircle className="animate-spin text-[#eea075]" size={24} /><span>Reading real observations & running inference…</span></div>}
          {data?.availability === 'unavailable' && <div className="absolute bottom-24 left-1/2 z-[1100] w-[85%] max-w-md -translate-x-1/2 rounded-xl border border-[#506575] bg-[#253640ed] p-5 text-center text-xs text-[#ccd7df]"><Radio size={22} className="mx-auto mb-3 text-[#dba174]" /><div className="font-medium text-white">Live source unavailable</div><p className="mt-2 text-[11px] leading-5 text-[#afbdc7]">No live data has been substituted. Check the connection or switch to the clearly labelled historical workspace.</p><button onClick={onSources} className="mt-3 inline-flex items-center gap-1 text-[11px] text-[#f0b286]">View source status<ArrowRight size={12} /></button></div>}
        </div>
        <div className="flex h-[34px] items-center justify-between gap-2 bg-white px-4 text-[9px] text-[#8a98a2]"><span className="flex items-center gap-1.5"><span className="h-1 w-1 rounded-full bg-[#ee9b63]" />{data ? `${formatNumber(data.events.length)} ${data.truncated ? `highest-FRP points of ${formatNumber(data.total)}` : 'observations'} mapped` : 'Waiting for observations'}</span><span className="hidden sm:block">{data?.mode === 'archive' ? 'HISTORICAL OBSERVATIONS' : 'NEAR-REAL-TIME SOURCE'} <span className="mx-1.5 text-[#d1d7dc]">|</span> WGS 84</span></div>
      </section>
      <section className="panel flex min-w-0 flex-col overflow-hidden">
        <div className="flex h-[62px] shrink-0 items-center justify-between px-4"><h2 className="text-[12px] font-semibold text-[#35414a]">Observation feed</h2><span className="tabular rounded-md bg-[#f3f5f7] px-2 py-1 text-[10px] text-[#82919d]">{available ? formatNumber(data?.total || 0) : '—'}</span></div>
        <div className="mx-4 mb-2 flex rounded-md bg-[#f3f5f7] p-0.5 text-[10px] font-medium">
          <button onClick={() => setFeedTab('recent')} className={`flex-1 rounded-[5px] px-3 py-1.5 ${feedTab === 'recent' ? 'bg-white text-[#445460] shadow-sm' : 'text-[#98a2ab]'}`}>Most recent</button>
          <button onClick={() => setFeedTab('power')} className={`flex-1 rounded-[5px] px-3 py-1.5 ${feedTab === 'power' ? 'bg-white text-[#445460] shadow-sm' : 'text-[#98a2ab]'}`}>High FRP</button>
        </div>
        <div className="flex-1">
          {feed.length ? feed.map(event => <button key={event.id} onClick={() => onSelect(event)} className={`group flex w-full items-start gap-2.5 border-b border-[#f0f2f4] px-4 py-[14px] text-left transition-colors hover:bg-[#fbf8f5] ${event.id === selected?.id ? 'bg-[#fff8f1]' : ''}`}>
            <span className="mt-1.5 h-[6px] w-[6px] shrink-0 rounded-full ring-[3px] ring-current/5" style={{ background: CLASSES[event.prediction.classKey].color, color: CLASSES[event.prediction.classKey].color }} />
            <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="tabular truncate text-[10.5px] font-semibold text-[#495660]">{coordinates(event.latitude, event.longitude, 2)}</span><span className="tabular shrink-0 text-[10px] font-medium text-[#bc8459]">{event.frp.toFixed(1)} <span className="text-[8px] text-[#aeb7bd]">MW</span></span></span>
              <span className="mt-1 block text-[9px] text-[#949ea7]">{event.prediction.label}</span><span className="mt-2 flex items-center justify-between"><span className="text-[8px] text-[#a6afb6]">{formatDate(event.acquiredAt, {year: undefined})} <span className="mx-1">·</span> {formatTime(event.acquiredAt)} UTC</span><ChevronRight size={12} className="text-[#c5cbd0] transition-transform group-hover:translate-x-0.5" /></span></span>
          </button>) : loading ? <div className="space-y-5 p-5">{[0,1,2,3].map(i => <div key={i}><div className="skeleton h-3 w-4/5" /><div className="skeleton mt-2 h-2 w-3/5" /></div>)}</div> : <EmptyState title={data?.availability === 'unavailable' ? 'Feed unavailable' : 'No matching observations'} description="Nothing is being generated to fill this list. Try another real-data window or region." />}
        </div>
        <button onClick={() => onPage('observations')} className="flex min-h-[42px] items-center justify-center gap-2 bg-[#fcfcfd] text-[10px] font-medium text-[#7b8b95] transition-colors hover:bg-[#f3f6f8]">Explore all observations<ArrowRight size={12} /></button>
      </section>
    </div>

    <div className="mt-7 grid gap-4.5 lg:grid-cols-[1.45fr_1fr]">
      <section className="panel min-w-0 px-5 pb-3 pt-4">
        <div className="mb-4 flex items-center justify-between"><div><h2 className="text-[12px] font-semibold">Thermal activity</h2><p className="mt-1 text-[9px] text-[#9aa5ae]">Daily observations in your selected window · UTC</p></div><div className="flex items-center gap-3 text-[8px] text-[#8f9ba4]"><span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-sm bg-[#e5b38a]" />All pixels</span><span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-sm bg-[#a99bce]" />Static candidates</span></div></div>
        {available && timeline.length ? <div className="h-[155px] w-full min-w-0"><ResponsiveContainer width="100%" height="100%"><BarChart data={timeline} margin={{top: 8, right: 3, bottom: 0, left: -25}} barGap={3}>
          <CartesianGrid vertical={false} stroke="#edf0f3" strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={value => formatDate(value, {year: undefined})} tick={{fontSize: 9, fill: '#a0aab3'}} axisLine={false} tickLine={false} dy={5} /><YAxis tick={{fontSize: 9, fill: '#a5afb7'}} axisLine={false} tickLine={false} tickFormatter={value => value >= 1000 ? `${Math.round(value / 1000)}k` : String(value)} /><Tooltip labelFormatter={value => formatDate(String(value))} cursor={{fill: '#fafbfc'}} /><Bar name="All observations" dataKey="detections" fill="#e8bf9e" radius={[3,3,0,0]} maxBarSize={25} /><Bar name="Static candidates" dataKey="static" fill="#a99bce" radius={[3,3,0,0]} maxBarSize={25} />
        </BarChart></ResponsiveContainer></div> : <div className="flex h-[155px] items-center justify-center text-[11px] text-[#a0aab2]">{loading ? 'Reading observation history…' : 'No measured activity available'}</div>}
      </section>
      <section className="panel px-5 pb-4 pt-4">
        <div className="flex items-center justify-between"><div><h2 className="text-[12px] font-semibold">Source-type composition</h2><p className="mt-1 text-[9px] text-[#9aa5ae]">Provisional model classifications</p></div><button title="Understand model limitations" aria-label="Understand model limitations" onClick={() => onPage('model')} className="icon-button"><CircleHelp size={15} /></button></div>
        <div className="mt-5 flex items-center justify-center gap-6 xl:gap-8">
          <div className="relative h-[125px] w-[125px] shrink-0 rounded-full" style={{ background: gradient && available ? `conic-gradient(${gradient})` : '#eef1f3' }}><div className="absolute inset-[13px] flex flex-col items-center justify-center rounded-full bg-white"><span className="tabular font-display text-[22px] font-semibold tracking-tight">{available ? formatNumber(data?.total || 0) : '—'}</span><span className="mt-1 text-[8px] uppercase tracking-widest text-[#a0aab2]">observations</span></div></div>
          <div className="flex-1 space-y-3.5">{(distribution.length ? distribution : [{ key: 'unclassified', name: 'No classifications', value: 0, color: '#b5c0c7' }]).map(item => <div key={item.key} className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-[10px] text-[#7e8c96]"><span className="h-1.5 w-1.5 rounded-full" style={{background: item.color}} />{item.name}</span><span className="tabular text-[10px] font-medium text-[#53616c]">{data?.total ? `${(item.value / data.total * 100).toFixed(1)}%` : '—'}</span></div>)}</div>
        </div>
      </section>
    </div>
    <div className="mt-5 flex flex-wrap items-center justify-between gap-2 px-1 text-[9px] text-[#a5aeb5]"><span className="flex items-center gap-1.5"><CircleHelp size={11} />Decision support, not incident confirmation. Always verify on the ground.</span><button className="flex items-center gap-1 hover:text-[#788a97]" onClick={onSources}>NASA FIRMS · Sentinel-2 · OpenStreetMap<ArrowRight size={10} /></button></div>
  </div>;
}
