'use client';
import { useEffect, useState } from 'react';
import { ArrowRight, Bookmark, CheckCheck, ChevronLeft, ChevronRight, Download, Filter, MapPin, Search, Trash2 } from 'lucide-react';
import { api, useApi } from '@/lib/api';
import { coordinates, formatDate, formatNumber, formatTime, satelliteName } from '@/lib/constants';
import type { SourceStatus, ThermalEvent } from '@/lib/types';
import { ClassBadge, EmptyState, ErrorState, Loading, StatusBadge } from './ui';

function ObservationTable({ events, onSelect, watchlist = false, onRemove }: {events: ThermalEvent[]; onSelect: (event: ThermalEvent) => void; watchlist?: boolean; onRemove?: (event: ThermalEvent) => void}) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[740px] text-left text-[11px]"><thead className="border-y border-[#edf0f3] bg-[#fbfcfd] text-[9px] font-medium uppercase tracking-[.06em] text-[#9aa6af]"><tr><th className="px-5 py-3.5 font-medium">Observation / location</th><th className="px-3 py-3.5 font-medium">Acquired · UTC</th><th className="px-3 py-3.5 font-medium">Source-type candidate</th><th className="px-3 py-3.5 font-medium">FRP</th><th className="px-3 py-3.5 font-medium">Model score</th><th className="px-3 py-3.5 font-medium">Review</th><th className="w-10 px-4"><span className="sr-only">Inspect</span></th></tr></thead>
    <tbody className="divide-y divide-[#edf0f3]">{events.map(event => <tr key={event.id} className="group transition-colors hover:bg-[#fcfaf8]"><td className="px-5 py-4"><button onClick={() => onSelect(event)} className="flex items-center gap-3 text-left"><span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#edf0f2] bg-[#f7f9fa] text-[#9aaab4]"><MapPin size={15} strokeWidth={1.5} /></span><span><span className="tabular block text-[11px] font-medium text-[#586976]">{coordinates(event.latitude,event.longitude)}</span><span className="mt-1 block font-mono text-[8px] text-[#aab3bb]">{event.id}</span></span></button></td>
      <td className="px-3 py-4"><span className="block text-[#71828e]">{formatDate(event.acquiredAt,{year:undefined})} · {formatTime(event.acquiredAt)}</span><span className="mt-1 block text-[9px] text-[#a3aeb7]">{satelliteName(event.satellite)} · {event.daynight === 'D' ? 'Day' : 'Night'}</span></td>
      <td className="px-3 py-4"><ClassBadge classKey={event.prediction.classKey} compact /></td>
      <td className="tabular whitespace-nowrap px-3 py-4 font-medium text-[#647580]">{event.frp.toFixed(1)} <span className="text-[9px] font-normal text-[#a4afb7]">MW</span>{event.frp >= 50 && <span className="ml-1.5 inline-block h-1 w-1 rounded-full bg-[#df935b]" title="Above the 50 MW review threshold" />}</td>
      <td className="tabular px-3 py-4 text-[#83929c]">{event.prediction.score === null ? '—' : `${(event.prediction.score*100).toFixed(1)}%`}<span className="mt-1 block text-[8px] text-[#b0b8be]">{event.prediction.classKey === 'uncertain' ? 'Abstained' : 'Uncalibrated'}</span></td>
      <td className="px-3 py-4 text-[9px] text-[#a1adb6]">{event.review?.state === 'watching' ? <span className="inline-flex items-center gap-1 text-[#b1956d]"><Bookmark size={10} />Watching</span> : event.review?.state === 'reviewed' ? <span className="inline-flex items-center gap-1 text-[#81a292]"><CheckCheck size={11} />Reviewed</span> : 'Unreviewed'}</td>
      <td className="px-4 py-4">{watchlist && onRemove ? <button aria-label={`Remove ${event.id} from review list`} className="icon-button" onClick={() => onRemove(event)}><Trash2 size={13} /></button> : <button aria-label={`Inspect ${event.id}`} className="icon-button" onClick={() => onSelect(event)}><ChevronRight size={14} /></button>}</td>
    </tr>)}</tbody></table></div>;
}

