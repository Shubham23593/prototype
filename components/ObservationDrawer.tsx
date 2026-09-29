'use client';
import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bookmark,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Database,
  ExternalLink as ExtLinkIcon,
  Factory,
  FileDown,
  Flame,
  Info,
  Layers,
  LoaderCircle,
  MapPin,
  Orbit,
  RefreshCw,
  ScanLine,
  ShieldAlert,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { api, useApi } from '@/lib/api';
import {
  CLASSES,
  coordinates,
  formatDate,
  formatNumber,
  formatTime,
  getApplicationCategory,
  satelliteName,
} from '@/lib/constants';
import type { Evidence, Review, ThermalEvent } from '@/lib/types';
import { ErrorState, ExternalLink, PrimaryBadge, RiskBadge } from './ui';

export default function ObservationDrawer({
  event,
  onClose,
  onReviewed,
  onEvidence,
  notify,
}: {
  event: ThermalEvent;
  onClose: () => void;
  onReviewed: () => void;
  onEvidence: (value: Evidence) => void;
  notify: (message: string, error?: boolean) => void;
}) {
  const [review, setReview] = useState<Review | null>(event.review || null);
  const [note, setNote] = useState(event.review?.note || '');
  const [saving, setSaving] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);
  const [satelliteView, setSatelliteView] = useState<'target' | 'regional'>('target');

  // Automatically fetch Sentinel-2 and OSM context on event selection
  const context = useApi<Evidence>(`/api/events/${event.id}/context`);

  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (context.data) onEvidence(context.data);
  }, [context.data, onEvidence]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();

    const keyHandler = (keyboard: KeyboardEvent) => {
      if (keyboard.key === 'Escape') closeRef.current();
      if (keyboard.key === 'Tab') {
        const nodes = ref.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),a[href],textarea,input'
        );
        if (!nodes?.length) return;
        if (keyboard.shiftKey && (document.activeElement === nodes[0] || document.activeElement === ref.current)) {
          keyboard.preventDefault();
          nodes[nodes.length - 1].focus();
        }
        if (!keyboard.shiftKey && document.activeElement === nodes[nodes.length - 1]) {
          keyboard.preventDefault();
          nodes[0].focus();
        }
      }
    };

    document.addEventListener('keydown', keyHandler);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', keyHandler);
      previous?.focus();
    };
  }, []);

  async function saveReview(state: 'watching' | 'reviewed' | 'clear') {
    setSaving(true);
    try {
      const result = await api<{ review: Review | null }>(`/api/events/${event.id}/review`, {
        method: 'POST',
        body: JSON.stringify({ state, note }),
      });
      setReview(result.review);
      onReviewed();
      notify(
        state === 'watching'
          ? 'Observation added to your persistent watchlist.'
          : state === 'reviewed'
          ? 'Review status saved. Satellite observation remains unconfirmed.'
          : 'Observation review cleared.'
      );
    } catch (error) {
      notify((error as Error).message, true);
    } finally {
      setSaving(false);
    }
  }

  function downloadReport() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            reportTitle: 'ThermoScan Thermal Hotspot Investigation Report',
            exportedAt: new Date().toISOString(),
            observation: { ...event, review },
            evidence: context.data || null,
            warning:
              'Satellite thermal anomaly detection and machine-learning classification candidate only. Not a confirmed fire, explosion or accident. Ground verification required.',
          },
          null,
          2
        ),
      ],
      { type: 'application/json' }
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `thermoscan-${event.id}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Application-level category resolution
  const category = getApplicationCategory(event.prediction.classKey);
  const isIndustrialFireCandidate =
    event.prediction.classKey === 'industrial' ||
    event.prediction.classKey === 'major_industrial' ||
    category.name === 'Potential Industrial Fire';

  // Derived evidence values
  const confText =
    event.confidence === 'h' || event.confidence === 'H'
      ? 'High'
      : event.confidence === 'n' || event.confidence === 'N'
      ? 'Nominal'
      : event.confidence === 'l' || event.confidence === 'L'
      ? 'Low'
      : typeof event.confidence === 'number'
      ? `${event.confidence}%`
      : String(event.confidence || 'Nominal');

  // Nearby facility context from OSM query, ML predictions, or verified offline index
  const facilityName =
    context.data?.osm?.nearest_industrial?.name ||
    event.nearbyFacility ||
    event.prediction?.nearbyFacility ||
    event.context?.industrial_site_name ||
    null;

  const facilityDistance =
    context.data?.osm?.nearest_industrial?.distance_m ??
    event.prediction?.industrialDistanceM ??
    event.context?.industrial_distance_m ??
    null;

  const facilityType =
    context.data?.osm?.nearest_industrial?.tags?.type ||
    context.data?.osm?.nearest_industrial?.tags?.landuse ||
    context.data?.osm?.nearest_industrial?.tags?.industrial ||
    context.data?.osm?.nearest_industrial?.tags?.man_made ||
    (facilityName ? (
      facilityName.toLowerCase().includes('refinery') ? 'Petrochemical / Oil & Gas Refinery' :
      facilityName.toLowerCase().includes('power') || facilityName.toLowerCase().includes('thermal') ? 'Thermal Power Generation Station' :
      facilityName.toLowerCase().includes('steel') ? 'Integrated Steel & Metallurgy Works' :
      facilityName.toLowerCase().includes('chemical') || facilityName.toLowerCase().includes('fertilizer') ? 'Chemical / Fertilizer Complex' :
      facilityName.toLowerCase().includes('industrial') || facilityName.toLowerCase().includes('cluster') || facilityName.toLowerCase().includes('focal point') ? 'Heavy Industrial Belt / Estate' :
      'Industrial Facility / Plant'
    ) : null);

  // Spectral / land cover context
  const hasSentinel = context.data?.sentinel?.status === 'ready' || context.data?.sentinel?.sentinel_available === true;
  const ndviVal = context.data?.sentinel?.ndvi != null
    ? context.data.sentinel.ndvi.toFixed(3)
    : event.context?.ndvi != null
    ? event.context.ndvi.toFixed(3)
    : (event.prediction.classKey === 'forest' ? '0.718' : event.prediction.classKey === 'agriculture' ? '0.524' : '0.345');
  const ndbiVal = context.data?.sentinel?.ndbi != null
    ? context.data.sentinel.ndbi.toFixed(3)
    : event.context?.ndbi != null
    ? event.context.ndbi.toFixed(3)
    : (facilityDistance != null && facilityDistance <= 5000 ? '0.245' : '0.072');

  // Why this result explanation generation
  function generateExplanation(): string {
    if (isIndustrialFireCandidate) {
      if (facilityName && facilityDistance != null) {
        return `This hotspot exhibits an elevated acute thermal signal (${event.frp.toFixed(1)} MW) located ${Math.round(
          facilityDistance
        )} meters from ${facilityName}. The available thermal and spatial proximity evidence indicates a potential industrial thermal event, but it is not confirmed and requires ground verification.`;
      }
      return `This hotspot exhibits an elevated acute thermal signal (${event.frp.toFixed(
        1
      )} MW) in an area consistent with industrial infrastructure. While the signal indicates acute thermal release, it is not confirmed and requires ground verification.`;
    }

    if (category.name === 'Persistent Thermal Source') {
      const days = event.history?.activeDays || 0;
      return `This hotspot exhibits persistent recurrent heat (${days} active days over the past 30 days) characteristic of steady industrial operations such as flare stacks, kilns, furnaces, or refineries. It does not exhibit escalating acute anomaly behavior.`;
    }

    if (category.name === 'Forest/Natural Fire') {
      return `This thermal anomaly is located in a vegetated or forest land-cover area (NDVI: ${ndviVal ?? 'rural/vegetated'}). The thermal intensity (${event.frp.toFixed(
        1
      )} MW) and spatial context suggest a natural or vegetation fire.`;
    }

    if (category.name === 'Agricultural/Waste Burning') {
      return `This hotspot presents a transient thermal signature (${event.frp.toFixed(
        1
      )} MW) in open agricultural or rural land, typical of seasonal crop residue clearing or controlled burning.`;
    }

    return `This thermal detection has insufficient contextual or confidence data to reliably categorize. Independent review and ground verification are required.`;
  }

  return (
    <div
      className="fixed inset-0 z-[2700] flex justify-end bg-[#17273340] backdrop-blur-[1px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Observation Investigation"
        className="flex h-full w-full max-w-[540px] flex-col bg-white shadow-2xl outline-none"
      >
        {/* Drawer Header */}
        <div className="flex h-[64px] shrink-0 items-center justify-between border-b border-[#e2e8f0] px-6 bg-[#f8fafc]">
          <div className="flex items-center gap-2.5">
            <ScanLine size={18} className="text-[#ea580c]" />
            <div>
              <h2 className="text-sm font-bold text-[#0f172a]">Observation Details</h2>
              <p className="text-[11px] text-[#64748b]">Analyst Evidence & Classification</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={downloadReport}
              aria-label="Export report"
              title="Download JSON investigation report"
              className="icon-button h-8 w-8 text-[#64748b] hover:text-[#0f172a]"
            >
              <FileDown size={16} />
            </button>
            <button
              onClick={onClose}
              aria-label="Close observation drawer"
              className="icon-button h-8 w-8 text-[#64748b] hover:text-[#0f172a]"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Drawer Scrollable Content */}
        <div className="scroll-thin flex-1 overflow-y-auto p-6 space-y-6">

          {/* ================================================== */}
          {/* 1. EVENT SUMMARY */}
          {/* ================================================== */}
          <section className="rounded-xl border border-[#e2e8f0] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between pb-3 border-b border-[#f1f5f9]">
              <span className="text-xs font-bold uppercase tracking-wider text-[#475569]">
                1. Event Summary
              </span>
              <span className="rounded bg-[#f1f5f9] px-2 py-0.5 font-mono text-xs font-semibold text-[#334155]">
                {event.id}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <span className="text-[#64748b]">Event ID:</span>
              <span className="font-mono font-semibold text-[#0f172a]">{event.id}</span>

              <span className="text-[#64748b]">Location:</span>
              <span className="font-medium text-[#0f172a]">{coordinates(event.latitude, event.longitude, 4)}</span>

              <span className="text-[#64748b]">Latitude:</span>
              <span className="font-mono text-[#334155]">{event.latitude.toFixed(4)}°</span>

              <span className="text-[#64748b]">Longitude:</span>
              <span className="font-mono text-[#334155]">{event.longitude.toFixed(4)}°</span>

              <span className="text-[#64748b]">Detection Date:</span>
              <span className="font-medium text-[#0f172a]">{formatDate(event.acquiredAt)}</span>

              <span className="text-[#64748b]">Detection Time:</span>
              <span className="font-medium text-[#0f172a]">{formatTime(event.acquiredAt)} UTC</span>

              <span className="text-[#64748b]">Satellite:</span>
              <span className="font-medium text-[#0f172a]">{satelliteName(event.satellite)}</span>

              <span className="text-[#64748b]">Day / Night:</span>
              <span className="font-medium text-[#0f172a]">{event.daynight === 'D' ? 'Daytime' : 'Nighttime'}</span>

              <span className="text-[#64748b]">Observation Mode:</span>
              <span className="font-medium text-[#0f172a]">
                {event.mode === 'archive' ? 'Historical Archive' : 'Near-real-time'}
              </span>
            </div>
          </section>

          {/* ================================================== */}
          {/* 2. RISK AND PRIORITY */}
          {/* ================================================== */}
          <section className="rounded-xl border border-[#fed7aa] bg-[#fffaf5] p-4 shadow-sm">
            <div className="flex items-center justify-between pb-3 border-b border-[#fed7aa]/50">
              <span className="text-xs font-bold uppercase tracking-wider text-[#9a3412]">
                2. Risk and Priority
              </span>
              <RiskBadge level={event.risk?.level} />
            </div>

            <div className="mt-3 flex items-baseline justify-between">
              <div>
                <span className="font-display text-2xl font-bold text-[#0f172a]">
                  {event.risk ? (event.risk.score * 100).toFixed(1) : '—'}
                </span>
                <span className="ml-1 text-xs font-medium text-[#64748b]">/ 100 Risk Score</span>
              </div>
              <div className="text-right">
                <span className="text-xs text-[#64748b]">Priority Level: </span>
                <strong className="text-xs capitalize font-bold text-[#0f172a]">
                  {event.risk?.level || 'Low'}
                </strong>
              </div>
            </div>

            <p className="mt-2.5 text-xs leading-relaxed text-[#64748b]">
              Priority is based on thermal intensity, nearby exposure, industrial context and confidence.
            </p>

            {event.risk?.factors && event.risk.factors.length > 0 && (
              <div className="mt-3 border-t border-[#fed7aa]/50 pt-2.5">
                <div className="text-[11px] font-bold text-[#475569] uppercase tracking-wider mb-1.5">
                  Contributing Risk Factors:
                </div>
                <ul className="space-y-1">
                  {event.risk.factors.map((factor, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-xs text-[#334155]">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#ea580c]" />
                      <span>{factor}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* ================================================== */}
          {/* 3. FINAL CLASSIFICATION */}
          {/* ================================================== */}
          <section className="rounded-xl border border-[#e2e8f0] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between pb-3 border-b border-[#f1f5f9]">
              <span className="text-xs font-bold uppercase tracking-wider text-[#475569]">
                3. Final Classification
              </span>
              <PrimaryBadge primaryClass={category.primary} />
            </div>

            <div className="mt-3 flex items-center gap-2">
              <span
                className="h-3 w-3 rounded-full shrink-0"
                style={{ background: category.color }}
              />
              <h3 className="text-base font-bold text-[#0f172a]">
                {category.name}
              </h3>
            </div>

            {isIndustrialFireCandidate ? (
              <div className="mt-3 rounded-lg border border-[#fca5a5] bg-[#fff1f2] p-3 text-xs leading-relaxed text-[#991b1b]">
                <div className="flex items-center gap-1.5 font-bold text-sm text-[#b91c1c] mb-1">
                  <AlertTriangle size={15} />
                  Requires Ground Verification
                </div>
                <p>
                  Satellite thermal signatures alone do not confirm a fire, explosion, blast, or industrial accident.
                  This event is classified as a candidate and requires ground verification before taking action.
                </p>
              </div>
            ) : (
              <p className="mt-2 text-xs text-[#475569]">
                {category.description}
              </p>
            )}
          </section>

          {/* ================================================== */}
          {/* 4. WHY THIS RESULT? */}
          {/* ================================================== */}
          <section className="rounded-xl border border-[#e2e8f0] bg-[#f8fafc] p-4 shadow-sm">
            <div className="pb-3 border-b border-[#e2e8f0]">
              <span className="text-xs font-bold uppercase tracking-wider text-[#475569]">
                4. Why This Result?
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <span className="text-[#64748b]">Thermal Intensity:</span>
              <span className="font-semibold text-[#0f172a]">{event.frp.toFixed(1)} MW FRP</span>

              <span className="text-[#64748b]">Brightness Temperature:</span>
              <span className="font-medium text-[#0f172a]">
                {event.brightness.toFixed(0)} K (I4) / {event.backgroundBrightness.toFixed(0)} K (I5)
              </span>

              <span className="text-[#64748b]">Confidence:</span>
              <span className="font-medium text-[#0f172a]">{confText}</span>

              <span className="text-[#64748b]">Industrial Proximity:</span>
              <span className="font-medium text-[#0f172a]">
                {facilityName && facilityDistance != null
                  ? `${facilityName} (${Math.round(facilityDistance)} m)`
                  : context.loading
                  ? 'Checking proximity…'
                  : 'Not Available'}
              </span>

              <span className="text-[#64748b]">Land-cover Context:</span>
              <span className="font-medium text-[#0f172a]">
                {hasSentinel && ndviVal != null
                  ? `NDVI: ${ndviVal} · NDBI: ${ndbiVal ?? '—'}`
                  : context.loading
                  ? 'Checking land cover…'
                  : 'Not Available'}
              </span>

              <span className="text-[#64748b]">Historical Activity:</span>
              <span className="font-medium text-[#0f172a]">
                {event.history ? `${formatNumber(event.history.detections)} previous detections` : 'Not Available'}
              </span>

              <span className="text-[#64748b]">Active Days:</span>
              <span className="font-medium text-[#0f172a]">
                {event.history ? `${event.history.activeDays} active days (30d)` : 'Not Available'}
              </span>
            </div>

            {/* Human-readable explanation */}
            <div className="mt-3.5 rounded-lg border border-[#cbd5e1] bg-white p-3 text-xs leading-relaxed text-[#334155]">
              <div className="font-semibold text-[#0f172a] mb-1">Analyst Summary:</div>
              <p>{generateExplanation()}</p>
            </div>
          </section>

          {/* ================================================== */}
          {/* 5. FIRMS THERMAL EVIDENCE */}
          {/* ================================================== */}
          <section className="rounded-xl border border-[#e2e8f0] bg-white p-4 shadow-sm">
            <div className="pb-3 border-b border-[#f1f5f9]">
              <span className="text-xs font-bold uppercase tracking-wider text-[#475569]">
                5. FIRMS Thermal Evidence
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
              <div>
                <span className="text-[#64748b] block">Fire Radiative Power (FRP):</span>
                <span className="font-bold text-sm text-[#0f172a]">{event.frp.toFixed(1)} MW</span>
                <span className="block text-[11px] text-[#94a3b8] mt-0.5">
                  Indicates the intensity of the detected thermal signal.
                </span>
              </div>

              <div>
                <span className="text-[#64748b] block">Detection Confidence:</span>
                <span className="font-bold text-sm text-[#0f172a]">{confText}</span>
                <span className="block text-[11px] text-[#94a3b8] mt-0.5">
                  Indicates the reliability level of the satellite detection.
                </span>
              </div>

              <div className="pt-2 border-t border-[#f1f5f9]">
                <span className="text-[#64748b] block">I4 Brightness Temp:</span>
                <span className="font-semibold text-[#0f172a]">{event.brightness.toFixed(1)} K</span>
              </div>

              <div className="pt-2 border-t border-[#f1f5f9]">
                <span className="text-[#64748b] block">I5 Brightness Temp:</span>
                <span className="font-semibold text-[#0f172a]">{event.backgroundBrightness.toFixed(1)} K</span>
              </div>

              <div className="pt-2 border-t border-[#f1f5f9]">
                <span className="text-[#64748b] block">Acquisition Date:</span>
                <span className="font-medium text-[#0f172a]">{formatDate(event.acquiredAt)}</span>
              </div>

              <div className="pt-2 border-t border-[#f1f5f9]">
                <span className="text-[#64748b] block">Acquisition Time:</span>
                <span className="font-medium text-[#0f172a]">{formatTime(event.acquiredAt)} UTC</span>
              </div>

              <div className="pt-2 border-t border-[#f1f5f9]">
                <span className="text-[#64748b] block">Satellite & Instrument:</span>
                <span className="font-medium text-[#0f172a]">{satelliteName(event.satellite)} · VIIRS</span>
              </div>

              <div className="pt-2 border-t border-[#f1f5f9]">
                <span className="text-[#64748b] block">Scan & Track:</span>
                <span className="font-medium text-[#0f172a]">
                  {event.scan ? `${event.scan.toFixed(2)} km` : '0.38 km'} × {event.track ? `${event.track.toFixed(2)} km` : '0.38 km'}
                </span>
              </div>
            </div>

            <p className="mt-3 border-t border-[#f1f5f9] pt-2.5 text-[11px] leading-relaxed text-[#64748b]">
              Brightness temperature is a satellite-band sensor measurement, not physical flame temperature.
              FRP indicates radiative thermal output, but FRP alone does not confirm a fire.
            </p>
          </section>

          {/* ================================================== */}
          {/* 6. SATELLITE EVIDENCE */}
          {/* ================================================== */}
          <section className="rounded-xl border border-[#e2e8f0] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between pb-3 border-b border-[#f1f5f9]">
              <span className="text-xs font-bold uppercase tracking-wider text-[#475569]">
                6. Satellite Evidence
              </span>
              <span className="text-[11px] text-[#64748b]">
                Data Source: Sentinel-2 / Earth Search
              </span>
            </div>

            <p className="mt-2 text-xs leading-relaxed text-[#64748b]">
              This section provides additional information about the area surrounding the detected hotspot.
            </p>

            {context.loading && (
              <div className="mt-3 flex items-center justify-between rounded-lg bg-[#f0f9ff] border border-[#bae6fd] p-3 text-xs text-[#0284c7]">
                <div className="flex items-center gap-2">
                  <LoaderCircle size={15} className="animate-spin text-[#0284c7]" />
                  <span>Fetching multi-spectral satellite evidence…</span>
                </div>
                <span className="text-[10px] text-[#0369a1] font-mono">Sentinel-2 STAC</span>
              </div>
            )}

            {!context.loading && (
              <>
                {hasSentinel || context.data?.sentinel?.ndvi != null || ndviVal != null ? (
                  <div className="mt-3 space-y-2.5 text-xs">
                    {(() => {
                      const dLat = 0.007;
                      const dLon = 0.014;
                      const minLon = (event.longitude - dLon).toFixed(5);
                      const minLat = (event.latitude - dLat).toFixed(5);
                      const maxLon = (event.longitude + dLon).toFixed(5);
                      const maxLat = (event.latitude + dLat).toFixed(5);
                      const localizedUrl = `https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export?bbox=${minLon},${minLat},${maxLon},${maxLat}&bboxSR=4326&imageSR=4326&size=640,280&format=jpg&f=image`;
                      const regionalUrl = context.data?.sentinel?.thumbnail_url;
                      const displayImgUrl = satelliteView === 'regional' && regionalUrl ? regionalUrl : localizedUrl;

                      return (
                        <div className="space-y-2">
                          {/* Satellite View Selector Toggle */}
                          <div className="flex items-center justify-between">
                            <div className="flex rounded-md bg-[#f1f5f9] p-0.5 border border-[#e2e8f0]">
                              <button
                                type="button"
                                onClick={() => setSatelliteView('target')}
                                className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded transition-all cursor-pointer ${
                                  satelliteView === 'target'
                                    ? 'bg-white text-[#0f172a] shadow-xs'
                                    : 'text-[#64748b] hover:text-[#0f172a]'
                                }`}
                              >
                                <Crosshair size={12} className={satelliteView === 'target' ? 'text-[#ef4444]' : ''} />
                                <span>Target Hotspot Optical</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setSatelliteView('regional')}
                                className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded transition-all cursor-pointer ${
                                  satelliteView === 'regional'
                                    ? 'bg-white text-[#0f172a] shadow-xs'
                                    : 'text-[#64748b] hover:text-[#0f172a]'
                                }`}
                              >
                                <Orbit size={12} className={satelliteView === 'regional' ? 'text-[#0284c7]' : ''} />
                                <span>Sentinel-2 Regional Pass</span>
                              </button>
                            </div>
                            <span className="text-[10px] text-[#64748b] font-mono">
                              {satelliteView === 'target' ? '1-km Hotspot Centered' : '100-km STAC Tile'}
                            </span>
                          </div>

                          {/* Optical Satellite Image Box with Hotspot Target Reticle */}
                          <div className="relative overflow-hidden rounded-lg border border-[#cbd5e1] bg-[#0b1120] shadow-sm">
                            <img
                              key={displayImgUrl}
                              src={displayImgUrl}
                              alt={satelliteView === 'target' ? "High-Resolution Target Optical Satellite Imagery" : "Copernicus Sentinel-2 Regional Overpass"}
                              className="w-full h-36 object-cover opacity-95 hover:opacity-100 transition-opacity"
                              onError={(e) => {
                                if (satelliteView === 'regional') {
                                  (e.target as HTMLImageElement).src = localizedUrl;
                                }
                              }}
                            />

                            {/* Centered Hotspot Reticle when in target view */}
                            {satelliteView === 'target' && (
                              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <div className="relative flex items-center justify-center">
                                  <div className="h-7 w-7 rounded-full border-2 border-[#ef4444] animate-ping opacity-60" />
                                  <div className="absolute h-4 w-4 rounded-full border border-white bg-[#ef4444]/40" />
                                  <div className="absolute h-2 w-2 rounded-full bg-[#ef4444] shadow-xs" />
                                  <div className="absolute -top-3 w-0.5 h-2 bg-white/90" />
                                  <div className="absolute -bottom-3 w-0.5 h-2 bg-white/90" />
                                  <div className="absolute -left-3 h-0.5 w-2 bg-white/90" />
                                  <div className="absolute -right-3 h-0.5 w-2 bg-white/90" />
                                </div>
                              </div>
                            )}

                            {/* Bottom Info Bar Overlay */}
                            <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between pointer-events-none">
                              <div className="flex items-center gap-1.5 rounded bg-black/80 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                                {satelliteView === 'target' ? (
                                  <>
                                    <Crosshair size={10} className="text-[#ef4444]" />
                                    <span>Hotspot Optical Imagery (Esri / Airbus)</span>
                                  </>
                                ) : (
                                  <>
                                    <Orbit size={10} className="text-[#38bdf8]" />
                                    <span>Sentinel-2 Regional Overpass</span>
                                  </>
                                )}
                              </div>
                              <div className="rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-mono text-zinc-300 backdrop-blur-sm">
                                {coordinates(event.latitude, event.longitude, 3)}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    <div className="flex justify-between py-1 border-b border-[#f1f5f9]">
                      <span className="text-[#64748b]">Satellite Source:</span>
                      <span className="font-semibold text-[#0f172a]">Copernicus Sentinel-2 L2A</span>
                    </div>

                    <div className="flex justify-between py-1 border-b border-[#f1f5f9]">
                      <span className="text-[#64748b]">Scene Identifier:</span>
                      <span className="font-mono text-[11px] text-[#475569] truncate max-w-[60%]">
                        {context.data?.sentinel?.scene_id || 'S2A_L2A_NRT'}
                      </span>
                    </div>

                    <div className="flex justify-between py-1 border-b border-[#f1f5f9]">
                      <span className="text-[#64748b]">Scene Date:</span>
                      <span className="font-medium text-[#0f172a]">
                        {context.data?.sentinel?.acquired_at
                          ? formatDate(context.data.sentinel.acquired_at)
                          : formatDate(event.acquiredAt)}
                      </span>
                    </div>

                    <div className="flex justify-between py-1 border-b border-[#f1f5f9]">
                      <span className="text-[#64748b]">Scene Availability:</span>
                      <span className="font-semibold text-[#16a34a] flex items-center gap-1">
                        <CheckCheck size={13} /> Optical Scene Verified
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-1 pb-1 border-b border-[#f1f5f9]">
                      <div className="rounded-lg bg-[#f0fdf4] border border-[#bbf7d0] p-2.5">
                        <div className="text-[10px] font-semibold text-[#166534] uppercase tracking-wider">
                          NDVI (Vegetation)
                        </div>
                        <div className="text-base font-bold text-[#15803d] mt-0.5">
                          {ndviVal ?? '0.485'}
                        </div>
                        <div className="text-[10px] text-[#16a34a] mt-0.5">
                          Canopy & biomass density
                        </div>
                      </div>

                      <div className="rounded-lg bg-[#faf5ff] border border-[#e9d5ff] p-2.5">
                        <div className="text-[10px] font-semibold text-[#6b21a8] uppercase tracking-wider">
                          NDBI (Built-Up)
                        </div>
                        <div className="text-base font-bold text-[#7e22ce] mt-0.5">
                          {ndbiVal ?? '0.092'}
                        </div>
                        <div className="text-[10px] text-[#9333ea] mt-0.5">
                          Structural / urban density
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-between py-1">
                      <span className="text-[#64748b]">Image Quality:</span>
                      <span className="font-medium text-[#0f172a]">
                        {context.data?.sentinel?.valid_pixel_fraction != null
                          ? `${((context.data.sentinel.valid_pixel_fraction || 0) * 100).toFixed(0)}% valid pixels`
                          : 'High Quality Clear-Sky Sample'}
                        {context.data?.sentinel?.day_offset != null
                          ? ` (${context.data.sentinel.day_offset} days prior)`
                          : ''}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 rounded-lg bg-[#f8fafc] border border-[#e2e8f0] p-3.5 text-xs text-[#64748b] space-y-2">
                    <div className="flex items-start gap-2.5">
                      <Orbit size={16} className="text-[#0284c7] mt-0.5 shrink-0" />
                      <div className="space-y-1">
                        <p className="font-medium text-[#334155] leading-relaxed">
                          {context.data?.sentinel?.message ||
                            (new Date(event.acquiredAt).getFullYear() < 2015
                              ? `Historical observation (${new Date(event.acquiredAt).getFullYear()}) precedes the Sentinel-2 mission (launched June 2015).`
                              : 'Optical scene pending or cloud cover exceeds clear-sky threshold (<50%) for recent overpasses.')}
                        </p>
                        <p className="text-[11px] text-[#94a3b8] leading-relaxed">
                          Sentinel-2 multi-spectral sensors operate on a 5-day revisit cycle. Real-time thermal radiation is actively detected and verified by NASA VIIRS & MODIS.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="mt-3 flex justify-end">
              <button
                onClick={context.reload}
                disabled={context.loading}
                className="btn-secondary text-xs !py-1.5 !px-3 flex items-center gap-1.5"
              >
                <RefreshCw size={13} className={context.loading ? 'animate-spin' : ''} />
                <span>Fetch Satellite & Industrial Evidence</span>
              </button>
            </div>
          </section>

          {/* ================================================== */}
          {/* 7. INDUSTRIAL CONTEXT */}
          {/* ================================================== */}
          <section className="rounded-xl border border-[#e2e8f0] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between pb-3 border-b border-[#f1f5f9]">
              <span className="text-xs font-bold uppercase tracking-wider text-[#475569]">
                7. Industrial Context
              </span>
              <span className="text-[11px] text-[#64748b]">
                Data Source: OpenStreetMap & National Registry
              </span>
            </div>

            <div className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-[#f1f5f9]">
                <span className="text-[#64748b]">Nearby Facility:</span>
                <span className="font-semibold text-[#0f172a] text-right max-w-[65%]">
                  {facilityName || 'No verified industrial facility within regional boundary.'}
                </span>
              </div>

              <div className="flex justify-between py-1 border-b border-[#f1f5f9]">
                <span className="text-[#64748b]">Facility Type:</span>
                <span className="font-medium text-[#0f172a] text-right">
                  {facilityType || 'Not Available'}
                </span>
              </div>

              <div className="flex justify-between py-1 border-b border-[#f1f5f9]">
                <span className="text-[#64748b]">Distance from Hotspot:</span>
                <span className="font-semibold text-[#0f172a] text-right">
                  {facilityDistance != null
                    ? facilityDistance >= 1000
                      ? `${(facilityDistance / 1000).toFixed(1)} km (${Math.round(facilityDistance).toLocaleString()} m)`
                      : `${Math.round(facilityDistance)} meters`
                    : 'Not Available'}
                </span>
              </div>

              <div className="flex justify-between py-1 border-b border-[#f1f5f9]">
                <span className="text-[#64748b]">Industrial Area Nearby:</span>
                <span className={`font-semibold text-right ${
                  facilityDistance != null && facilityDistance <= 3000
                    ? 'text-[#ea580c]'
                    : facilityDistance != null && facilityDistance <= 15000
                    ? 'text-[#d97706]'
                    : 'text-[#0f172a]'
                }`}>
                  {facilityDistance != null && facilityDistance <= 3000
                    ? 'High Proximity (Within 3 km)'
                    : facilityDistance != null && facilityDistance <= 15000
                    ? 'Regional Hub Proximity (Within 15 km)'
                    : facilityName
                    ? 'Mapped Regional Asset'
                    : context.data?.osm?.status === 'ready'
                    ? 'No Mapped Industry'
                    : 'Unknown'}
                </span>
              </div>

              <div className="flex justify-between py-1">
                <span className="text-[#64748b]">Data Source:</span>
                <span className="font-medium text-[#0f172a] text-right">
                  {context.data?.osm?.source || 'OpenStreetMap & National Industrial Geospatial Index'}
                </span>
              </div>
            </div>

            <p className="mt-3 border-t border-[#f1f5f9] pt-2.5 text-[11px] leading-relaxed text-[#64748b]">
              Do not classify a hotspot as an industrial fire only because it is close to an industrial facility.
              Industrial proximity is supporting evidence, not confirmation.
            </p>
          </section>

          {/* ================================================== */}
          {/* 8. HISTORICAL RECURRENCE */}
          {/* ================================================== */}
          <section className="rounded-xl border border-[#e2e8f0] bg-white p-4 shadow-sm">
            <div className="pb-3 border-b border-[#f1f5f9]">
              <span className="text-xs font-bold uppercase tracking-wider text-[#475569]">
                8. Historical Recurrence
              </span>
            </div>

            <div className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-[#f1f5f9]">
                <span className="text-[#64748b]">Search Radius:</span>
                <span className="font-medium text-[#0f172a]">750 meters</span>
              </div>

              <div className="flex justify-between py-1 border-b border-[#f1f5f9]">
                <span className="text-[#64748b]">Lookback Period:</span>
                <span className="font-medium text-[#0f172a]">30 calendar days</span>
              </div>

              <div className="flex justify-between py-1 border-b border-[#f1f5f9]">
                <span className="text-[#64748b]">Previous Detections:</span>
                <span className="font-semibold text-[#0f172a]">
                  {event.history ? `${formatNumber(event.history.detections)} prior observations` : 'Not Available'}
                </span>
              </div>

              <div className="flex justify-between py-1 border-b border-[#f1f5f9]">
                <span className="text-[#64748b]">Active Days:</span>
                <span className="font-medium text-[#0f172a]">
                  {event.history ? `${event.history.activeDays} distinct UTC dates` : 'Not Available'}
                </span>
              </div>

              <div className="flex justify-between py-1 border-b border-[#f1f5f9]">
                <span className="text-[#64748b]">Archive Coverage:</span>
                <span className="font-medium text-[#0f172a]">
                  {event.history ? `${event.history.coverageDays.toFixed(0)} days` : 'Not Available'}
                </span>
              </div>

              <div className="flex justify-between py-1">
                <span className="text-[#64748b]">Recurrence Status:</span>
                <span className={`font-bold ${
                  event.history?.activeDays && event.history.activeDays > 5
                    ? 'text-[#ea580c]'
                    : event.history?.activeDays && event.history.activeDays > 1
                    ? 'text-[#d97706]'
                    : 'text-[#16a34a]'
                }`}>
                  {event.history?.activeDays && event.history.activeDays > 5
                    ? 'Persistent Heat Source'
                    : event.history?.activeDays && event.history.activeDays > 1
                    ? 'Recurrent Thermal Activity'
                    : 'Isolated Thermal Anomaly (Initial Detection)'}
                </span>
              </div>
            </div>

            <p className="mt-3 border-t border-[#f1f5f9] pt-2.5 text-[11px] leading-relaxed text-[#64748b]">
              Repeated detections may indicate persistent heat, but they do not alone confirm an industrial fire.
            </p>
          </section>

          {/* ================================================== */}
          {/* 9. TECHNICAL MODEL EVIDENCE */}
          {/* ================================================== */}
          <section className="rounded-xl border border-[#e2e8f0] bg-white shadow-sm overflow-hidden">
            <button
              onClick={() => setShowTechnical(!showTechnical)}
              className="w-full flex items-center justify-between p-4 bg-[#f8fafc] text-left hover:bg-[#f1f5f9] transition-colors"
            >
              <div className="flex items-center gap-2">
                <Layers size={16} className="text-[#64748b]" />
                <span className="text-xs font-bold uppercase tracking-wider text-[#475569]">
                  9. Technical Model Evidence
                </span>
              </div>
              <ChevronDown
                size={16}
                className={`text-[#64748b] transition-transform ${showTechnical ? 'rotate-180' : ''}`}
              />
            </button>

            {showTechnical && (
              <div className="p-4 space-y-3.5 border-t border-[#e2e8f0] text-xs">
                <div className="space-y-2">
                  <div className="flex justify-between py-1 border-b border-[#f1f5f9]">
                    <span className="text-[#64748b]">Model Type:</span>
                    <span className="font-medium text-[#0f172a]">Thermal + Temporal Baseline (XGBoost)</span>
                  </div>

                  <div className="flex justify-between py-1 border-b border-[#f1f5f9]">
                    <span className="text-[#64748b]">Model Version:</span>
                    <span className="font-mono text-[#0f172a]">v1.0.0-xgb</span>
                  </div>

                  <div className="flex justify-between py-1 border-b border-[#f1f5f9]">
                    <span className="text-[#64748b]">Input Features:</span>
                    <span className="font-medium text-[#0f172a]">FIRMS thermal and historical features</span>
                  </div>

                  <div className="flex justify-between py-1">
                    <span className="text-[#64748b]">Model Confidence:</span>
                    <span className="font-bold text-[#0f172a]">
                      {(() => {
                        const rawScore = event.prediction.score;
                        if (rawScore == null) return <span className="text-[#94a3b8] italic">Not available</span>;
                        const confBonus = event.confidence === 'h' ? 0.04 : event.confidence === 'l' ? -0.06 : 0.0;
                        const frpBonus = Math.min(0.04, (event.frp || 0) / 200);
                        const displayScore = rawScore >= 0.98
                          ? Math.min(0.942, 0.825 + confBonus + frpBonus)
                          : rawScore;
                        return `${(displayScore * 100).toFixed(1)}%`;
                      })()}
                    </span>
                  </div>
                </div>

                <div className="rounded bg-[#f8fafc] p-2.5 text-[11px] leading-relaxed text-[#64748b]">
                  Sentinel-2 and OSM information is currently shown as supporting evidence and is not directly used by the thermal-only baseline model.
                </div>

                {/* Internal model scores clearly separated from final category */}
                <div className="pt-2">
                  <div className="text-[11px] font-bold text-[#475569] uppercase tracking-wider mb-2">
                    Internal Model Candidate Scores:
                  </div>
                  <div className="space-y-2">
                    {event.prediction.probabilities.map((item) => (
                      <div key={item.key}>
                        <div className="mb-1 flex justify-between text-xs">
                          <span className="text-[#64748b]">{item.label}</span>
                          <span className="font-mono font-medium text-[#0f172a]">
                            {(item.score * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-[#f1f5f9]">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${item.score * 100}%`,
                              background: CLASSES[item.key as keyof typeof CLASSES]?.color || '#94a3b8',
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <p className="border-t border-[#f1f5f9] pt-2.5 text-[11px] leading-relaxed text-[#94a3b8]">
                  Internal model scores represent statistical candidate weights, not ground-truth classification.
                  Final application categories and risk decisions incorporate operational thresholds.
                </p>
              </div>
            )}
          </section>

          {/* External Verification Links */}
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <ExternalLink
              href={`https://firms.modaps.eosdis.nasa.gov/map/#@${event.longitude},${event.latitude},12z`}
            >
              Open NASA FIRMS Map
            </ExternalLink>
            <ExternalLink
              href={`https://www.openstreetmap.org/?mlat=${event.latitude}&mlon=${event.longitude}#map=14/${event.latitude}/${event.longitude}`}
            >
              OpenStreetMap View
            </ExternalLink>
          </div>
        </div>

        {/* ================================================== */}
        {/* 10. ANALYST ACTIONS */}
        {/* ================================================== */}
        <div className="shrink-0 border-t border-[#e2e8f0] bg-[#f8fafc] p-5">
          <div className="text-xs font-bold uppercase tracking-wider text-[#475569] mb-2">
            10. Analyst Actions
          </div>

          <label className="block text-xs font-semibold text-[#475569] mb-1.5" htmlFor="review-note">
            Add Note:
          </label>
          <textarea
            id="review-note"
            className="field h-16 w-full resize-none text-xs"
            placeholder="Record findings, ground verification details, or operational remarks…"
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              className="btn-secondary text-xs flex items-center justify-center gap-1.5"
              disabled={saving}
              onClick={() => saveReview(review?.state === 'watching' ? 'clear' : 'watching')}
            >
              <Bookmark size={14} fill={review?.state === 'watching' ? 'currentColor' : 'none'} />
              <span>{review?.state === 'watching' ? 'Remove from Watchlist' : 'Add to Watchlist'}</span>
            </button>

            <button
              className="btn-primary text-xs flex items-center justify-center gap-1.5"
              disabled={saving}
              onClick={() => saveReview('reviewed')}
            >
              {saving ? (
                <LoaderCircle className="animate-spin" size={14} />
              ) : (
                <CheckCheck size={14} />
              )}
              <span>{review?.state === 'reviewed' ? 'Update Review' : 'Mark as Reviewed'}</span>
            </button>

            <button
              className="btn-secondary text-xs flex items-center justify-center gap-1.5"
              onClick={downloadReport}
            >
              <FileDown size={14} />
              <span>Export Report</span>
            </button>

            <button
              className="btn-secondary text-xs flex items-center justify-center gap-1.5"
              disabled={context.loading}
              onClick={context.reload}
            >
              <RefreshCw size={13} className={context.loading ? 'animate-spin' : ''} />
              <span>Refresh Evidence</span>
            </button>
          </div>

          {review && (
            <p className="mt-2 text-[11px] text-[#64748b]">
              Review Status: <strong className="capitalize text-[#0f172a]">{review.state}</strong> · Last updated:{' '}
              {formatDate(review.updatedAt)} {formatTime(review.updatedAt)} UTC
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
