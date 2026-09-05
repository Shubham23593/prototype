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
    for (const event of [...events].reverse()) {
      const color = CLASSES[event.prediction.classKey].color;
      const marker = L.circleMarker([event.latitude, event.longitude], { renderer, radius: scaled ? Math.min(4.8, 1.7 + Math.sqrt(event.frp) * .19) : 3.2,
        color, weight: .7, opacity: .95, fillColor: color, fillOpacity: .85 });
      const tip = document.createElement('div');
      const title = document.createElement('div'); title.textContent = coordinates(event.latitude, event.longitude); title.style.fontWeight = '600';
      const description = document.createElement('div'); description.textContent = `${event.frp.toFixed(1)} MW · ${CLASSES[event.prediction.classKey].short}`; description.style.color = '#acbcc7'; description.style.marginTop = '3px';
      tip.append(title, description);
      marker.bindTooltip(tip, { direction: 'top', offset: [0, -5] });
      marker.on('click', () => click.current(event));
      marker.addTo(layer);
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
  const [base, setBase] = useState<'vector' | 'streets'>('vector');
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
    <MapContainer center={region.center} zoom={region.zoom} minZoom={3} maxZoom={17} zoomSnap={.25} preferCanvas renderer={baseRenderer} zoomControl={false} attributionControl>
      {referenceVisible && <>
        {countries && <GeoJSON data={countries} style={{ color: '#62737e', weight: showBoundaries ? .7 : 0, opacity: .45, fillColor: '#283842', fillOpacity: 1 }} />}
        <GeoJSON data={grid} style={{ color: '#8b9ca6', weight: .4, opacity: .1, interactive: false }} />
        <PlaceLabels data={places} countries={countries} visible={showLabels} />
      </>}
      {base === 'streets' && !tileError && <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>' eventHandlers={{ tileerror: () => setTileError(true) }} />}
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
        {layersOpen && <div className="mt-2 w-56 rounded-lg border border-[#465862] bg-[#20313bea] p-3 text-xs text-[#ccd7dd] shadow-xl backdrop-blur">
          <div className="mb-2 text-[9px] font-semibold tracking-widest text-[#899eab]">BASEMAP</div>
          <select aria-label="Select basemap" value={base} onChange={event => { setBase(event.target.value as 'vector' | 'streets'); setTileError(false); }} className="mb-3 w-full rounded border border-[#465b68] bg-[#2c3e49] p-2 text-[11px]">
            <option value="vector">Natural Earth reference</option><option value="streets">CARTO dark streets · online</option>
          </select>
          {([['Thermal observations', showDetections, setShowDetections], ['Scale points by FRP', scaled, setScaled], ['Place labels', showLabels, setShowLabels], ['Country boundaries', showBoundaries, setShowBoundaries]] as const).map(([label, checked, set]) => <label className="flex items-center gap-2 py-2" key={label}><input type="checkbox" checked={checked} onChange={event => set(event.target.checked)} />{label}</label>)}
          <p className="mt-2 border-t border-[#41525e] pt-3 text-[10px] leading-relaxed text-[#8fabb9]">OSM infrastructure appears after a successful evidence query. Boundaries are illustrative.</p>
        </div>}
      </div>
      <div className="hidden rounded-md border border-[#53656e50] bg-[#253640c9] px-2.5 py-2 text-[10px] text-[#a9bac5] sm:block">VIIRS <span className="mx-1 text-[#526c7b]">/</span> 375 m nominal</div>
    </div>
    <div className="absolute right-4 top-4 z-[1000] flex gap-1.5">
      <button title="Reset to selected region" aria-label="Reset map view" onClick={() => setReset(value => value + 1)} className="rounded-md border border-[#53656e80] bg-[#253640ed] p-2 text-[#c6d4dc]"><Crosshair size={15} /></button>
      <button title={fullScreen ? 'Close expanded map' : 'Expand map'} aria-label={fullScreen ? 'Close expanded map' : 'Expand map'} onClick={onFullScreen} className="rounded-md border border-[#53656e80] bg-[#253640ed] p-2 text-[#c6d4dc]">{fullScreen ? <X size={15} /> : <Maximize2 size={15} />}</button>
    </div>
    <div className="absolute bottom-8 left-4 z-[900] flex flex-wrap gap-x-3 gap-y-2 rounded-md border border-[#52637050] bg-[#1c2c35db] px-3 py-2 text-[9px] font-medium text-[#b9c9d2] backdrop-blur-sm">
      {(['vegetation', 'static', 'uncertain'] as const).map(key => <span key={key} className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full" style={{ background: CLASSES[key].color }} />{CLASSES[key].short}</span>)}
    </div>
    <div className="pointer-events-none absolute bottom-1 left-3 z-[900] max-w-[70%] text-[8px] text-[#8ea2b0]">{referenceVisible ? 'Natural Earth · public domain · illustrative boundaries' : 'Online basemap'} <span className="hidden md:inline"> · {pointer}</span></div>
    {mapError && <div className="absolute top-16 left-4 z-[900] rounded bg-[#392e2b] px-3 py-2 text-[10px] text-orange-200">Reference geometry unavailable. Coordinate markers remain real.</div>}
    {tileError && <div className="absolute top-16 left-4 z-[900] rounded bg-[#273e48] px-3 py-2 text-[10px] text-[#c3d6df]">Online tiles unavailable · using genuine Natural Earth geometry</div>}
    <div className="pointer-events-none absolute bottom-9 right-4 z-[900] text-right text-[9px] text-[#8ca0ae]"><div className="mb-1 text-base font-light text-[#bac6ce]">↑</div>N</div>
  </div>;
}