export function ObservationsView({ query, refresh, onSelect }: {query: string; refresh: number; onSelect: (event: ThermalEvent) => void}) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [sort, setSort] = useState('recent');
  useEffect(() => { const timer = setTimeout(() => setDebounced(search), 300); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { setPage(1); }, [query, debounced, sort]);
  const url = `/api/observations?${query}&page=${page}&pageSize=12&sort=${sort}&q=${encodeURIComponent(debounced)}`;
  const {data, loading, error, reload} = useApi<{events: ThermalEvent[]; total: number; page: number; pageSize: number}>(url, refresh);
  const pages = Math.max(1, Math.ceil((data?.total || 0)/12));
  return <section className="panel overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-5"><div><h2 className="font-display text-sm font-semibold">Observation catalog</h2><p className="mt-1 text-[10px] text-[#9ba8b2]">Individual satellite pixels, not a count of independent fire incidents.</p></div><div className="flex flex-wrap gap-2"><label className="relative"><Search size={13} className="absolute left-3 top-3 text-[#a4b0b8]" /><input aria-label="Search observation ID, coordinates, class or satellite" className="field w-64 pl-9" placeholder="Search ID, coordinates or satellite…" value={search} onChange={event => setSearch(event.target.value)} /></label><select aria-label="Sort observations" className="field w-auto" value={sort} onChange={event => setSort(event.target.value)}><option value="recent">Most recent</option><option value="frp">Highest FRP</option><option value="score">Highest model score</option></select></div></div>
    {error ? <div className="p-5"><ErrorState message={error} retry={reload} /></div> : loading && !data ? <Loading text="Querying real observations…" /> : data?.events.length ? <ObservationTable events={data.events} onSelect={onSelect} /> : <EmptyState title="No matching observations" description="Try a different region, source type, or date window. If you selected near-real-time mode, check that NASA FIRMS is reachable." />}
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#edf0f2] px-5 py-4 text-[10px] text-[#9ba7b0]"><div>{data?.total ? `${formatNumber((page-1)*12+1)}–${formatNumber(Math.min(page*12,data.total))} of ${formatNumber(data.total)} observations` : '0 matching observations'}<span className="mx-3 hidden text-[#d0d7dc] sm:inline">|</span><a className="hidden items-center gap-1.5 text-[#9e866e] hover:text-[#b6794d] sm:inline-flex" href={`/api/export?${query}&format=csv&q=${encodeURIComponent(debounced)}`}><Download size={11} />Export matching records</a></div><div className="flex items-center gap-3"><button aria-label="Previous observation page" className="icon-button border border-[#e6ebee]" disabled={page <= 1 || loading} onClick={() => setPage(page-1)}><ChevronLeft size={13} /></button><span className="tabular">{page} / {pages}</span><button aria-label="Next observation page" className="icon-button border border-[#e6ebee]" disabled={page >= pages || loading} onClick={() => setPage(page+1)}><ChevronRight size={13} /></button></div></div>
  </section>;
}

export function WatchlistView({ refresh, onSelect, notify }: {refresh: number; onSelect: (event: ThermalEvent) => void; notify: (message: string, error?: boolean) => void}) {
  const {data, error, loading, reload} = useApi<{events: ThermalEvent[]; storage: SourceStatus}>('/api/watchlist', refresh);
  const [tab, setTab] = useState('all');
  const [removing, setRemoving] = useState<string | null>(null);
  const events = data?.events.filter(event => tab === 'all' || event.review?.state === tab) || [];
  async function remove(event: ThermalEvent) {
    if (removing) return;
    setRemoving(event.id);
    try { await api(`/api/events/${event.id}/review`, {method:'POST', body:JSON.stringify({state:'clear'})}); reload(); notify('Observation removed from the persistent review list.'); }
    catch (error) { notify((error as Error).message,true); }
    finally { setRemoving(null); }
  }
  return <div>
    <div className="mb-5 flex items-start gap-3 rounded-lg border border-[#e4e9ec] bg-[#f0f4f7] p-4"><Bookmark size={17} className="mt-0.5 shrink-0 text-[#8b9fac]" /><p className="text-[11px] leading-6 text-[#8599a6]">Your analyst review queue contains only observations you saved. High FRP is a transparent prioritization rule, not a verified emergency. No SMS, email, or emergency-service notifications are sent by this prototype.</p></div>
    <section className="panel overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 px-5 py-5"><div className="flex items-center gap-5">{[['all','All saved'],['watching','Watching'],['reviewed','Reviewed']].map(([value,label]) => <button key={value} onClick={() => setTab(value)} className={`border-b-2 pb-1.5 text-xs ${tab === value ? 'border-[#dfa47d] font-semibold text-[#7b6757]' : 'border-transparent text-[#a0adb6]'}`}>{label} <span className="ml-1 text-[9px] font-normal text-[#a5afb7]">{data?.events.filter(event => value === 'all' || event.review?.state === value).length ?? '—'}</span></button>)}</div>{data?.storage && <StatusBadge state={data.storage.status} />}</div>
      {error ? <div className="p-5"><ErrorState message={error} retry={reload} /></div> : loading ? <Loading text="Reading your saved review list…" /> : events.length ? <ObservationTable events={events} onSelect={onSelect} watchlist onRemove={remove} /> : <EmptyState icon={<Bookmark size={23} strokeWidth={1.4} />} title="A clear review queue" description="Inspect a real map point or catalog observation, then choose “Add to watchlist”. Your notes and review state will be persisted, not pre-filled." />}
      {data?.storage && <div className="border-t border-[#edf0f3] px-5 py-4 text-[10px] text-[#99a7b1]">{data.storage.detail}</div>}
    </section>
  </div>;
}
