'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowDownToLine, ArrowRight, ArrowUpRight, Bell, BookOpen, Bookmark, BrainCircuit, CalendarDays, Check, ChevronDown, ChevronRight, CircleHelp, Clock3, Database, Download, FileJson, FileSpreadsheet, Flame, Globe2, History, LayoutDashboard, ListFilter, LoaderCircle, MapPin, Menu, Network, Radio, RefreshCw, Satellite, ScanLine, Search, Settings2, ShieldCheck, Sparkles, X } from 'lucide-react';
import { api, useApi } from '@/lib/api';
import { CLASSES, formatDate, formatNumber, REGIONS } from '@/lib/constants';
import type { ClassKey, DataMode, Evidence, Page, SourceStatus, ThermalEvent } from '@/lib/types';
import OverviewView, { type OverviewData } from './OverviewView';
import { ObservationsView, WatchlistView } from './ObservationsView';
import HistoryView, { type ImportedDataset } from './HistoryView';
import ModelView from './ModelView';
import SourcesView from './SourcesView';
import ObservationDrawer from './ObservationDrawer';
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
  const [windowSize,setWindowSize]=useState<'24h'|'48h'|'7d'>('7d');
  const [classKey,setClassKey]=useState<ClassKey|'all'>('all');
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
  const exportRef=useRef<HTMLDivElement>(null);
  const initialModeApplied=useRef(false);
  const userChoseMode=useRef(false);
  const notify=useCallback((message:string,error=false)=>setToast({message,error}),[]);
  const clearToast=useCallback(()=>setToast(null),[]);
  const forceRefresh=useCallback(()=>setRefresh(value=>value+1),[]);
  const health=useApi<{sources:SourceStatus[];defaultMode:DataMode;archiveAvailable:boolean}>('/api/health',refresh,60000);
  useEffect(()=>{if(health.data&&!initialModeApplied.current){initialModeApplied.current=true;if(!userChoseMode.current)setMode(health.data.defaultMode);}},[health.data]);
  const query=new URLSearchParams({mode,region:regionId,window:windowSize,classKey,...(dates||{})}).toString();
  const spatialPage=page==='overview'||page==='observations';
  const overview=useApi<OverviewData>(spatialPage?`/api/overview?${query}`:null,refresh,mode==='live'&&spatialPage?60000:0);
  const data=overview.data;
  const availableRegions = data?.regions || REGIONS;
  const region = availableRegions.find(item=>item.id===regionId) || data?.region || availableRegions[0];
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
  function setDataMode(next:DataMode){userChoseMode.current=true;setMode(next);setDates(null);setSelected(null);setEvidence(null);}
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

  const rangeLabel=dates?`${formatDate(dates.from,{year:undefined})} — ${formatDate(dates.to)}`:data?.range.availableTo&&mode==='archive'?`${formatDate(data.range.from,{year:undefined})} — ${formatDate(data.range.to)}`:`Last ${windowSize==='7d'?'7 days':windowSize==='48h'?'48 hours':'24 hours'}`;

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
        <div className="flex items-center gap-3 sm:gap-5"><span className="hidden items-center gap-1.5 rounded-md border border-[#e8ecef] bg-[#f9fafb] px-2.5 py-1.5 text-[8px] text-[#92a1ab] md:flex"><span className="h-1 w-1 rounded-full bg-[#d3af88]"/>Research preview</span><UTCClock/><span className="h-4 w-px bg-[#edf0f3]"/><a href="/guide" target="_blank" rel="noopener noreferrer" title="Data and training guide" aria-label="Open data and training guide" className="icon-button -mx-1.5"><CircleHelp size={16} strokeWidth={1.6}/></a><button aria-label="Open review queue" title="Your review queue" onClick={()=>navigate('watchlist')} className="icon-button -mx-1.5"><Bell size={16} strokeWidth={1.6}/></button><button onClick={()=>navigate('sources')} aria-label="Workspace settings" className="flex h-[27px] w-[27px] items-center justify-center rounded-full border border-[#e5d9ce] bg-[#f2e8de] text-[8px] font-semibold text-[#ac8e73]">ST</button></div>
      </header>
      <main className="mx-auto max-w-[1720px] px-5 pb-7 pt-7 lg:px-7">
        <div className="flex flex-wrap items-center justify-between gap-4"><div><div className="mb-2 flex items-center gap-1.5 text-[8px] font-medium uppercase tracking-[.14em] text-[#a7b2ba]"><Satellite size={10} strokeWidth={1.5}/>SATELLITE INSIGHTS, GROUNDED IN DATA</div><h1 className="font-display text-[26px] font-semibold tracking-[-.04em] text-[#283640] sm:text-[29px]">{PAGES[page].title}</h1><p className="mt-2 text-[10.5px] leading-5 text-[#91a0ab]">{PAGES[page].description}</p></div>
          <div className="flex gap-2 self-center">{spatialPage&&<div className="relative" ref={exportRef}><button onClick={()=>setExportOpen(!exportOpen)} aria-expanded={exportOpen} disabled={!data||data.availability==='unavailable'} className="btn-secondary"><Download size={13}/>Export data<ChevronDown size={10}/></button>{exportOpen&&<div className="absolute right-0 top-11 z-[1500] w-56 rounded-lg border border-[#e6ebef] bg-white p-1.5 shadow-lg"><a href={`/api/export?${query}&format=csv`} onClick={()=>setExportOpen(false)} className="flex items-center gap-3 rounded-md p-3 text-[11px] text-[#8094a2] hover:bg-[#f5f7f9]"><FileSpreadsheet size={15}/><div>Download CSV<span className="mt-1 block text-[8px] text-[#a7b4bd]">All matching observations</span></div></a><a href={`/api/export?${query}&format=geojson`} onClick={()=>setExportOpen(false)} className="flex items-center gap-3 rounded-md p-3 text-[11px] text-[#8094a2] hover:bg-[#f5f7f9]"><FileJson size={15}/><div>Download GeoJSON<span className="mt-1 block text-[8px] text-[#a7b4bd]">Coordinates, predictions & source</span></div></a></div>}</div>}<button onClick={reload} disabled={refreshing||overview.loading&&spatialPage} className="btn-primary"><RefreshCw size={12} className={refreshing||overview.loading&&spatialPage?'animate-spin':''}/>{refreshing?'Refreshing…':'Refresh view'}</button></div>
        </div>

        {spatialPage&&<>
          <div className="mt-6 flex flex-wrap items-center gap-2.5">
            <label className="relative"><MapPin size={13} className="pointer-events-none absolute left-3 top-3 text-[#9baab5]"/><select aria-label="Monitoring region" className="h-[37px] appearance-none rounded-lg border border-[#e3e8ec] bg-white py-2 pl-8 pr-8 text-[10px] font-medium text-[#7f919e]" value={region.id} onChange={event=>{setRegionId(event.target.value);setSelected(null);}}>{availableRegions.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select><ChevronDown size={10} className="pointer-events-none absolute right-3 top-3.5 text-[#a9b5be]"/></label>
            <button className="btn-secondary !h-[37px] !min-h-0 !px-3 !text-[10px]" onClick={openDates}><CalendarDays size={12} className="text-[#9cabb5]"/>{rangeLabel}<ChevronDown size={10} className="text-[#a9b5be]"/></button>
            <label className="relative"><ListFilter size={13} className="pointer-events-none absolute left-3 top-3 text-[#9baab5]"/><select aria-label="Filter source type" className="h-[37px] appearance-none rounded-lg border border-[#e3e8ec] bg-white py-2 pl-8 pr-8 text-[10px] font-medium text-[#7f919e]" value={classKey} onChange={event=>setClassKey(event.target.value as ClassKey|'all')}><option value="all">All source types</option>{Object.entries(CLASSES).map(([key,value])=><option key={key} value={key}>{value.short}</option>)}</select><ChevronDown size={10} className="pointer-events-none absolute right-3 top-3.5 text-[#a9b5be]"/></label>
            <div className="ml-auto flex h-[37px] items-center rounded-lg border border-[#e2e8ec] bg-[#eef2f5] p-[3px] text-[10px]"><button onClick={()=>setDataMode('archive')} className={`flex h-full items-center gap-1.5 rounded-[5px] px-3 ${mode==='archive'?'bg-white font-medium text-[#9c7e64] shadow-sm':'text-[#9fadb7]'}`}><History size={11}/>Historical</button><button onClick={()=>setDataMode('live')} className={`flex h-full items-center gap-1.5 rounded-[5px] px-3 ${mode==='live'?'bg-white font-medium text-[#759584] shadow-sm':'text-[#9fadb7]'}`}><Radio size={11}/>Near-real-time</button></div>
          </div>
          <div className={`my-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3.5 py-2.5 text-[9px] ${mode==='archive'?'border-[#eee6da] bg-[#fcf8f1] text-[#b09775]':data?.availability==='ready'?'border-[#e0ebe5] bg-[#f3f8f5] text-[#87a593]':'border-[#eedad3] bg-[#fff5f2] text-[#c9622d]'}`}>
            <span className="flex items-center gap-2">
              {mode==='archive'?<History size={12}/>:<Radio size={12}/>}
              <span>
                {mode==='archive' ? (
                  <>Genuine historical observations <span className="mx-1.5 opacity-40">/</span> {data?.source?.name || 'Historical archive'} <span className="hidden xl:inline">· not a live feed</span></>
                ) : data?.availability==='ready' ? (
                  <>
                    <span className="font-semibold">NASA FIRMS near-real-time observations</span>
                    {data.stats.lastRefreshedAt && <span className="ml-2 opacity-75">· Refreshed: {new Date(data.stats.lastRefreshedAt).toLocaleTimeString()} UTC</span>}
                    {data.range?.from && <span className="ml-2 opacity-60 hidden md:inline">({formatDate(data.range.from)} — {formatDate(data.range.to)})</span>}
                  </>
                ) : (
                  <span className="font-semibold text-[#b84826]">Live source unavailable. Historical data is not being used as a fallback.</span>
                )}
              </span>
            </span>
            <button onClick={()=>navigate('sources')} className="flex items-center gap-1.5 font-medium">{mode==='archive'?'Source & provenance':'Inspect connection'}<ArrowUpRight size={11}/></button>
          </div>
          {data&&!data.model.available&&<div className="mb-4"><ErrorState message={data.model.error||'Inference is not currently available. No model scores are generated.'} retry={overview.reload}/></div>}
          {overview.error&&<div className="mb-4"><ErrorState message={overview.error} retry={overview.reload}/></div>}
        </>}
        <div className={spatialPage?'':'mt-6'}>
          {page==='overview'&&<OverviewView data={data} loading={overview.loading} region={data?.region || region} selected={selected} onSelect={onSelect} onPage={navigate} onSources={()=>navigate('sources')} fullScreen={fullScreen} onFullScreen={()=>setFullScreen(value=>!value)} evidence={evidence}/>}
          {page==='observations'&&<ObservationsView query={query} refresh={refresh} onSelect={onSelect}/>}
          {page==='watchlist'&&<WatchlistView refresh={refresh} onSelect={onSelect} notify={notify}/>}
          {page==='history'&&<HistoryView onPage={navigate} onImported={saveImported} imported={imported} notify={notify} refresh={refresh}/>}
          {page==='model'&&<ModelView refresh={refresh} imported={imported} onPage={navigate} onModelChanged={()=>{setDates(null);if(mode!=='archive')setMode('archive');forceRefresh();}} notify={notify}/>}
          {page==='sources'&&<SourcesView refresh={refresh} onChecked={forceRefresh} onPage={navigate} notify={notify}/>}
        </div>
      </main>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e9edf0] px-7 py-3 text-[8px] tracking-wide text-[#b0bbc3]"><span>THERMOSCAN <span className="mx-2 text-[#d2d8dd]">/</span> STACK TITANS · SIH26162</span><span>Source-type research prototype. Independently verify before action.</span></footer>
    </div>
    {selected&&<ObservationDrawer key={selected.id} event={selected} onClose={()=>setSelected(null)} onReviewed={forceRefresh} onEvidence={onEvidence} notify={notify}/>}
    {toast&&<Toast message={toast.message} error={toast.error} onClose={clearToast}/>}
    {dateModal&&<Modal title="Select an observation window" onClose={()=>setDateModal(false)}><p className="text-[11px] leading-6 text-[#93a4af]">{mode==='archive'?'The bundled map window contains all valid observations from 25–31 March 2025. The full quarter is used in the training pipeline.':'The near-real-time feed covers the last rolling 24, 48, or 168 hours across NASA FIRMS satellites.'}</p><div className="mt-5 flex flex-wrap gap-2">{(['24h','48h','7d'] as const).map(value=><button key={value} className={`btn-secondary flex-1 ${windowSize===value&&!dates?'!border-[#dabaa0] !bg-[#fdf9f4] !text-[#b49070] font-semibold':''}`} onClick={()=>{setWindowSize(value);setDates(null);setDateModal(false);}}>{value==='7d'?'7 days':value==='48h'?'48 hours':'24 hours'}</button>)}</div><div className="my-5 flex items-center gap-3 text-[9px] text-[#b0bcc4]"><span className="h-px flex-1 bg-[#edf1f4]"/>OR CHOOSE UTC DATES<span className="h-px flex-1 bg-[#edf1f4]"/></div><div className="grid grid-cols-2 gap-3"><label className="text-[10px] text-[#95a6b2]">From<input type="date" aria-label="Start observation date" className="field mt-2" value={dateFrom} min={mode==='archive'?data?.range.availableFrom?.slice(0,10):undefined} max={mode==='archive'?data?.range.availableTo?.slice(0,10):undefined} onChange={event=>setDateFrom(event.target.value)}/></label><label className="text-[10px] text-[#95a6b2]">Through<input type="date" aria-label="End observation date" className="field mt-2" value={dateTo} min={mode==='archive'?data?.range.availableFrom?.slice(0,10):undefined} max={mode==='archive'?data?.range.availableTo?.slice(0,10):undefined} onChange={event=>setDateTo(event.target.value)}/></label></div>{dateError&&<div className="mt-4"><ErrorState message={dateError}/></div>}<div className="mt-6 flex justify-end gap-2"><button className="btn-secondary" onClick={()=>setDateModal(false)}>Cancel</button><button className="btn-primary" onClick={applyDates}>Apply window<ArrowRight size={12}/></button></div></Modal>}
  </div>;
}
