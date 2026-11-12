'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Globe, Layers, Maximize2, Minimize2 } from 'lucide-react';
import {
  alignCoordsToMyWhooshWorld,
  getWorldDisplayBounds,
  isMyWhooshContext,
  resolveMyWhooshWorldForActivity,
  toWorldDisplayCoord,
  toWorldDisplayCoords,
} from '@/lib/mywhoosh-maps';
import { decodePolyline } from '@/lib/polyline';
import type { ActivityPoint, SportType } from '@/types';

type MapStyle = 'virtual' | 'topo' | 'osm' | 'dark';

const TILE_LAYERS: Record<
  Exclude<MapStyle, 'virtual'>,
  { label: string; url: string; attribution: string; className?: string; maxZoom?: number }
> = {
  topo: {
    label: 'Topo',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '© OpenTopoMap (CC-BY-SA)',
    maxZoom: 17,
  },
  osm: {
    label: 'Mapa',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap',
    maxZoom: 19,
  },
  dark: {
    label: 'Oscuro',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap · Estilo Oscuro',
    className: 'bilifit-dark-tiles',
    maxZoom: 19,
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
  const [mapReadyTick, setMapReadyTick] = useState(0);

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

  const virtualDisplayBounds = useMemo(
    () => (myWhooshMatch ? getWorldDisplayBounds(myWhooshMatch.world) : null),
    [myWhooshMatch]
  );

  const alignedTrace = useMemo(() => {
    if (!myWhooshMatch || coords.length < 2) return null;
    return alignCoordsToMyWhooshWorld(myWhooshMatch.world, coords);
  }, [myWhooshMatch, coords]);

  const matchedWorldId = myWhooshMatch?.world.id ?? null;
  const prevWorldIdRef = useRef<string | null>(matchedWorldId);
  const [layer, setLayer] = useState<MapStyle>(matchedWorldId ? 'virtual' : defaultLayer);
  const [fitScope, setFitScope] = useState<'world' | 'route'>('world');

  useEffect(() => {
    if (matchedWorldId && prevWorldIdRef.current !== matchedWorldId) {
      setLayer('virtual');
    } else if (!matchedWorldId && prevWorldIdRef.current !== null && layer === 'virtual') {
      setLayer(defaultLayer === 'virtual' ? 'topo' : defaultLayer);
    }
    prevWorldIdRef.current = matchedWorldId;
  }, [matchedWorldId, defaultLayer, layer]);

  // Coordenadas geográficas alineadas al mundo (para sincronía de hover con perfil de altitud/telemetría)
  const alignedWorldCoords = useMemo(() => {
    if (layer === 'virtual' && alignedTrace) {
      return alignedTrace.alignedCoords;
    }
    return coords;
  }, [layer, alignedTrace, coords]);

  // Coordenadas proyectadas al lienzo visual del mundo (incluye rotación conformal p. ej. 90° CW en France)
  const displayCoords = useMemo(() => {
    if (layer === 'virtual' && myWhooshMatch) {
      return toWorldDisplayCoords(myWhooshMatch.world, alignedWorldCoords);
    }
    return alignedWorldCoords;
  }, [layer, myWhooshMatch, alignedWorldCoords]);

  const canRenderMap = coords.length >= 2 || Boolean(myWhooshMatch);

  // Inicializar mapa Leaflet cuando exista contenedor y contenido, y avisar vía mapReadyTick
  useEffect(() => {
    if (!containerRef.current || !canRenderMap) return;
    let active = true;
    let observer: ResizeObserver | null = null;

    (async () => {
      const L = (await import('leaflet')).default;
      if (!active || !containerRef.current) return;
      leafletRef.current = L;

      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }

      const initBounds = virtualDisplayBounds ?? myWhooshMatch?.bounds;
      const initialCenter: [number, number] = initBounds
        ? [(initBounds[0][0] + initBounds[1][0]) / 2, (initBounds[0][1] + initBounds[1][1]) / 2]
        : coords[0] ?? [40, -3];

      const map = L.map(containerRef.current, {
        center: initialCenter,
        zoom: 12,
        zoomControl: true,
        attributionControl: true,
        zoomSnap: 0.25,
        zoomDelta: 0.5,
      });
      mapRef.current = map;
      routeLayerGroupRef.current = L.layerGroup().addTo(map);

      if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
        observer = new ResizeObserver(() => {
          if (mapRef.current) {
            mapRef.current.invalidateSize({ animate: false });
          }
        });
        observer.observe(containerRef.current);
      }

      setMapReadyTick((t) => t + 1);
      requestAnimationFrame(() => {
        if (active && mapRef.current) {
          mapRef.current.invalidateSize({ animate: false });
        }
      });
    })();

    return () => {
      active = false;
      observer?.disconnect();
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
  }, [canRenderMap]);

  // Actualizar capa base + traza + hitos + encuadre cuando el mapa esté listo o cambien capa, mundo o datos
  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    const routeGroup = routeLayerGroupRef.current;
    if (!map || !L || !routeGroup || mapReadyTick === 0) return;

    if (baseLayerRef.current) {
      map.removeLayer(baseLayerRef.current);
      baseLayerRef.current = null;
    }
    routeGroup.clearLayers();

    const isVirtual = layer === 'virtual' && Boolean(myWhooshMatch) && Boolean(virtualDisplayBounds);

    // Calcular y aplicar vista/encuadre ANTES de añadir ImageOverlay para evitar 'Set map center and zoom first'
    let routeLine: import('leaflet').Polyline | null = null;
    if (displayCoords.length >= 2) {
      if (isVirtual) {
        // Borde contraste estilo mywhooshinfo sobre el terreno 3D
        L.polyline(displayCoords, {
          color: '#3b0764',
          weight: 7.5,
          opacity: 0.65,
          lineJoin: 'round',
          lineCap: 'round',
        }).addTo(routeGroup);
      }

      routeLine = L.polyline(displayCoords, {
        color: isVirtual ? '#d946ef' : color,
        weight: isVirtual ? 4.4 : 4,
        opacity: 0.98,
        lineJoin: 'round',
        lineCap: 'round',
      }).addTo(routeGroup);

      L.circleMarker(displayCoords[0], {
        radius: 5.5,
        color: '#ffffff',
        weight: 2,
        fillColor: '#10b981',
        fillOpacity: 1,
      })
        .bindTooltip('Inicio')
        .addTo(routeGroup);

      L.circleMarker(displayCoords[displayCoords.length - 1], {
        radius: 5.5,
        color: '#ffffff',
        weight: 2,
        fillColor: '#ef4444',
        fillOpacity: 1,
      })
        .bindTooltip('Fin')
        .addTo(routeGroup);

      if (isVirtual && virtualDisplayBounds && fitScope === 'world') {
        map.fitBounds(virtualDisplayBounds, { padding: [8, 8], animate: false });
      } else {
        map.fitBounds(routeLine.getBounds(), { padding: [24, 24], animate: false });
      }
    } else if (isVirtual && virtualDisplayBounds) {
      map.fitBounds(virtualDisplayBounds, { padding: [8, 8], animate: false });
    }

    // Pines interactivos discretos para hitos clave del mundo (tooltip limpio al pasar el ratón)
    if (isVirtual && myWhooshMatch) {
      for (const lm of myWhooshMatch.world.landmarks) {
        const pt = toWorldDisplayCoord(myWhooshMatch.world, lm.lat, lm.lon);
        const label = lm.eleM ? `${lm.name} · ${lm.eleM} m` : lm.name;
        L.circleMarker(pt, {
          radius: 4,
          color: '#f8fafc',
          weight: 1.5,
          fillColor: '#0f172a',
          fillOpacity: 0.85,
        })
          .bindTooltip(label, { direction: 'top', offset: [0, -4] })
          .addTo(routeGroup);
      }
    }

    if (isVirtual && myWhooshMatch && virtualDisplayBounds) {
      if (containerRef.current) containerRef.current.style.background = myWhooshMatch.world.backgroundColor;
      const overlay = L.imageOverlay(myWhooshMatch.world.imageUrl, virtualDisplayBounds, {
        pane: 'tilePane',
        zIndex: 1,
        opacity: 1,
        attribution: `MyWhoosh · ${myWhooshMatch.world.name}`,
      }).addTo(map);
      overlay.once('load', () => {
        if (mapRef.current) {
          mapRef.current.invalidateSize({ animate: false });
        }
      });
      baseLayerRef.current = overlay;
    } else {
      if (containerRef.current) containerRef.current.style.background = '#0f172a';
      const fallbackStyle = defaultLayer === 'virtual' ? 'topo' : defaultLayer;
      const cfg = TILE_LAYERS[layer === 'virtual' ? fallbackStyle : layer];
      baseLayerRef.current = L.tileLayer(cfg.url, {
        attribution: cfg.attribution,
        maxZoom: cfg.maxZoom ?? 17,
        className: cfg.className ?? '',
      }).addTo(map);
    }

    map.invalidateSize({ animate: false });
  }, [mapReadyTick, layer, myWhooshMatch, virtualDisplayBounds, defaultLayer, displayCoords, color, fitScope]);

  // Resaltar segmento sobre el mapa si hay highlightPolyline
  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L || mapReadyTick === 0) return;

    if (highlightLayerRef.current) {
      map.removeLayer(highlightLayerRef.current);
      highlightLayerRef.current = null;
    }

    if (highlightPolyline) {
      let hCoords = decodePolyline(highlightPolyline);
      if (layer === 'virtual' && myWhooshMatch && hCoords.length >= 2) {
        const aligned = alignCoordsToMyWhooshWorld(myWhooshMatch.world, hCoords).alignedCoords;
        hCoords = toWorldDisplayCoords(myWhooshMatch.world, aligned);
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
  }, [mapReadyTick, highlightPolyline, layer, myWhooshMatch]);

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
    if (!map || !L || mapReadyTick === 0) return;

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
  }, [mapReadyTick, hoverPoint, layer, coords, displayCoords, coordIndexMap]);

  if (!canRenderMap) {
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
