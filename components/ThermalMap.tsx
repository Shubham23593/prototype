'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, GeoJSON, ScaleControl, TileLayer, useMap, useMapEvents, ZoomControl } from 'react-leaflet';
import L from 'leaflet';
import type { FeatureCollection, GeoJsonObject } from 'geojson';
import { ChevronDown, Crosshair, Layers, Maximize2, Minus, Plus, X } from 'lucide-react';
import { CLASSES, coordinates, formatNumber } from '@/lib/constants';
import type { Evidence, Region, ThermalEvent } from '@/lib/types';

// Leaflet 1.9 can leave a queued redraw during React subtree teardown.
// The callback must not paint after its map/context has been disposed. Guard
// only that lifecycle state; live drawing and source data are unchanged.
type CanvasLifecycle = L.Canvas & { _ctx?: CanvasRenderingContext2D; _map?: L.Map; _redrawRequest: number | null; _redraw: () => void };
const LifecycleCanvas = L.Canvas.extend({
  _redraw(this: CanvasLifecycle) {
    if (!this._ctx || !this._map) { this._redrawRequest = null; return; }
    (L.Canvas.prototype as unknown as CanvasLifecycle)._redraw.call(this);
  },
});
const makeCanvas = () => new (LifecycleCanvas as unknown as { new(options: L.RendererOptions): L.Canvas })({ padding: .3 });

interface Props {
  events: ThermalEvent[]; region: Region; selected: ThermalEvent | null;
  onSelect: (event: ThermalEvent) => void; fullScreen: boolean; onFullScreen: () => void;
  infrastructure?: Evidence['osm']['features'];
}

function ObservationLayer({ events, onSelect, visible, scaled }: {events: ThermalEvent[]; onSelect: Props['onSelect']; visible: boolean; scaled: boolean}) {
  const map = useMap();
  const click = useRef(onSelect);
  useEffect(() => { click.current = onSelect; }, [onSelect]);
  useEffect(() => {
    if (!visible) return;
    const layer = L.layerGroup().addTo(map);
    const renderer = makeCanvas();

    // Separate normal events and high/critical alerts so alerts render with prominent highlight on top
    const normalEvents: ThermalEvent[] = [];
    const alertEvents: ThermalEvent[] = [];
    for (const event of events) {
      if (event.risk?.level === 'critical' || event.risk?.level === 'high') {
        alertEvents.push(event);
      } else {
        normalEvents.push(event);
      }
    }

    // 1. Render normal observation markers
    for (const event of [...normalEvents].reverse()) {
      const color = CLASSES[event.prediction.classKey]?.color || '#94a3b8';
      const marker = L.circleMarker([event.latitude, event.longitude], {
        renderer,
        radius: scaled ? Math.min(4.8, 1.7 + Math.sqrt(event.frp) * .19) : 3.2,
        color,
        weight: .7,
        opacity: .95,
        fillColor: color,
        fillOpacity: .85
      });
      const coordsText = coordinates(event.latitude, event.longitude);
      const classText = CLASSES[event.prediction.classKey]?.short || event.prediction.classKey;
      marker.bindTooltip(
        `<div style="font-weight:600">${coordsText}</div><div style="color:#acbcc7;margin-top:3px">${event.frp.toFixed(1)} MW · ${classText}</div>`,
        { direction: 'top', offset: [0, -5] }
      );
      marker.on('click', () => click.current(event));
      marker.addTo(layer);
    }

    // 2. Render High & Critical alert markers with glowing halo and rich tooltips
    for (const event of alertEvents) {
      const isCritical = event.risk?.level === 'critical';
      const haloColor = isCritical ? '#ef4444' : '#f97316';
      const coreColor = isCritical ? '#dc2626' : '#ea580c';
      const baseRadius = scaled ? Math.min(6.5, 2.8 + Math.sqrt(event.frp) * .22) : 4.5;

      // Outer glowing halo (non-interactive so it doesn't double-bind events)
      const halo = L.circleMarker([event.latitude, event.longitude], {
        renderer,
        radius: baseRadius + 6,
        color: haloColor,
        weight: 2,
        opacity: 0.95,
        fillColor: haloColor,
        fillOpacity: 0.28,
        dashArray: isCritical ? '5, 3' : undefined,
        interactive: false,
      });

      // Core alert marker with white border
      const core = L.circleMarker([event.latitude, event.longitude], {
        renderer,
        radius: baseRadius,
        color: '#ffffff',
        weight: 1.8,
        opacity: 1,
        fillColor: coreColor,
        fillOpacity: 0.95,
      });

      const facilityName = event.nearbyFacility || event.context?.industrial_site_name;
      const facHtml = facilityName ? `<div style="color:#fef08a;font-size:9px;margin-top:3px">Facility: ${facilityName}</div>` : '';
      const coordsText = `${coordinates(event.latitude, event.longitude)} · ${event.frp.toFixed(1)} MW FRP`;
      const riskText = `Risk Score: ${((event.risk?.score || 0) * 100).toFixed(1)}/100 · ${event.prediction.label}`;
      const badgeText = isCritical ? 'CRITICAL PRIORITY ALERT' : 'HIGH PRIORITY ALERT';

      core.bindTooltip(
        `<div style="min-width:180px;padding:2px"><div style="font-weight:800;font-size:10px;letter-spacing:0.04em;color:${haloColor};margin-bottom:3px">${badgeText}</div><div style="font-weight:600;font-size:11px">${coordsText}</div><div style="color:#cad5dd;font-size:9.5px;margin-top:2px">${riskText}</div>${facHtml}</div>`,
        { direction: 'top', offset: [0, -8] }
      );
      core.on('click', () => click.current(event));

      halo.addTo(layer);
      core.addTo(layer);
    }

    return () => { map.removeLayer(layer); if (map.hasLayer(renderer)) map.removeLayer(renderer); };
  }, [map, events, visible, scaled]);
  return null;
}

