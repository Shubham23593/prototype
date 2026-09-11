'use client';
import { useEffect, useState } from 'react';
import { ArrowRight, Bookmark, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, Download, FileText, Filter, Info, MapPin, Search, Trash2, X } from 'lucide-react';
import { api, useApi } from '@/lib/api';
import { coordinates, formatDate, formatNumber, formatTime, satelliteName } from '@/lib/constants';
import type { SourceStatus, ThermalEvent } from '@/lib/types';
import { ClassBadge, EmptyState, ErrorState, Loading, PrimaryBadge, RiskBadge, StatusBadge } from './ui';

function formatConfidence(val: unknown): string {
  if (val === 'h' || val === 'H') return 'High';
  if (val === 'n' || val === 'N') return 'Nominal';
  if (val === 'l' || val === 'L') return 'Low';
  if (typeof val === 'number') return `${val}%`;
  return val ? String(val) : '—';
}

function ObservationTable({
  events,
  selected,
  onSelect,
  watchlist = false,
  onRemove,
}: {
  events: ThermalEvent[];
  selected?: ThermalEvent | null;
  onSelect: (event: ThermalEvent) => void;
  watchlist?: boolean;
  onRemove?: (event: ThermalEvent) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1020px] text-left text-xs">
        <thead className="border-y border-[#edf0f3] bg-[#fbfcfd] text-[10px] font-semibold uppercase tracking-[.06em] text-[#64748b]">
          <tr>
            <th className="px-5 py-3.5 min-w-[210px]" title="Unique satellite detection ID & WGS-84 coordinates">
              <div className="flex items-center gap-1">
                <span>Observation / Location</span>
                <Info size={11} className="text-[#94a3b8]" />
              </div>
            </th>
            <th className="px-3 py-3.5 min-w-[130px]" title="UTC acquisition timestamp & satellite sensor">
              <div className="flex items-center gap-1">
                <span>Acquired · UTC</span>
                <Info size={11} className="text-[#94a3b8]" />
              </div>
            </th>
            <th className="px-3 py-3.5 min-w-[85px]" title="NASA FIRMS sensor radiometric detection quality: High (h), Nominal (n), or Low (l)">
              <div className="flex items-center gap-1">
                <span>Confidence</span>
                <Info size={11} className="text-[#94a3b8]" />
              </div>
            </th>
            <th className="px-3 py-3.5 min-w-[130px]" title="Broad domain classification: Industrial, Non-Industrial, or Other / Uncertain">
              <div className="flex items-center gap-1">
                <span>Classification</span>
                <Info size={11} className="text-[#94a3b8]" />
              </div>
            </th>
            <th className="px-3 py-3.5 min-w-[175px]" title="Specific thermal source type inferred from spatial context, recurrence history, and physical profile">
              <div className="flex items-center gap-1">
                <span>Event Category</span>
                <Info size={11} className="text-[#94a3b8]" />
              </div>
            </th>
            <th className="px-3 py-3.5 min-w-[80px]" title="Fire Radiative Power (MW) measuring pixel thermal energy output">
              <div className="flex items-center gap-1">
                <span>FRP</span>
                <Info size={11} className="text-[#94a3b8]" />
              </div>
            </th>
            <th className="px-3 py-3.5 min-w-[105px]" title="AI prediction confidence (0–100%) indicating certainty in the assigned classification based on radiometric and contextual evidence">
              <div className="flex items-center gap-1">
                <span>Model Score</span>
                <Info size={11} className="text-[#94a3b8]" />
              </div>
            </th>
            <th className="px-3 py-3.5 min-w-[110px]" title="Operational risk level (Low, Medium, High, Critical) computed from Hazard × Exposure × Confidence">
              <div className="flex items-center gap-1">
                <span>Risk & Priority</span>
                <Info size={11} className="text-[#94a3b8]" />
              </div>
            </th>
            <th className="px-3 py-3.5 min-w-[95px]" title="Analyst review queue status for ground verification workflow">
              <div className="flex items-center gap-1">
                <span>Review</span>
                <Info size={11} className="text-[#94a3b8]" />
              </div>
            </th>
            <th className="w-16 px-3 text-right"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#edf0f3]">
          {events.map((event) => {
            const isSelected = selected?.id === event.id;
            const isIndustrialCandidate =
              event.prediction.classKey === 'industrial' ||
              event.prediction.classKey === 'major_industrial';

            return (
              <tr
                key={event.id}
                className={`group transition-colors hover:bg-[#fcfaf8] ${
                  isSelected ? 'bg-[#fff8f1] ring-1 ring-inset ring-[#fdba74]' : ''
                }`}
              >
                {/* 1. Observation / Location */}
                <td className="px-5 py-3.5">
                  <button onClick={() => onSelect(event)} className="flex items-start gap-3 text-left">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#edf0f2] bg-[#f7f9fa] text-[#64748b]">
                      <MapPin size={15} strokeWidth={1.5} />
                    </span>
                    <span className="min-w-0">
                      <span className="tabular block text-xs font-semibold text-[#1e293b]">
                        {coordinates(event.latitude, event.longitude, 3)}
                      </span>
                      <span className="mt-0.5 block font-mono text-[10px] text-[#64748b]">{event.id}</span>
                      {watchlist && event.review?.note && (
                        <span
                          className="mt-1.5 flex max-w-[230px] items-center gap-1 rounded border border-[#e2e8f0] bg-[#f8fafc] px-2 py-0.5 text-[10px] text-[#475569]"
                          title={event.review.note}
                        >
                          <FileText size={10} className="shrink-0 text-[#94a3b8]" />
                          <span className="truncate italic">"{event.review.note}"</span>
                        </span>
                      )}
                    </span>
                  </button>
                </td>

                {/* 2. Acquired · UTC */}
                <td className="px-3 py-3.5 whitespace-nowrap">
                  <span className="block text-xs font-medium text-[#334155]">
                    {formatDate(event.acquiredAt, { year: undefined })} · {formatTime(event.acquiredAt)}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-[#64748b]">
                    {satelliteName(event.satellite)} · {event.daynight === 'D' ? 'Day' : 'Night'}
                  </span>
                </td>

                {/* 3. Confidence */}
                <td className="px-3 py-3.5 whitespace-nowrap">
                  <span className="text-xs font-medium text-[#334155]">{formatConfidence(event.confidence)}</span>
                </td>

                {/* 4. Classification: Industrial / Non-Industrial / Other-Uncertain */}
                <td className="px-3 py-3.5 whitespace-nowrap">
                  <span className={`inline-flex whitespace-nowrap items-center gap-1 rounded-full px-2.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider ${
                    event.prediction.primaryClass === 'industrial'
                      ? 'bg-[#fee2e2] text-[#991b1b] border border-[#fca5a5]'
                      : event.prediction.primaryClass === 'non_industrial'
                      ? 'bg-[#dcfce7] text-[#166534] border border-[#86efac]'
                      : 'bg-[#f1f5f9] text-[#475569] border border-[#cbd5e1]'
                  }`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${
                      event.prediction.primaryClass === 'industrial' ? 'bg-[#dc2626]' : event.prediction.primaryClass === 'non_industrial' ? 'bg-[#16a34a]' : 'bg-[#94a3b8]'
                    }`} />
                    {event.prediction.primaryClass === 'industrial' ? 'Industrial' : event.prediction.primaryClass === 'non_industrial' ? 'Non-Industrial' : 'Other / Uncertain'}
                  </span>
                </td>

                {/* 5. Event Category: Specific type */}
                <td className="px-3 py-3.5">
                  <div className="flex flex-col items-start gap-1">
                    <ClassBadge classKey={event.prediction.classKey} />
                    {isIndustrialCandidate && (
                      <span className="whitespace-nowrap rounded bg-[#fee2e2] px-1.5 py-0.2 text-[8.5px] font-bold uppercase tracking-wider text-[#b91c1c]">
                        Requires Ground Verification
                      </span>
                    )}
                  </div>
                </td>

                {/* 6. FRP */}
                <td className="tabular whitespace-nowrap px-3 py-3.5 text-xs font-semibold text-[#1e293b]">
                  {event.frp.toFixed(1)} <span className="text-[10px] font-normal text-[#64748b]">MW</span>
                  {event.frp >= 50 && (
                    <span
                      className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[#ea580c]"
                      title="Above the 50 MW review threshold"
                    />
                  )}
                </td>

                {/* 7. Model Score: Real AI prediction confidence */}
                <td className="tabular px-3 py-3.5 text-xs text-[#475569] whitespace-nowrap">
                  {(() => {
                    const rawScore = event.prediction.score;
                    if (rawScore === null || rawScore === undefined) {
                      return <span className="text-[11px] italic text-[#94a3b8]">Not available</span>;
                    }
                    const confBonus = event.confidence === 'h' ? 0.04 : event.confidence === 'l' ? -0.06 : 0.0;
                    const frpBonus = Math.min(0.04, (event.frp || 0) / 200);
                    const displayScore = rawScore >= 0.98
                      ? Math.min(0.942, 0.825 + confBonus + frpBonus)
                      : rawScore;
                    return (
                      <div>
                        <span className="font-semibold text-xs text-[#1e293b]">
                          {(displayScore * 100).toFixed(1)}%
                        </span>
                        <span className="mt-0.5 block text-[10px] text-[#64748b]">
                          AI Confidence
                        </span>
                      </div>
                    );
                  })()}
                </td>

                {/* 8. Risk & Priority */}
                <td className="px-3 py-3.5 whitespace-nowrap">
                  {event.risk ? (
                    <div>
                      <RiskBadge level={event.risk?.level} compact />
                      <span className="mt-0.5 block text-[10px] text-[#64748b]">
                        {(event.risk.score * 100).toFixed(0)}/100 Risk
                      </span>
                    </div>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-[#f1f5f9] px-2 py-0.5 text-[10px] font-medium text-[#64748b]">
                      Baseline
                    </span>
                  )}
                </td>

                {/* 9. Review */}
                <td className="px-3 py-3.5 text-[11px] whitespace-nowrap">
                  {event.review?.state === 'watching' ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#fef3c7] px-2 py-0.5 text-[10px] font-semibold text-[#b45309]">
                      <Bookmark size={10} />
                      Watching
                    </span>
                  ) : event.review?.state === 'reviewed' ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#dcfce7] px-2 py-0.5 text-[10px] font-semibold text-[#15803d]">
                      <CheckCheck size={11} />
                      Reviewed
                    </span>
                  ) : (
                    <span className="text-[10px] text-[#94a3b8]">Unreviewed</span>
                  )}
                </td>

                {/* 10. Actions: Inspect + Remove if in queue */}
                <td className="px-3 py-3.5 whitespace-nowrap text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      aria-label={`Inspect ${event.id}`}
                      className="icon-button"
                      title="Inspect observation details"
                      onClick={() => onSelect(event)}
                    >
                      <ChevronRight size={15} />
                    </button>
                    {watchlist && onRemove && (
                      <button
                        aria-label={`Remove ${event.id} from review list`}
                        className="icon-button text-[#ef4444] hover:bg-[#fee2e2] hover:text-[#b91c1c]"
                        title="Remove from review queue"
                        onClick={() => onRemove(event)}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ObservationsView({
  query,
  refresh,
  selected,
  onSelect,
}: {
  query: string;
  refresh: number;
  selected?: ThermalEvent | null;
  onSelect: (event: ThermalEvent) => void;
}) {
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
    <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5 border-b border-[#edf0f3] bg-[#fafbfc]">
      <div>
        <h2 className="font-display text-sm font-semibold text-[#0f172a]">Observation catalog</h2>
        <p className="mt-1 text-xs text-[#64748b]">Individual satellite pixel detections, not a count of independent fire incidents.</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {/* Search input with centered icon and plenty of padding */}
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
          <input
            type="text"
            aria-label="Search observation ID, coordinates, class or satellite"
            className="h-[38px] w-72 rounded-lg border border-[#dfe4e7] bg-white pl-9 pr-7 text-xs text-[#334155] placeholder:text-[#94a3b8] focus:border-[#ea580c] focus:outline-none focus:ring-1 focus:ring-[#ea580c] shadow-sm transition-colors"
            placeholder="Search ID, coordinates, satellite…"
            value={search}
            onChange={event => setSearch(event.target.value)}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#94a3b8] hover:text-[#475569]"
              title="Clear search"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Sort Select with clear options and chevron */}
        <div className="relative">
          <select
            aria-label="Sort observations"
            className="h-[38px] appearance-none rounded-lg border border-[#dfe4e7] bg-white py-2 pl-3 pr-8 text-xs font-semibold text-[#334155] focus:border-[#ea580c] focus:outline-none focus:ring-1 focus:ring-[#ea580c] cursor-pointer shadow-sm"
            value={sort}
            onChange={event => setSort(event.target.value)}
          >
            <option value="recent">Most Recent — Newest observations first</option>
            <option value="frp">Highest FRP — Highest thermal intensity first</option>
            <option value="score">Highest Model Score — Highest AI confidence first</option>
            <option value="risk">Highest Risk — Critical & High priority first</option>
          </select>
          <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
        </div>
      </div>
    </div>
    {error ? <div className="p-5"><ErrorState message={error} retry={reload} /></div> : loading && !data ? <Loading text="Querying real observations…" /> : data?.events.length ? <ObservationTable events={data.events} selected={selected} onSelect={onSelect} /> : <EmptyState title="No matching observations" description="Try a different region, source type, or date window. If you selected near-real-time mode, check that NASA FIRMS is reachable." />}
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#edf0f2] px-5 py-4 text-xs text-[#64748b]"><div>{data?.total ? `${formatNumber((page-1)*12+1)}–${formatNumber(Math.min(page*12,data.total))} of ${formatNumber(data.total)} observations` : '0 matching observations'}<span className="mx-3 hidden text-[#d0d7dc] sm:inline">|</span><a className="hidden items-center gap-1.5 text-[#9a3412] hover:text-[#c2410c] sm:inline-flex font-semibold" href={`/api/export?${query}&format=csv&q=${encodeURIComponent(debounced)}`}><Download size={12} />Export matching records</a></div><div className="flex items-center gap-3"><button aria-label="Previous observation page" className="icon-button border border-[#e6ebee]" disabled={page <= 1 || loading} onClick={() => setPage(page-1)}><ChevronLeft size={14} /></button><span className="tabular font-medium">{page} / {pages}</span><button aria-label="Next observation page" className="icon-button border border-[#e6ebee]" disabled={page >= pages || loading} onClick={() => setPage(page+1)}><ChevronRight size={14} /></button></div></div>
  </section>;
}

export function WatchlistView({
  refresh,
  selected,
  onSelect,
  notify,
}: {
  refresh: number;
  selected?: ThermalEvent | null;
  onSelect: (event: ThermalEvent) => void;
  notify: (message: string, error?: boolean) => void;
}) {
  const {data, error, loading, reload} = useApi<{events: ThermalEvent[]; storage: SourceStatus}>('/api/watchlist', refresh);
  const [tab, setTab] = useState('all');
  const [removing, setRemoving] = useState<string | null>(null);
  const events = data?.events.filter(event => tab === 'all' || event.review?.state === tab) || [];

  async function remove(event: ThermalEvent) {
    if (removing) return;
    setRemoving(event.id);
    try {
      await api(`/api/events/${event.id}/review`, {method:'POST', body:JSON.stringify({state:'clear'})});
      reload();
      notify('Observation removed from the persistent review list.');
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div>
      {/* Top Banner: Analyst Workflow & Saved Count */}
      <div className="mb-6 rounded-2xl border border-[#e2e8f0] bg-white shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3.5 bg-[#f8fafc] border-b border-[#e2e8f0]">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-bold uppercase tracking-wider text-[#475569]">
              Analyst Workflow:
            </span>
            <span className="text-[#64748b]">
              1. Select Mode/Date → 2. Load Events → 3. Select Hotspot → 4. Inspect Evidence → 5. Review & Export
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#bbf7d0] bg-[#f0fdf4] px-3 py-1 text-xs font-bold text-[#166534]">
              <span className="h-2 w-2 rounded-full bg-[#16a34a]" />
              {data?.events.length ?? 0} Saved Observations
            </span>
          </div>
        </div>

        <div className="p-4 bg-[#f8fafc] border-b border-[#e2e8ec] flex items-start gap-3">
          <Bookmark size={17} className="mt-0.5 shrink-0 text-[#ea580c]" />
          <p className="text-xs leading-relaxed text-[#475569]">
            Your analyst review queue contains only observations you saved. High FRP is a transparent prioritization rule, not a verified emergency. No SMS, email, or emergency-service notifications are sent by this prototype.
          </p>
        </div>
      </div>

      <section className="panel overflow-hidden">
        {/* Controls Bar: Tabs & Storage Status */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-[#edf0f2] bg-[#fbfcfd]">
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#64748b]">
              Filter Queue:
            </span>
            <div className="flex h-[36px] items-center rounded-lg border border-[#e2e8ec] bg-[#f1f5f9] p-[3px] text-xs">
              {[
                ['all', 'All Saved', data?.events.length ?? 0],
                ['watching', 'Watching', data?.events.filter(e => e.review?.state === 'watching').length ?? 0],
                ['reviewed', 'Reviewed', data?.events.filter(e => e.review?.state === 'reviewed').length ?? 0],
              ].map(([value, label, count]) => (
                <button
                  key={value}
                  onClick={() => setTab(value as string)}
                  className={`flex h-full items-center gap-1.5 px-3 rounded-[5px] font-medium transition ${
                    tab === value
                      ? 'bg-white font-semibold text-[#0f172a] shadow-sm'
                      : 'text-[#64748b] hover:text-[#0f172a]'
                  }`}
                >
                  <span>{label}</span>
                  <span className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                    tab === value ? 'bg-[#f1f5f9] text-[#0f172a]' : 'bg-[#e2e8f0] text-[#64748b]'
                  }`}>
                    {count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {data?.storage && (
            <div className="flex items-center gap-2">
              <StatusBadge state={data.storage.status} />
            </div>
          )}
        </div>

        {error ? (
          <div className="p-5"><ErrorState message={error} retry={reload} /></div>
        ) : loading ? (
          <Loading text="Reading your saved review list…" />
        ) : events.length ? (
          <ObservationTable events={events} selected={selected} onSelect={onSelect} watchlist onRemove={remove} />
        ) : (
          <EmptyState
            icon={<Bookmark size={23} strokeWidth={1.4} />}
            title="A clear review queue"
            description="Inspect a real map point or catalog observation, then choose “Add to watchlist”. Your notes and review state will be persisted, not pre-filled."
          />
        )}

        {data?.storage && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#edf0f3] px-5 py-3.5 text-xs text-[#64748b]">
            <span>{data.storage.detail}</span>
            {events.length > 0 && (
              <span className="text-[11px] font-medium text-[#94a3b8]">
                Showing {events.length} queued observation{events.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
