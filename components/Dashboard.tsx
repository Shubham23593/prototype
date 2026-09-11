'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, Bell, BookOpen, Bookmark, BrainCircuit, CalendarDays, Check, ChevronDown, ChevronRight, CircleHelp, Clock3, Database, Download, FileJson, FileSpreadsheet, Flame, Globe2, History, LayoutDashboard, ListFilter, LoaderCircle, MapPin, Menu, Network, Radio, RefreshCw, Satellite, ScanLine, Search, Settings2, ShieldCheck, Sparkles, X } from 'lucide-react';
import { api, useApi } from '@/lib/api';
import { CLASSES, formatDate, formatNumber, REGIONS } from '@/lib/constants';
import type { ClassKey, DataMode, Evidence, FilterCategory, Page, SourceStatus, ThermalEvent, WindowSize } from '@/lib/types';
import OverviewView, { type OverviewData } from './OverviewView';
import { ObservationsView, WatchlistView } from './ObservationsView';
import HistoryView, { type ImportedDataset } from './HistoryView';
import ModelView from './ModelView';
import SourcesView from './SourcesView';
import ObservationDrawer from './ObservationDrawer';
import NotificationPanel from './NotificationPanel';
import { ErrorState, Modal, Toast } from './ui';

const PAGES: Record<Page,{label:string;title:string;description:string;icon:React.ReactNode}> = {
  overview:{label:'Overview',title:'Thermal intelligence',description:'From satellite signals to a clearer picture. All your thermal insights, in one place.',icon:<LayoutDashboard size={17} strokeWidth={1.65}/>},
  observations:{label:'Observations',title:'Observation catalog',description:'Explore genuine satellite detections, provisional source types, and original measurements.',icon:<ScanLine size={17} strokeWidth={1.65}/>},
  watchlist:{label:'Review queue',title:'A closer look, where it matters.',description:'Your saved observations and analyst notes. No pre-filled incidents or simulated alerts.',icon:<Bookmark size={17} strokeWidth={1.65}/>},
  history:{label:'Historical data',title:'Built on real observations.',description:'Trace every record to its source. Explore the archive and bring your own training data.',icon:<Database size={17} strokeWidth={1.65}/>},
  model:{label:'Model lab',title:'Understand the intelligence.',description:'A working XGBoost model, reproducible training, and evaluation without the inflated claims.',icon:<BrainCircuit size={17} strokeWidth={1.65}/>},
  sources:{label:'Data sources',title:'Connected to the source.',description:'Inspect genuine API connections, data provenance, and the limits of each signal.',icon:<Network size={17} strokeWidth={1.65}/>},
};
function UTCClock(){const [time,setTime]=useState<string|null>(null);useEffect(()=>{const update=()=>setTime(new Date().toLocaleTimeString('en-GB',{timeZone:'UTC',hour12:false,hour:'2-digit',minute:'2-digit'}));update();const id=setInterval(update,30000);return()=>clearInterval(id);},[]);return <span className="tabular hidden items-center gap-1.5 text-[10px] text-[#9aa7b0] sm:flex"><Clock3 size={12}/>{time||'--:--'} UTC</span>;}