function MapEffects({ region, selected, fullScreen, reset }: {region: Region; selected: ThermalEvent | null; fullScreen: boolean; reset: number}) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds([[region.bbox[1], region.bbox[0]], [region.bbox[3], region.bbox[2]]], { padding: [12, 10], maxZoom: region.zoom + 1, animate: false });
  }, [region, map, reset]);
  useEffect(() => {
    if (!selected) return;
    map.flyTo([selected.latitude, selected.longitude], Math.max(map.getZoom(), 7), { duration: .65 });
    const ring = L.circleMarker([selected.latitude, selected.longitude], { radius: 11, color: '#ffffff', weight: 1.8, fillOpacity: .1 }).addTo(map);
    return () => { map.removeLayer(ring); };
  }, [selected, map]);
  useEffect(() => { const id = setTimeout(() => map.invalidateSize(), 150); return () => clearTimeout(id); }, [fullScreen, map]);
  return null;
}

function PlaceLabels({ data, countries, visible }: {data: FeatureCollection | null; countries: FeatureCollection | null; visible: boolean}) {
  const map = useMap();
  useEffect(() => {
    if (!visible) return;
    const layer = L.layerGroup().addTo(map);
    for (const feature of data?.features || []) {
      if (feature.geometry.type !== 'Point') continue;
      const [lon, lat] = feature.geometry.coordinates;
      const text = document.createElement('span'); text.textContent = feature.properties?.NAME;
      const icon = L.divIcon({ className: 'map-city', html: text, iconSize: [100, 12], iconAnchor: [-4, 4] });
      L.marker([lat, lon], { icon, interactive: false }).addTo(layer);
      L.circleMarker([lat, lon], { radius: 1.5, color: '#a4b2bd', weight: .5, fillOpacity: 1, interactive: false }).addTo(layer);
    }
    for (const feature of countries?.features || []) {
      const p = feature.properties;
      if (!p || !['India', 'Pakistan', 'China', 'Nepal', 'Bangladesh', 'Myanmar', 'Sri Lanka', 'Bhutan'].includes(p.NAME)) continue;
      const text = document.createElement('span'); text.textContent = p.NAME;
      L.marker([p.LABEL_Y, p.LABEL_X], { icon: L.divIcon({ className: 'map-country', html: text, iconSize: [130, 18], iconAnchor: [65, 9] }), interactive: false }).addTo(layer);
    }
    return () => { map.removeLayer(layer); };
  }, [data, countries, visible, map]);
  return null;
}

