'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Globe, Layers, Maximize2, Minimize2 } from 'lucide-react';
import {
  alignCoordsToMyWhooshWorld,
  isMyWhooshContext,
  resolveMyWhooshWorldForActivity,
} from '@/lib/mywhoosh-maps';
import { decodePolyline } from '@/lib/polyline';
import type { ActivityPoint, SportType } from '@/types';

type MapStyle = 'virtual' | 'topo' | 'osm' | 'dark';

const TILE_LAYERS: Record<Exclude<MapStyle, 'virtual'>, { label: string; url: string; attribution: string }> = {
  topo: {
    label: 'Topo',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '© OpenTopoMap (CC-BY-SA)',
  },
  osm: {
    label: 'Mapa',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap',
  },
  dark: {
    label: 'Oscuro',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '© CartoDB',
  },
};

export default function ActivityMap({
  points,
  polyline,
  sport,
  subSport,
  deviceName,
  worldName,
  title,
  color = '#fc4c02',
  defaultLayer = 'topo',
  hoverPoint,
  highlightPolyline,
  heightClass = 'h-80',
}: {
  points?: ActivityPoint[];
  polyline?: string | null;
  sport?: SportType;
  subSport?: string | null;
  deviceName?: string | null;
  worldName?: string | null;
  title?: string | null;
  color?: string;
  defaultLayer?: MapStyle;
  hoverPoint?: ActivityPoint | null;
  highlightPolyline?: string | null;
  heightClass?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const baseLayerRef = useRef<import('leaflet').Layer | null>(null);
  const routeLayerGroupRef = useRef<import('leaflet').LayerGroup | null>(null);
  const highlightLayerRef = useRef<import('leaflet').Polyline | null>(null);
  const hoverMarkerRef = useRef<import('leaflet').CircleMarker | null>(null);
  const leafletRef = useRef<typeof import('leaflet') | null>(null);

  const coords: Array<[number, number]> = useMemo(
    () =>
      points && points.some((p) => typeof p.lat === 'number' && typeof p.lon === 'number')
        ? points
            .filter(
              (p): p is ActivityPoint & { lat: number; lon: number } =>
                typeof p.lat === 'number' && typeof p.lon === 'number'
            )
            .map((p) => [p.lat, p.lon])
        : polyline
          ? decodePolyline(polyline)
          : [],
    [points, polyline]
  );

  const myWhooshMatch = useMemo(() => {
    const virtualCtx = isMyWhooshContext({ sport, subSport, worldName, title, deviceName });
    if (!virtualCtx && coords.length === 0) return null;
    return resolveMyWhooshWorldForActivity({
      sport,
      subSport,
      worldName,
      title,
      deviceName,
      coords,
    });
  }, [sport, subSport, worldName, title, deviceName, coords]);

  const alignedTrace = useMemo(() => {
    if (!myWhooshMatch || coords.length < 2) return null;
    return alignCoordsToMyWhooshWorld(myWhooshMatch.world, coords);
  }, [myWhooshMatch, coords]);

  const [layer, setLayer] = useState<MapStyle>(myWhooshMatch ? 'virtual' : defaultLayer);
  const [fitScope, setFitScope] = useState<'world' | 'route'>('world');

  useEffect(() => {
    if (myWhooshMatch) {
      setLayer('virtual');
    }
  }, [myWhooshMatch]);

  const displayCoords = useMemo(() => {
    if (layer === 'virtual' && alignedTrace) {
      return alignedTrace.alignedCoords;
    }
    return coords;
  }, [layer, alignedTrace, coords]);

  // Inicializar mapa Leaflet una sola vez cuando exista contenedor y contenido
  useEffect(() => {
    if (!containerRef.current || (coords.length < 2 && !myWhooshMatch)) return;
    let active = true;

    (async () => {
      const L = (await import('leaflet')).default;
      if (!active || !containerRef.current) return;
      leafletRef.current = L;

      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }

      const map = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
        zoomSnap: 0.25,
        zoomDelta: 0.5,
      });
      mapRef.current = map;
      routeLayerGroupRef.current = L.layerGroup().addTo(map);
    })();

    return () => {
      active = false;
      routeLayerGroupRef.current = null;
      baseLayerRef.current = null;
      highlightLayerRef.current = null;
      hoverMarkerRef.current = null;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords.length >= 2 || Boolean(myWhooshMatch)]);

  // Actualizar capa base + traza + encuadre cuando cambian capa, mundo o datos
  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    const routeGroup = routeLayerGroupRef.current;
    if (!map || !L || !routeGroup) return;

    if (baseLayerRef.current) {
      map.removeLayer(baseLayerRef.current);
      baseLayerRef.current = null;
    }
    routeGroup.clearLayers();

    const isVirtual = layer === 'virtual' && Boolean(myWhooshMatch);

    if (isVirtual && myWhooshMatch) {
      if (containerRef.current) containerRef.current.style.background = myWhooshMatch.world.backgroundColor;
      const overlay = L.imageOverlay(myWhooshMatch.world.imageUrl, myWhooshMatch.bounds, {
        attribution: `MyWhoosh · ${myWhooshMatch.world.name}`,
      }).addTo(map);
      overlay.bringToBack();
      baseLayerRef.current = overlay;
    } else {
      if (containerRef.current) containerRef.current.style.background = '#0f172a';
      const fallbackStyle = defaultLayer === 'virtual' ? 'topo' : defaultLayer;
      const cfg = TILE_LAYERS[layer === 'virtual' ? fallbackStyle : layer];
      baseLayerRef.current = L.tileLayer(cfg.url, {
        attribution: cfg.attribution,
        maxZoom: 17,
      }).addTo(map);
    }

    if (displayCoords.length >= 2) {
      // Sombra sutil debajo de la ruta en mapa virtual para mayor contraste
      if (isVirtual) {
        L.polyline(displayCoords, {
          color: '#0f172a',
          weight: 7,
          opacity: 0.45,
          lineJoin: 'round',
        }).addTo(routeGroup);
      }

      const line = L.polyline(displayCoords, {
        color: isVirtual ? '#fc4c02' : color,
        weight: isVirtual ? 4.2 : 4,
        opacity: 0.96,
        lineJoin: 'round',
      }).addTo(routeGroup);

      L.circleMarker(displayCoords[0], {
        radius: 6,
        color: '#ffffff',
        weight: 2,
        fillColor: '#10b981',
        fillOpacity: 1,
      })
        .bindTooltip('Inicio')
        .addTo(routeGroup);

      L.circleMarker(displayCoords[displayCoords.length - 1], {
        radius: 6,
        color: '#ffffff',
        weight: 2,
        fillColor: '#ef4444',
        fillOpacity: 1,
      })
        .bindTooltip('Fin')
        .addTo(routeGroup);

      if (isVirtual && myWhooshMatch && fitScope === 'world') {
        map.fitBounds(myWhooshMatch.bounds, { padding: [10, 10] });
      } else {
        map.fitBounds(line.getBounds(), { padding: [24, 24] });
      }
    } else if (isVirtual && myWhooshMatch) {
      map.fitBounds(myWhooshMatch.bounds, { padding: [10, 10] });
    }
  }, [layer, myWhooshMatch, defaultLayer, displayCoords, color, fitScope]);

  // Resaltar segmento sobre el mapa si hay highlightPolyline
  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;

    if (highlightLayerRef.current) {
      map.removeLayer(highlightLayerRef.current);
      highlightLayerRef.current = null;
    }

    if (highlightPolyline) {
      let hCoords = decodePolyline(highlightPolyline);
      if (layer === 'virtual' && myWhooshMatch && hCoords.length >= 2) {
        hCoords = alignCoordsToMyWhooshWorld(myWhooshMatch.world, hCoords).alignedCoords;
      }
      if (hCoords.length >= 2) {
        highlightLayerRef.current = L.polyline(hCoords, {
          color: '#facc15',
          weight: 7,
          opacity: 0.95,
        }).addTo(map);
        map.fitBounds(highlightLayerRef.current.getBounds(), { padding: [36, 36] });
      }
    }
  }, [highlightPolyline, layer, myWhooshMatch]);

  // Índice rápido de coordenadas para sincronizar el cursor de las gráficas sobre la traza alineada
  const coordIndexMap = useMemo(() => {
    const m = new Map<string, number>();
    coords.forEach(([la, lo], idx) => {
      const k = `${la.toFixed(5)},${lo.toFixed(5)}`;
      if (!m.has(k)) m.set(k, idx);
    });
    return m;
  }, [coords]);

  // Marcador interactivo al pasar el ratón por las gráficas
  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;

    if (hoverPoint && typeof hoverPoint.lat === 'number' && typeof hoverPoint.lon === 'number') {
      let targetLatLon: [number, number] = [hoverPoint.lat, hoverPoint.lon];
      if (layer === 'virtual' && displayCoords.length === coords.length) {
        const key = `${hoverPoint.lat.toFixed(5)},${hoverPoint.lon.toFixed(5)}`;
        const exactIdx = coordIndexMap.get(key);
        if (exactIdx !== undefined) {
          targetLatLon = displayCoords[exactIdx];
        } else if (coords.length > 0) {
          let bestIdx = 0;
          let bestD2 = Infinity;
          for (let i = 0; i < coords.length; i++) {
            const d2 = (coords[i][0] - hoverPoint.lat) ** 2 + (coords[i][1] - hoverPoint.lon) ** 2;
            if (d2 < bestD2) {
              bestD2 = d2;
              bestIdx = i;
            }
          }
          targetLatLon = displayCoords[bestIdx];
        }
      }

      if (!hoverMarkerRef.current) {
        hoverMarkerRef.current = L.circleMarker(targetLatLon, {
          radius: 7,
          color: '#ffffff',
          weight: 2,
          fillColor: '#06b6d4',
          fillOpacity: 1,
        }).addTo(map);
      } else {
        hoverMarkerRef.current.setLatLng(targetLatLon);
      }
    } else if (hoverMarkerRef.current) {
      map.removeLayer(hoverMarkerRef.current);
      hoverMarkerRef.current = null;
    }
  }, [hoverPoint, layer, coords, displayCoords, coordIndexMap]);

  if (coords.length < 2 && !myWhooshMatch) {
    return (
      <div
        className={`${heightClass} rounded-xl flex items-center justify-center text-sm border`}
        style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
      >
        Sin coordenadas GPS (actividad indoor / fuerza)
      </div>
    );
  }

  return (
    <div className="relative rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border-subtle)' }}>
      <div ref={containerRef} className={`${heightClass} w-full`} />
      <div className="absolute top-3 right-3 z-[400] flex flex-col items-end gap-1.5">
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-900/85 backdrop-blur px-1.5 py-1 border border-slate-700/70">
          {myWhooshMatch ? (
            <Globe className="h-3.5 w-3.5 text-cyan-400 ml-1" />
          ) : (
            <Layers className="h-3.5 w-3.5 text-slate-300 ml-1" />
          )}
          {myWhooshMatch && (
            <button
              type="button"
              onClick={() => setLayer('virtual')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                layer === 'virtual' ? 'bg-cyan-500 text-slate-950 font-semibold' : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              Mundo {myWhooshMatch.world.name}
            </button>
          )}
          {(Object.keys(TILE_LAYERS) as Array<Exclude<MapStyle, 'virtual'>>).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setLayer(key)}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                layer === key ? 'bg-[#fc4c02] text-white' : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              {TILE_LAYERS[key].label}
            </button>
          ))}
          {layer === 'virtual' && myWhooshMatch && displayCoords.length >= 2 && (
            <button
              type="button"
              onClick={() => setFitScope((s) => (s === 'world' ? 'route' : 'world'))}
              title={fitScope === 'world' ? 'Acercar zoom a la ruta' : 'Ver mundo completo'}
              className="ml-0.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-slate-200 hover:bg-slate-800 border-l border-slate-700/80 pl-2"
            >
              {fitScope === 'world' ? <Maximize2 className="h-3 w-3" /> : <Minimize2 className="h-3 w-3" />}
              {fitScope === 'world' ? 'Ruta' : 'Mundo'}
            </button>
          )}
        </div>

        {layer === 'virtual' && myWhooshMatch && (
          <div className="flex items-center gap-2 rounded-lg bg-slate-900/80 backdrop-blur px-2.5 py-1 text-[10px] text-slate-200 border border-slate-700/60">
            {alignedTrace?.mode === 'rigid-road-lock' && (
              <span className="text-emerald-300 font-medium">
                Encaje exacto en red · RMS {alignedTrace.rmsErrorM} m
              </span>
            )}
            {alignedTrace?.mode === 'native' && (
              <span className="text-cyan-300 font-medium">Coordenadas nativas del mundo</span>
            )}
            {alignedTrace?.mode === 'centered' && (
              <span className="text-amber-300 font-medium">Traza centrada (mapa esquemático)</span>
            )}
            <a
              href={myWhooshMatch.world.mywhooshInfoUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-slate-300 hover:text-cyan-300 underline decoration-slate-600"
            >
              mywhooshinfo <ExternalLink className="h-2.5 w-2.5" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