export default function Dashboard(){
  const [page,setPage]=useState<Page>('overview');
  const [mobileNav,setMobileNav]=useState(false);
  const [mode,setMode]=useState<DataMode>('archive');
  const [regionId,setRegionId]=useState('india');
  const [windowSize,setWindowSize]=useState<WindowSize>('7d');
  const [classKey,setClassKey]=useState<FilterCategory>('all');
  const [dates,setDates]=useState<{from:string;to:string}|null>(null);
  const [dateModal,setDateModal]=useState(false);
  const [dateFrom,setDateFrom]=useState('');
  const [dateTo,setDateTo]=useState('');
  const [dateError,setDateError]=useState<string|null>(null);
  const [refresh,setRefresh]=useState(0);
  const [refreshing,setRefreshing]=useState(false);
  const [selected,setSelected]=useState<ThermalEvent|null>(null);
  const [evidence,setEvidence]=useState<Evidence|null>(null);
  const [fullScreen,setFullScreen]=useState(false);
  const [exportOpen,setExportOpen]=useState(false);
  const [imported,setImported]=useState<ImportedDataset|null>(null);
  const [toast,setToast]=useState<{message:string;error?:boolean}|null>(null);
  const [notificationsOpen,setNotificationsOpen]=useState(false);
  const [readAlertIds,setReadAlertIds]=useState<Set<string>>(new Set());
  const [dismissedBannerSignature,setDismissedBannerSignature]=useState<string|null>(null);
  const lastAlertSignatureRef=useRef<string>('');
  const exportRef=useRef<HTMLDivElement>(null);
  const initialModeApplied=useRef(false);
  const userChoseMode=useRef(false);
  const notify=useCallback((message:string,error=false)=>setToast({message,error}),[]);
  const clearToast=useCallback(()=>setToast(null),[]);
  const forceRefresh=useCallback(()=>setRefresh(value=>value+1),[]);
  const health=useApi<{sources:SourceStatus[];defaultMode:DataMode;archiveAvailable:boolean}>('/api/health',refresh,60000);
  useEffect(() => {
    if (health.data && !initialModeApplied.current) {
      initialModeApplied.current = true;
      if (!userChoseMode.current) {
        setMode(health.data.defaultMode);
        if (health.data.defaultMode === 'live') {
          setRegionId('india');
          setWindowSize('24h');
          setClassKey('all');
        }
      }
    }
  }, [health.data]);
  const query=new URLSearchParams({mode,region:regionId,window:windowSize,classKey,...(dates||{})}).toString();
  const spatialPage=page==='overview'||page==='observations';
  const overview=useApi<OverviewData>(spatialPage?`/api/overview?${query}`:null,refresh,mode==='live'&&spatialPage?60000:0);
  const data=overview.data;
  const availableRegions = data?.regions || REGIONS;
  const region = availableRegions.find(item=>item.id===regionId) || data?.region || availableRegions[0];
  const rawAlerts: ThermalEvent[] = data?.alerts || (data?.events?.filter(e => e.risk?.level === 'critical' || e.risk?.level === 'high') || []);
  const alerts: ThermalEvent[] = Array.from(
    new Map(
      rawAlerts
        .filter(e => e.risk && (e.risk.level === 'critical' || e.risk.level === 'high'))
        .map(a => [a.id, a])
    ).values()
  );
  const unreadAlertCount = alerts.filter(a => !readAlertIds.has(a.id)).length;
  const filterSignature = `${mode}-${region.id}-${windowSize}-${classKey}-${dates?.from || ''}-${dates?.to || ''}-${data?.total || 0}-${alerts.length}`;

  useEffect(() => {
    if (!data) return;
    if (lastAlertSignatureRef.current !== filterSignature) {
      lastAlertSignatureRef.current = filterSignature;
      const count = alerts.length;
      if (count > 0) {
        const timeText = dates ? 'the selected observation period' : windowSize === '24h' ? 'the last 24 hours' : windowSize === '48h' ? 'the last 48 hours' : 'the last 7 days';
        notify(`${count} High/Critical event${count === 1 ? '' : 's'} detected in ${timeText}.`);
      }
    }
  }, [filterSignature, alerts.length, data, dates, windowSize, notify]);

  useEffect(() => {
    if (data?.region && mode === 'archive' && regionId === 'india' && data.region.id !== 'india') {
      setRegionId(data.region.id);
    }
  }, [data?.region, mode, regionId]);
  const nasa=health.data?.sources.find(source=>source.id==='firms');
  const liveConnected=nasa?.status==='connected';
  const onEvidence=useCallback((value:Evidence)=>{setEvidence(value);if(value.prediction)setSelected(current=>current?{...current,prediction:value.prediction!}:current);},[]);
  const onSelect=useCallback((event:ThermalEvent)=>{setSelected(event);setEvidence(null);},[]);
  const navigate=useCallback((next:Page)=>{setPage(next);setSelected(null);setEvidence(null);setMobileNav(false);setFullScreen(false);window.history.pushState(null,'',`#${next}`);window.scrollTo({top:0,behavior:'instant'});},[]);
  useEffect(()=>{
    const sync=()=>{const value=window.location.hash.slice(1) as Page;if(Object.hasOwn(PAGES,value))setPage(value);else setPage('overview');};sync();window.addEventListener('hashchange',sync);window.addEventListener('popstate',sync);
    try{
      const saved=window.localStorage.getItem('thermoscan-imported-dataset');
      if(saved){
        const parsed=JSON.parse(saved);
        if(parsed&&Number(parsed.rows)>0)setImported(parsed);
        else window.localStorage.removeItem('thermoscan-imported-dataset');
      }
    }catch{/* Local browser storage is optional. */}
    return()=>{window.removeEventListener('hashchange',sync);window.removeEventListener('popstate',sync);};
  },[]);
  useEffect(()=>{if(!fullScreen)return;const key=(event:KeyboardEvent)=>{if(event.key==='Escape')setFullScreen(false);};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);},[fullScreen]);
  useEffect(()=>{if(!exportOpen)return;const close=(event:MouseEvent)=>{if(!exportRef.current?.contains(event.target as Node))setExportOpen(false);};document.addEventListener('mousedown',close);return()=>document.removeEventListener('mousedown',close);},[exportOpen]);
  function setDataMode(next: DataMode) {
    userChoseMode.current = true;
    setMode(next);
    setDates(null);
    setSelected(null);
    setEvidence(null);
    if (next === 'live') {
      setRegionId('india');
      setWindowSize('24h');
      setClassKey('all');
    }
  }
  async function reload(){
    setRefreshing(true);
    try{
      if(mode==='live'){
        const res=await api<{count:number;source:string;status:string;error?:string}>('/api/sources/firms/refresh',{method:'POST',body:'{}'});
        if(res.error){
          notify(`NASA FIRMS: ${res.error}`,true);
        }else{
          notify(`Fetched ${res.count} live NASA FIRMS observations.`);
        }
        health.reload();
      }else if(spatialPage){
        await api('/api/sources/check',{method:'POST',body:'{}'});
      }
      forceRefresh();
    }catch(error){
      notify((error as Error).message,true);
    }finally{
      setRefreshing(false);
    }
  }
  function openDates(){setDateFrom(dates?.from||data?.range.from?.slice(0,10)||'');setDateTo(dates?.to||data?.range.to?.slice(0,10)||'');setDateError(null);setDateModal(true);}
  function applyDates(){if(!dateFrom||!dateTo||dateFrom>dateTo){setDateError('Choose valid start and end dates, in that order.');return;}if(Date.parse(dateTo)-Date.parse(dateFrom)>6*86400000){setDateError('The available map archive spans seven calendar days. Select a range within that window.');return;}if(data?.range.availableFrom&&dateFrom<data.range.availableFrom.slice(0,10)||data?.range.availableTo&&dateTo>data.range.availableTo.slice(0,10)){setDateError('Select dates inside the source’s available observation window.');return;}setDates({from:dateFrom,to:dateTo});setDateModal(false);}
  const saveImported=useCallback((value:ImportedDataset)=>{if(value&&Number(value.rows)>0){setImported(value);try{localStorage.setItem('thermoscan-imported-dataset',JSON.stringify(value));}catch{/* CSV itself remains server-side. */}}},[]);

  const rangeLabel = dates
    ? `${formatDate(dates.from, { year: undefined })} — ${formatDate(dates.to)}`
    : windowSize === 'today'
    ? data?.range?.to
      ? `Today (${formatDate(data.range.to, { year: undefined })})`
      : 'Today (UTC)'
    : data?.range?.availableTo && mode === 'archive'
    ? `${formatDate(data.range.from, { year: undefined })} — ${formatDate(data.range.to)}`
    : `Last ${windowSize === '7d' ? '7 days' : windowSize === '48h' ? '48 hours' : '24 hours'}`;

  return <div className="min-h-screen">
    {mobileNav&&<button aria-label="Close navigation" className="fixed inset-0 z-[1900] bg-[#14242d66] lg:hidden" onClick={()=>setMobileNav(false)}/>}
    <aside className={`fixed inset-y-0 left-0 z-[2000] w-[224px] flex-col border-r border-[#26353e] bg-[#1d2d36] ${mobileNav?'flex':'hidden'} lg:flex`}>
      <a href="#overview" className="flex items-center gap-2.5 px-[23px] pb-9 pt-[28px]" onClick={event=>{event.preventDefault();navigate('overview');}}><img src="/icon.svg" alt="" width={35} height={35}/><div><span className="font-display text-[17px] font-semibold tracking-tight text-[#f1f5f7]">ThermoScan<span className="ml-0.5 text-[#e6a174]">.</span></span><span className="mt-1 block text-[6.5px] font-medium tracking-[.18em] text-[#8b9da8]">SATELLITE THERMAL INTELLIGENCE</span></div></a>
      <div className="px-6 text-[8px] font-medium uppercase tracking-[.15em] text-[#607681]">Workspace</div>
      <nav aria-label="Main navigation" className="mt-3 space-y-1 px-3.5">{(['overview','observations','watchlist'] as Page[]).map(key=><button key={key} onClick={()=>navigate(key)} aria-current={page===key?'page':undefined} className={`relative flex h-[41px] w-full items-center gap-3 rounded-lg px-3 text-left text-[11px] transition-colors ${page===key?'bg-[#35424a] text-[#f3bc99]':'text-[#91a4af] hover:bg-[#293b46] hover:text-[#c4d0d7]'}`}>{page===key&&<span className="absolute -left-3.5 h-5 w-[2px] rounded-r bg-[#e69e70]"/>}<span className={page===key?'text-[#eeaa7f]':'text-[#8299a6]'}>{PAGES[key].icon}</span>{PAGES[key].label}{key==='overview'&&<span className={`ml-auto h-1 w-1 rounded-full ${page==='overview'?'bg-[#cba383]':'bg-[#536b79]'}`}/>}</button>)}</nav>
      <div className="mt-7 px-6 text-[8px] font-medium uppercase tracking-[.15em] text-[#607681]">Intelligence</div>
      <nav aria-label="Data and model navigation" className="mt-3 space-y-1 px-3.5">{(['history','model','sources'] as Page[]).map(key=><button key={key} onClick={()=>navigate(key)} aria-current={page===key?'page':undefined} className={`relative flex h-[41px] w-full items-center gap-3 rounded-lg px-3 text-left text-[11px] transition-colors ${page===key?'bg-[#35424a] text-[#f3bc99]':'text-[#91a4af] hover:bg-[#293b46] hover:text-[#c4d0d7]'}`}>{page===key&&<span className="absolute -left-3.5 h-5 w-[2px] rounded-r bg-[#e69e70]"/>}<span className={page===key?'text-[#eeaa7f]':'text-[#8299a6]'}>{PAGES[key].icon}</span>{PAGES[key].label}{key==='model'&&<span className="ml-auto rounded border border-[#51616b] px-1 py-0.5 text-[7px] tracking-wide text-[#8ea2af]">ML</span>}</button>)}</nav>
      <div className="mt-auto px-4 pb-5 pt-10">
        <button onClick={()=>navigate('sources')} className="w-full rounded-xl border border-[#3b4d58] bg-[#263741] p-3.5 text-left transition-colors hover:bg-[#2d3f4a]"><div className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-[8px] uppercase tracking-[.11em] text-[#8ca1ae]"><span className={`h-1 w-1 rounded-full ${liveConnected?'bg-[#93b899]':'bg-[#d9ab7d]'}`}/>SOURCE STATUS</span><ChevronRight size={10} className="text-[#8199a8]"/></div><p className="mt-2.5 text-[10px] font-medium text-[#b5c4cd]">{liveConnected?'NASA feeds connected':nasa?.status==='degraded'?'NASA feeds degraded':health.data?.archiveAvailable?'Historical workspace ready':health.data?'Source setup required':'Checking data availability'}</p><p className="mt-1.5 text-[8px] leading-4 text-[#6f8a9a]">{liveConnected?'Inspect acquisition times before acting.':'Live source availability is shown, never simulated.'}</p><div className="mt-3 flex items-center gap-1.5 text-[8px] text-[#c4a17f]">View data connections<ArrowUpRight size={10}/></div></button>
        <a href="/guide" target="_blank" rel="noopener noreferrer" className="mt-5 flex items-center gap-2 px-2 text-[10px] text-[#8299a7] hover:text-[#c1cdd4]"><BookOpen size={15} strokeWidth={1.5}/>Documentation<ArrowUpRight size={10} className="ml-auto"/></a>
      </div>
      <div className="flex items-center gap-2.5 border-t border-[#354650] px-5 py-[17px]"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#806a52] bg-[#5b5147] text-[10px] font-medium text-[#ebcdae]">ST</div><div><div className="text-[10px] font-medium text-[#bbcbd5]">Stack Titans</div><div className="mt-1 text-[7px] tracking-wide text-[#718b9b]">SIH 2026 <span className="mx-1">/</span> SIH26162</div></div><ShieldCheck size={13} className="ml-auto text-[#668293]"/></div>
    </aside>

    <div className="min-w-0 lg:pl-[224px]">
      <header className="sticky top-0 z-40 flex h-[62px] items-center justify-between border-b border-[#e7ecf0] bg-white/95 px-5 backdrop-blur-sm lg:px-7">
        <div className="flex items-center gap-2.5"><button aria-label="Open navigation" onClick={()=>setMobileNav(true)} className="icon-button mobile-menu-button -ml-2 lg:hidden"><Menu size={19}/></button><span className="hidden text-[10px] text-[#a6b0b8] sm:inline">Workspace</span><ChevronRight size={11} className="hidden text-[#b4bec6] sm:block"/><span className="text-[10px] font-medium text-[#768994]">{PAGES[page].label}</span></div>
        <div className="flex items-center gap-3 sm:gap-5"><span className="hidden items-center gap-1.5 rounded-md border border-[#e8ecef] bg-[#f9fafb] px-2.5 py-1.5 text-[8px] text-[#92a1ab] md:flex"><span className="h-1 w-1 rounded-full bg-[#d3af88]"/>Research preview</span><UTCClock/><span className="h-4 w-px bg-[#edf0f3]"/><a href="/guide" target="_blank" rel="noopener noreferrer" title="Data and training guide" aria-label="Open data and training guide" className="icon-button -mx-1.5"><CircleHelp size={16} strokeWidth={1.6}/></a><div className="relative"><button aria-label="Open alert notifications" title={alerts.length ? `${unreadAlertCount} unread alert${unreadAlertCount === 1 ? '' : 's'} in current window` : 'No active alerts'} onClick={()=>setNotificationsOpen(!notificationsOpen)} className={`icon-button relative -mx-1.5 ${notificationsOpen ? 'bg-[#f1f5f9] text-[#0f172a]' : ''}`}><Bell size={16} strokeWidth={1.6} className={unreadAlertCount > 0 ? 'text-[#dc2626]' : ''} />{unreadAlertCount > 0 && (<span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#dc2626] px-1 text-[8.5px] font-bold text-white ring-2 ring-white animate-pulse">{unreadAlertCount}</span>)}</button>{notificationsOpen && (<NotificationPanel alerts={alerts} readAlertIds={readAlertIds} onSelectAlert={(alert) => { setSelected(alert); setNotificationsOpen(false); }} onMarkAllRead={() => { setReadAlertIds(new Set(alerts.map(a => a.id))); }} onMarkRead={(id) => { setReadAlertIds(prev => new Set(prev).add(id)); }} onClose={() => setNotificationsOpen(false)} onOpenReviewQueue={() => { setNotificationsOpen(false); navigate('watchlist'); }} filterLabel={`${rangeLabel} · ${region.name}`} />)}</div><button onClick={()=>navigate('sources')} aria-label="Workspace settings" className="flex h-[27px] w-[27px] items-center justify-center rounded-full border border-[#e5d9ce] bg-[#f2e8de] text-[8px] font-semibold text-[#ac8e73]">ST</button></div>
      </header>
      <main className="mx-auto max-w-[1720px] px-5 pb-7 pt-7 lg:px-7">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#64748b]">
              <Satellite size={14} strokeWidth={1.5} className="text-[#ea580c]" />
              SATELLITE THERMAL MONITORING
            </div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-[#0f172a] sm:text-3xl">
              {PAGES[page].title}
            </h1>
            <p className="mt-1.5 text-xs text-[#64748b]">
              {PAGES[page].description}
            </p>
          </div>
        </div>

        {spatialPage && (
          <>
            <div className="mt-6 rounded-2xl border border-[#e2e8f0] bg-white shadow-sm overflow-hidden">
              {/* Top Bar: Workflow Step Sequence & Loaded Status */}
              <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3.5 bg-[#f8fafc] border-b border-[#e2e8f0]">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-bold uppercase tracking-wider text-[#475569]">
                    Analyst Workflow:
                  </span>
                  <span className="text-[#64748b]">
                    1. Select Mode/Date → 2. Load Events → 3. Select Hotspot → 4. Inspect Evidence → 5. Review & Export
                  </span>
                </div>

                {/* Loaded Events Status */}
                <div className="flex items-center gap-2">
                  {overview.loading ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#cbd5e1] bg-[#f8fafc] px-3 py-1 text-xs font-medium text-[#475569]">
                      <LoaderCircle size={13} className="animate-spin text-[#0284c7]" />
                      Loading events…
                    </span>
                  ) : data?.events && data.events.length > 0 ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#bbf7d0] bg-[#f0fdf4] px-3 py-1 text-xs font-bold text-[#166534]">
                      <span className="h-2 w-2 rounded-full bg-[#16a34a]" />
                      {data.events.length} Observations Loaded
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#cbd5e1] bg-[#f8fafc] px-3 py-1 text-xs font-medium text-[#64748b]">
                      <span className="h-2 w-2 rounded-full bg-[#94a3b8]" />
                      Ready to load events
                    </span>
                  )}
                </div>
              </div>

              {/* Controls Body */}
              <div className="p-5 sm:p-6 space-y-4">
                {/* Row 1: Primary Controls & Actions */}
                <div className="flex flex-wrap items-center justify-between gap-3.5">
                  <div className="flex flex-wrap items-center gap-3">
                    {/* Mode Toggle */}
                    <div className="flex h-[38px] items-center rounded-lg border border-[#e2e8ec] bg-[#f1f5f9] p-[3px] text-xs">
                      <button
                        onClick={() => setDataMode('archive')}
                        className={`flex h-full items-center gap-1.5 rounded-[6px] px-3 transition font-medium ${
                          mode === 'archive'
                            ? 'bg-white font-semibold text-[#9a3412] shadow-sm'
                            : 'text-[#64748b] hover:text-[#0f172a]'
                        }`}
                      >
                        <History size={13} />
                        Historical Archive
                      </button>
                      <button
                        onClick={() => setDataMode('live')}
                        className={`flex h-full items-center gap-1.5 rounded-[6px] px-3 transition font-medium ${
                          mode === 'live'
                            ? 'bg-white font-semibold text-[#166534] shadow-sm'
                            : 'text-[#64748b] hover:text-[#0f172a]'
                        }`}
                      >
                        <Radio size={13} />
                        Near-real-time
                      </button>
                    </div>

                    {/* Date Window */}
                    <button
                      className="btn-secondary !h-[38px] !py-0 !px-3.5 text-xs font-semibold flex items-center gap-2"
                      onClick={openDates}
                      title="Select observation time window"
                    >
                      <CalendarDays size={14} className="text-[#64748b]" />
                      <span>{rangeLabel}</span>
                      <ChevronDown size={12} className="text-[#94a3b8]" />
                    </button>

                    {/* Region Selector */}
                    <label className="relative">
                      <MapPin size={14} className="pointer-events-none absolute left-3 top-3 text-[#64748b]" />
                      <select
                        aria-label="Monitoring region"
                        className="h-[38px] appearance-none rounded-lg border border-[#e2e8ec] bg-white py-2 pl-8 pr-8 text-xs font-semibold text-[#334155]"
                        value={region.id}
                        onChange={(event) => {
                          setRegionId(event.target.value);
                          setSelected(null);
                        }}
                      >
                        {availableRegions.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={12} className="pointer-events-none absolute right-3 top-3.5 text-[#94a3b8]" />
                    </label>
                  </div>

                  {/* Primary Action Button & Export */}
                  <div className="flex items-center gap-2.5 shrink-0">
                    <button
                      onClick={reload}
                      disabled={refreshing || (overview.loading && spatialPage)}
                      className="btn-primary !h-[38px] !py-0 !px-4 text-xs font-semibold flex items-center gap-2 shadow-sm"
                    >
                      <RefreshCw size={14} className={refreshing || (overview.loading && spatialPage) ? 'animate-spin' : ''} />
                      <span>
                        {refreshing || overview.loading
                          ? 'Loading Events…'
                          : data?.events && data.events.length > 0
                          ? 'Refresh Events'
                          : 'Load Events'}
                      </span>
                    </button>

                    {/* Export Dropdown */}
                    <div className="relative" ref={exportRef}>
                      <button
                        onClick={() => setExportOpen(!exportOpen)}
                        aria-expanded={exportOpen}
                        disabled={!data || data.availability === 'unavailable'}
                        className="btn-secondary !h-[38px] !py-0 !px-3 text-xs font-semibold flex items-center gap-1.5"
                      >
                        <Download size={14} />
                        <span>Export</span>
                        <ChevronDown size={12} />
                      </button>
                      {exportOpen && (
                        <div className="absolute right-0 top-11 z-[1500] w-60 rounded-xl border border-[#e2e8f0] bg-white p-2 shadow-xl">
                          <a
                            href={`/api/export?${query}&format=csv`}
                            onClick={() => setExportOpen(false)}
                            className="flex items-center gap-3 rounded-lg p-2.5 text-xs font-medium text-[#334155] hover:bg-[#f1f5f9]"
                          >
                            <FileSpreadsheet size={16} className="text-[#16a34a]" />
                            <div>
                              <div>Download CSV</div>
                              <span className="text-[10px] text-[#94a3b8]">All matching observations</span>
                            </div>
                          </a>
                          <a
                            href={`/api/export?${query}&format=geojson`}
                            onClick={() => setExportOpen(false)}
                            className="flex items-center gap-3 rounded-lg p-2.5 text-xs font-medium text-[#334155] hover:bg-[#f1f5f9]"
                          >
                            <FileJson size={16} className="text-[#ea580c]" />
                            <div>
                              <div>Download GeoJSON</div>
                              <span className="text-[10px] text-[#94a3b8]">Coordinates, predictions & risk</span>
                            </div>
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Row 2: Category Filter & Provenance Badges */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-3.5 border-t border-[#f1f5f9]">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[#64748b]">
                      Filter:
                    </span>
                    <div className="flex h-[36px] items-center rounded-lg border border-[#e2e8ec] bg-[#f1f5f9] p-[3px] text-xs">
                      <button
                        onClick={() => setClassKey('all')}
                        className={`flex h-full items-center px-3 rounded-[5px] transition font-medium ${
                          classKey === 'all'
                            ? 'bg-white font-semibold text-[#0f172a] shadow-sm'
                            : 'text-[#64748b] hover:text-[#0f172a]'
                        }`}
                        title="Show all hotspot categories"
                      >
                        All
                      </button>
                      <button
                        onClick={() => setClassKey('all_industrial')}
                        className={`flex h-full items-center gap-1.5 px-3 rounded-[5px] transition font-medium ${
                          classKey === 'all_industrial' || classKey === 'industrial' || classKey === 'persistent'
                            ? 'bg-[#fee2e2] font-bold text-[#b91c1c] shadow-sm'
                            : 'text-[#64748b] hover:text-[#b91c1c]'
                        }`}
                        title="Filter Industrial events only"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-[#dc2626]" />
                        Industrial
                      </button>
                      <button
                        onClick={() => setClassKey('all_non_industrial')}
                        className={`flex h-full items-center gap-1.5 px-3 rounded-[5px] transition font-medium ${
                          classKey === 'all_non_industrial' || classKey === 'forest' || classKey === 'agriculture'
                            ? 'bg-[#dcfce7] font-bold text-[#15803d] shadow-sm'
                            : 'text-[#64748b] hover:text-[#15803d]'
                        }`}
                        title="Filter Non-Industrial events only"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-[#16a34a]" />
                        Non-Industrial
                      </button>
                    </div>

                    <label className="relative">
                      <ListFilter size={14} className="pointer-events-none absolute left-3 top-2.5 text-[#64748b]" />
                      <select
                        aria-label="Filter category"
                        className="h-[36px] appearance-none rounded-lg border border-[#e2e8ec] bg-white py-1.5 pl-8 pr-8 text-xs font-semibold text-[#334155]"
                        value={classKey}
                        onChange={(event) => setClassKey(event.target.value as FilterCategory)}
                      >
                        <option value="all">All Categories</option>

                        <optgroup label="── INDUSTRIAL ──">
                          <option value="all_industrial">All Industrial Events</option>
                          <option value="industrial">Potential Industrial Fire</option>
                          <option value="persistent">Persistent Thermal Source</option>
                        </optgroup>

                        <optgroup label="── NON-INDUSTRIAL ──">
                          <option value="all_non_industrial">All Non-Industrial Events</option>
                          <option value="forest">Forest / Natural Fire</option>
                          <option value="agriculture">Agricultural / Waste Burning</option>
                        </optgroup>

                        <optgroup label="── UNCERTAIN ──">
                          <option value="uncertain">Other / Uncertain</option>
                        </optgroup>
                      </select>
                      <ChevronDown size={12} className="pointer-events-none absolute right-3 top-3 text-[#94a3b8]" />
                    </label>
                  </div>

                  {/* Sleek Provenance Indicator */}
                  <div
                    className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${
                      mode === 'archive'
                        ? 'border-[#eee6da] bg-[#fcf8f1] text-[#9a3412]'
                        : data?.availability === 'ready'
                        ? 'border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]'
                        : 'border-[#fecaca] bg-[#fff1f2] text-[#991b1b]'
                    }`}
                  >
                    {mode === 'archive' ? <History size={13} className="shrink-0" /> : <Radio size={13} className="shrink-0" />}
                    <span className="truncate max-w-[320px] lg:max-w-[460px]">
                      {mode === 'archive' ? (
                        <>
                          <span className="font-semibold">NASA FIRMS</span> · {data?.source?.name || 'Historical archive'} · Verified mirror
                        </>
                      ) : data?.availability === 'ready' ? (
                        <>
                          <span className="font-semibold">NASA FIRMS near-real-time</span>
                          {data.stats.lastRefreshedAt && (
                            <span className="opacity-75"> · {new Date(data.stats.lastRefreshedAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})} UTC</span>
                          )}
                        </>
                      ) : (
                        <span className="font-semibold text-[#b84826]">Live source unavailable</span>
                      )}
                    </span>
                    <button
                      onClick={() => navigate('sources')}
                      className="ml-1 shrink-0 font-semibold underline underline-offset-2 hover:opacity-80 flex items-center gap-0.5"
                    >
                      {mode === 'archive' ? 'Source' : 'Connection'}
                      <ArrowUpRight size={11} />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {data && !data.model.available && (
              <div className="mb-4 mt-3">
                <ErrorState
                  message={data.model.error || 'Inference is not currently available. No model scores are generated.'}
                  retry={overview.reload}
                />
              </div>
            )}
            {overview.error && (
              <div className="mb-4 mt-3">
                <ErrorState message={overview.error} retry={overview.reload} />
              </div>
            )}
          </>
        )}

        {spatialPage && alerts.length > 0 && dismissedBannerSignature !== filterSignature && (
          <div className="my-6 flex flex-wrap items-center justify-between gap-3.5 rounded-xl border border-[#fed7aa] bg-gradient-to-r from-[#fff7ed] via-[#fff1f2] to-[#fff7ed] px-5 py-4 shadow-sm animate-in fade-in slide-in-from-top-1 duration-200">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#fee2e2] text-[#dc2626]">
                <Flame size={18} className="animate-pulse" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12px] font-bold text-[#991b1b]">
                    {alerts.length} High/Critical event{alerts.length === 1 ? '' : 's'} detected in {rangeLabel.toLowerCase()}.
                  </span>
                  <span className="rounded bg-[#fee2e2] px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-wider text-[#b91c1c]">
                    Requires Ground Verification
                  </span>
                </div>
                <p className="mt-0.5 text-[10px] text-[#7c2d12]">
                  Automatic classification and risk assessment identified {alerts.filter(a => a.risk?.level === 'critical').length} Critical and {alerts.filter(a => a.risk?.level === 'high').length} High priority events. Added to Review Queue for independent ground verification.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setNotificationsOpen(true)}
                className="rounded-lg bg-[#dc2626] px-3 py-1.5 text-[10.5px] font-medium text-white shadow-sm hover:bg-[#b91c1c] transition-colors flex items-center gap-1.5"
              >
                <Bell size={12} />
                Inspect alerts ({alerts.length})
              </button>
              <button
                onClick={() => navigate('watchlist')}
                className="rounded-lg border border-[#fdba74] bg-white px-3 py-1.5 text-[10.5px] font-medium text-[#c2410c] hover:bg-[#fff7ed] transition-colors"
              >
                Review Queue
              </button>
              <button
                onClick={() => setDismissedBannerSignature(filterSignature)}
                aria-label="Dismiss alert banner"
                title="Dismiss banner"
                className="p-1 text-[#9ca3af] hover:text-[#4b5563]"
              >
                <X size={15} />
              </button>
            </div>
          </div>
        )}

        <div className="mt-7">
          {page==='overview'&&<OverviewView data={data} loading={overview.loading} region={data?.region || region} selected={selected} onSelect={onSelect} onPage={navigate} onSources={()=>navigate('sources')} fullScreen={fullScreen} onFullScreen={()=>setFullScreen(value=>!value)} evidence={evidence}/>}
          {page==='observations'&&<ObservationsView query={query} refresh={refresh} selected={selected} onSelect={onSelect}/>}
          {page==='watchlist'&&<WatchlistView refresh={refresh} selected={selected} onSelect={onSelect} notify={notify}/>}
          {page==='history'&&<HistoryView onPage={navigate} onImported={saveImported} imported={imported} notify={notify} refresh={refresh}/>}
          {page==='model'&&<ModelView refresh={refresh} imported={imported} onPage={navigate} onModelChanged={()=>{setDates(null);if(mode!=='archive')setMode('archive');forceRefresh();}} notify={notify}/>}
          {page==='sources'&&<SourcesView refresh={refresh} onChecked={forceRefresh} onPage={navigate} notify={notify}/>}
        </div>
      </main>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e9edf0] px-7 py-3 text-[8px] tracking-wide text-[#b0bbc3]"><span>THERMOSCAN <span className="mx-2 text-[#d2d8dd]">/</span> STACK TITANS · SIH26162</span><span>Source-type research prototype. Independently verify before action.</span></footer>
    </div>
    {selected&&<ObservationDrawer key={selected.id} event={selected} onClose={()=>setSelected(null)} onReviewed={forceRefresh} onEvidence={onEvidence} notify={notify}/>}
    {toast&&<Toast message={toast.message} error={toast.error} onClose={clearToast}/>}
    {dateModal&&<Modal title="Select an observation window" onClose={()=>setDateModal(false)}>
      <p className="text-xs leading-relaxed text-[#64748b]">
        {mode==='archive'
          ? 'Choose Today (the single latest available day in archive), rolling days, or select custom UTC dates.'
          : 'The near-real-time feed covers Today (current UTC date) or rolling 24, 48, or 168 hours across NASA FIRMS satellites.'}
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        {(['today','24h','48h','7d'] as const).map(value => (
          <button
            key={value}
            className={`btn-secondary flex-1 text-xs font-semibold ${
              windowSize === value && !dates
                ? '!border-[#ea580c] !bg-[#fff7ed] !text-[#c2410c]'
                : ''
            }`}
            onClick={() => {
              setWindowSize(value);
              setDates(null);
              setDateModal(false);
            }}
          >
            {value === 'today'
              ? 'Today'
              : value === '7d'
              ? '7 days'
              : value === '48h'
              ? '48 hours'
              : '24 hours'}
          </button>
        ))}
      </div>
      <div className="my-5 flex items-center gap-3 text-[9px] text-[#b0bcc4]"><span className="h-px flex-1 bg-[#edf1f4]"/>OR CHOOSE UTC DATES<span className="h-px flex-1 bg-[#edf1f4]"/></div>
      <div className="grid grid-cols-2 gap-3"><label className="text-xs text-[#64748b]">From<input type="date" aria-label="Start observation date" className="field mt-2 text-xs" value={dateFrom} min={mode==='archive'?data?.range.availableFrom?.slice(0,10):undefined} max={mode==='archive'?data?.range.availableTo?.slice(0,10):undefined} onChange={event=>setDateFrom(event.target.value)}/></label><label className="text-xs text-[#64748b]">Through<input type="date" aria-label="End observation date" className="field mt-2 text-xs" value={dateTo} min={mode==='archive'?data?.range.availableFrom?.slice(0,10):undefined} max={mode==='archive'?data?.range.availableTo?.slice(0,10):undefined} onChange={event=>setDateTo(event.target.value)}/></label></div>{dateError&&<div className="mt-4"><ErrorState message={dateError}/></div>}<div className="mt-6 flex justify-end gap-2"><button className="btn-secondary text-xs" onClick={()=>setDateModal(false)}>Cancel</button><button className="btn-primary text-xs flex items-center gap-1.5" onClick={applyDates}><span>Apply window</span><ArrowRight size={13}/></button></div></Modal>}
  </div>;
}