function InfrastructureLayer({ features }: {features?: Evidence['osm']['features']}) {
  const map = useMap();
  useEffect(() => {
    if (!features?.length) return;
    const layer = L.layerGroup().addTo(map);
    for (const item of features.filter(item => item.industrial)) {
      const tip = document.createElement('span'); tip.textContent = `${item.name} · OSM mapped infrastructure`;
      L.circleMarker([item.latitude, item.longitude], { radius: 7, color: '#83c6ca', fillColor: '#83c6ca', fillOpacity: .16, weight: 2 }).bindTooltip(tip).addTo(layer);
    }
    return () => { map.removeLayer(layer); };
  }, [features, map]);
  return null;
}

function Pointer({ onMove }: {onMove: (value: string) => void}) {
  useMapEvents({ mousemove(event) { onMove(coordinates(event.latlng.lat, event.latlng.lng, 2)); } });
  return null;
}

export default function ThermalMap({ events, region, selected, onSelect, fullScreen, onFullScreen, infrastructure }: Props) {
  const baseRenderer = useMemo(makeCanvas, []);
  const [countries, setCountries] = useState<FeatureCollection | null>(null);
  const [places, setPlaces] = useState<FeatureCollection | null>(null);
  const [base, setBase] = useState<'default' | 'satellite' | 'vector'>('default');
  const [layersOpen, setLayersOpen] = useState(false);
  const [showDetections, setShowDetections] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [showBoundaries, setShowBoundaries] = useState(true);
  const [scaled, setScaled] = useState(true);
  const [reset, setReset] = useState(0);
  const [pointer, setPointer] = useState('Hover to inspect coordinates');
  const [tileError, setTileError] = useState(false);
  const [mapError, setMapError] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    Promise.all(['/geo/countries.geojson', '/geo/places.geojson'].map(url => fetch(url, { signal: abort.signal }).then(response => { if (!response.ok) throw new Error('Reference map unavailable'); return response.json(); })))
      .then(([countryData, placeData]) => { setCountries(countryData); setPlaces(placeData); })
      .catch(error => { if (error.name !== 'AbortError') setMapError(true); });
    return () => abort.abort();
  }, []);
  const grid = useMemo(() => {
    const lines: GeoJsonObject = { type: 'FeatureCollection', features: [
      ...Array.from({ length: 37 }, (_, index) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-180 + index * 10, -80], [-180 + index * 10, 85]] } })),
      ...Array.from({ length: 17 }, (_, index) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-180, -80 + index * 10], [180, -80 + index * 10]] } })),
    ] } as GeoJsonObject;
    return lines;
  }, []);
  const referenceVisible = base === 'vector' || tileError;
  return <div className="relative h-full min-h-[380px] isolate overflow-hidden bg-[#1a272f]">
    <MapContainer center={region.center} zoom={region.zoom} minZoom={3} maxZoom={19} zoomSnap={.25} preferCanvas renderer={baseRenderer} zoomControl={false} attributionControl>
      {referenceVisible && <>
        {countries && <GeoJSON data={countries} style={{ color: '#62737e', weight: showBoundaries ? .7 : 0, opacity: .45, fillColor: '#283842', fillOpacity: 1 }} />}
        <GeoJSON data={grid} style={{ color: '#8b9ca6', weight: .4, opacity: .1, interactive: false }} />
        <PlaceLabels data={places} countries={countries} visible={showLabels} />
      </>}
      {base === 'default' && !tileError && (
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          maxZoom={19}
          eventHandlers={{ tileerror: () => setTileError(true) }}
        />
      )}
      {base === 'satellite' && !tileError && (
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
          maxZoom={19}
          eventHandlers={{ tileerror: () => setTileError(true) }}
        />
      )}
      <ObservationLayer events={events} visible={showDetections} scaled={scaled} onSelect={onSelect} />
      <InfrastructureLayer features={infrastructure} />
      <MapEffects region={region} selected={selected} fullScreen={fullScreen} reset={reset} />
      <Pointer onMove={setPointer} />
      <ZoomControl position="topright" />
      <ScaleControl position="bottomleft" imperial={false} />
    </MapContainer>
    <div className="absolute top-4 left-4 z-[1000] flex items-start gap-2">
      <div className="relative">
        <button onClick={() => setLayersOpen(!layersOpen)} aria-expanded={layersOpen} className="flex items-center gap-2 rounded-md border border-[#53656e80] bg-[#253640ed] px-3 py-2 text-[11px] font-medium text-[#d3dce1] shadow-sm"><Layers size={13} /> Map layers <ChevronDown size={12} /></button>
        {layersOpen && <div className="mt-2 w-64 rounded-lg border border-[#465862] bg-[#20313bea] p-3 text-xs text-[#ccd7dd] shadow-xl backdrop-blur">
          <div className="mb-2 text-[9px] font-semibold tracking-widest text-[#899eab]">BASEMAP</div>
          <select aria-label="Select basemap" value={base} onChange={event => { setBase(event.target.value as 'default' | 'satellite' | 'vector'); setTileError(false); }} className="mb-3 w-full rounded border border-[#465b68] bg-[#2c3e49] p-2 text-[11px]">
            <option value="default">Default (OpenStreetMap)</option>
            <option value="satellite">Satellite (Esri World Imagery)</option>
            <option value="vector">Natural Earth reference</option>
          </select>
          {([['Thermal observations', showDetections, setShowDetections], ['Scale points by FRP', scaled, setScaled], ['Place labels', showLabels, setShowLabels], ['Country boundaries', showBoundaries, setShowBoundaries]] as const).map(([label, checked, set]) => <label className="flex items-center gap-2 py-2" key={label}><input type="checkbox" checked={checked} onChange={event => set(event.target.checked)} />{label}</label>)}
          <p className="mt-2 border-t border-[#41525e] pt-3 text-[10px] leading-relaxed text-[#8fabb9]">OSM infrastructure appears after a successful evidence query. Satellite imagery provided by Esri.</p>
        </div>}
      </div>
      <div className="hidden rounded-md border border-[#53656e50] bg-[#253640c9] px-2.5 py-2 text-[10px] text-[#a9bac5] sm:block">VIIRS <span className="mx-1 text-[#526c7b]">/</span> 375 m nominal</div>
    </div>
    <div className="absolute right-4 top-4 z-[1000] flex gap-1.5">
      <button title="Reset to selected region" aria-label="Reset map view" onClick={() => setReset(value => value + 1)} className="rounded-md border border-[#53656e80] bg-[#253640ed] p-2 text-[#c6d4dc]"><Crosshair size={15} /></button>
      <button title={fullScreen ? 'Close expanded map' : 'Expand map'} aria-label={fullScreen ? 'Close expanded map' : 'Expand map'} onClick={onFullScreen} className="rounded-md border border-[#53656e80] bg-[#253640ed] p-2 text-[#c6d4dc]">{fullScreen ? <X size={15} /> : <Maximize2 size={15} />}</button>
    </div>
    <div className="absolute bottom-8 left-4 z-[900] flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-[#52637050] bg-[#1c2c35db] px-3 py-2 text-[9px] font-medium text-[#b9c9d2] backdrop-blur-sm">
      {events.some(e => e.risk?.level === 'critical' || e.risk?.level === 'high') && (
        <span className="flex items-center gap-1.5 rounded-full bg-[#ef444426] border border-[#ef444466] px-2 py-0.5 font-bold text-[#fca5a5]">
          <span className="h-2 w-2 rounded-full bg-[#ef4444] animate-pulse" />
          {events.filter(e => e.risk?.level === 'critical' || e.risk?.level === 'high').length} High/Critical Alerts
        </span>
      )}
      {(['industrial', 'forest', 'agriculture', 'persistent', 'uncertain'] as const).map(key => (
        <span key={key} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: CLASSES[key]?.color || '#9ca3af' }} />
          {CLASSES[key]?.label || key}
        </span>
      ))}
    </div>
    <div className="pointer-events-none absolute bottom-1 left-3 z-[900] max-w-[70%] text-[8px] text-[#8ea2b0]">{base === 'satellite' ? 'Esri World Imagery' : base === 'default' ? '© OpenStreetMap contributors' : 'Natural Earth · public domain'} <span className="hidden md:inline"> · {pointer}</span></div>
    {mapError && <div className="absolute top-16 left-4 z-[900] rounded bg-[#392e2b] px-3 py-2 text-[10px] text-orange-200">Reference geometry unavailable. Coordinate markers remain real.</div>}
    {tileError && <div className="absolute top-16 left-4 z-[900] rounded bg-[#273e48] px-3 py-2 text-[10px] text-[#c3d6df]">Online tiles unavailable · using fallback geometry</div>}
    <div className="pointer-events-none absolute bottom-9 right-4 z-[900] text-right text-[9px] text-[#8ca0ae]"><div className="mb-1 text-base font-light text-[#bac6ce]">↑</div>N</div>
  </div>;
}
