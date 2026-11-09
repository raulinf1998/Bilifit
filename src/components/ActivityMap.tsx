'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Globe, Layers } from 'lucide-react';
import { resolveMyWhooshWorldForActivity } from '@/lib/mywhoosh-maps';
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
  worldName?: string | null;
  title?: string | null;
  color?: string;
  defaultLayer?: Exclude<MapStyle, 'virtual'>;
  hoverPoint?: ActivityPoint | null;
  highlightPolyline?: string | null;
  heightClass?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const baseLayerRef = useRef<import('leaflet').Layer | null>(null);
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
    if (sport !== 'mywhoosh' && !worldName) return null;
    return resolveMyWhooshWorldForActivity({ worldName, title, coords });
  }, [sport, worldName, title, coords]);

  const [layer, setLayer] = useState<MapStyle>(myWhooshMatch ? 'virtual' : defaultLayer);

  useEffect(() => {
    if (myWhooshMatch) {
      setLayer('virtual');
    }
  }, [myWhooshMatch]);

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
        zoomSnap: 0.5,
        zoomDelta: 0.5,
      });
      mapRef.current = map;

      if (layer === 'virtual' && myWhooshMatch) {
        containerRef.current.style.background = myWhooshMatch.world.backgroundColor;
        baseLayerRef.current = L.imageOverlay(myWhooshMatch.world.imageUrl, myWhooshMatch.bounds, {
          attribution: `MyWhoosh · ${myWhooshMatch.world.name}`,
        }).addTo(map);
      } else {
        containerRef.current.style.background = '#0f172a';
        const cfg = TILE_LAYERS[layer === 'virtual' ? defaultLayer : layer];
        baseLayerRef.current = L.tileLayer(cfg.url, {
          attribution: cfg.attribution,
          maxZoom: 17,
        }).addTo(map);
      }

      if (coords.length >= 2) {
        const line = L.polyline(coords, {
          color: layer === 'virtual' ? '#fc4c02' : color,
          weight: layer === 'virtual' ? 4.5 : 4,
          opacity: 0.95,
          lineJoin: 'round',
        }).addTo(map);

        L.circleMarker(coords[0], {
          radius: 6,
          color: '#ffffff',
          weight: 2,
          fillColor: '#10b981',
          fillOpacity: 1,
        })
          .bindTooltip('Inicio')
          .addTo(map);

        L.circleMarker(coords[coords.length - 1], {
          radius: 6,
          color: '#ffffff',
          weight: 2,
          fillColor: '#ef4444',
          fillOpacity: 1,
        })
          .bindTooltip('Fin')
          .addTo(map);

        if (layer === 'virtual' && myWhooshMatch) {
          map.fitBounds(myWhooshMatch.bounds, { padding: [12, 12] });
        } else {
          map.fitBounds(line.getBounds(), { padding: [24, 24] });
        }
      } else if (myWhooshMatch) {
        map.fitBounds(myWhooshMatch.bounds, { padding: [12, 12] });
      }
    })();

    return () => {
      active = false;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords.length, polyline, color, myWhooshMatch?.world.id]);

  // Cambiar capa entre Mundo Virtual MyWhoosh / Topo / OSM / Oscuro sin recrear mapa
  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;

    if (baseLayerRef.current) {
      map.removeLayer(baseLayerRef.current);
      baseLayerRef.current = null;
    }

    if (layer === 'virtual' && myWhooshMatch) {
      if (containerRef.current) containerRef.current.style.background = myWhooshMatch.world.backgroundColor;
      const overlay = L.imageOverlay(myWhooshMatch.world.imageUrl, myWhooshMatch.bounds, {
        attribution: `MyWhoosh · ${myWhooshMatch.world.name}`,
      }).addTo(map);
      overlay.bringToBack();
      baseLayerRef.current = overlay;
      map.fitBounds(myWhooshMatch.bounds, { padding: [12, 12] });
    } else {
      if (containerRef.current) containerRef.current.style.background = '#0f172a';
      const cfg = TILE_LAYERS[layer === 'virtual' ? defaultLayer : layer];
      baseLayerRef.current = L.tileLayer(cfg.url, {
        attribution: cfg.attribution,
        maxZoom: 17,
      }).addTo(map);
      if (coords.length >= 2) {
        map.fitBounds(L.latLngBounds(coords), { padding: [24, 24] });
      }
    }
  }, [layer, myWhooshMatch, defaultLayer, coords]);

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
      const hCoords = decodePolyline(highlightPolyline);
      if (hCoords.length >= 2) {
        highlightLayerRef.current = L.polyline(hCoords, {
          color: '#facc15',
          weight: 7,
          opacity: 0.95,
        }).addTo(map);
        map.fitBounds(highlightLayerRef.current.getBounds(), { padding: [36, 36] });
      }
    }
  }, [highlightPolyline]);

  // Marcador interactivo al pasar el ratón por las gráficas
  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;

    if (hoverPoint && typeof hoverPoint.lat === 'number' && typeof hoverPoint.lon === 'number') {
      if (!hoverMarkerRef.current) {
        hoverMarkerRef.current = L.circleMarker([hoverPoint.lat, hoverPoint.lon], {
          radius: 7,
          color: '#ffffff',
          weight: 2,
          fillColor: '#06b6d4',
          fillOpacity: 1,
        }).addTo(map);
      } else {
        hoverMarkerRef.current.setLatLng([hoverPoint.lat, hoverPoint.lon]);
      }
    } else if (hoverMarkerRef.current) {
      map.removeLayer(hoverMarkerRef.current);
      hoverMarkerRef.current = null;
    }
  }, [hoverPoint]);

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
      <div className="absolute top-3 right-3 z-[400] flex flex-wrap items-center gap-1 rounded-lg bg-slate-900/85 backdrop-blur px-1.5 py-1 border border-slate-700/70">
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
      </div>
    </div>
  );
}
