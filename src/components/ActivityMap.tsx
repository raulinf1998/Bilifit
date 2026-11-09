'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import { Layers } from 'lucide-react';
import { decodePolyline } from '@/lib/polyline';
import type { ActivityPoint } from '@/types';

type MapStyle = 'topo' | 'osm' | 'dark';

const TILE_LAYERS: Record<MapStyle, { label: string; url: string; attribution: string }> = {
  topo: {
    label: 'Topográfico (Montaña)',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '© OpenTopoMap (CC-BY-SA)',
  },
  osm: {
    label: 'Callejero OSM',
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
  color = '#fc4c02',
  defaultLayer = 'topo',
  hoverPoint,
  heightClass = 'h-80',
}: {
  points?: ActivityPoint[];
  polyline?: string | null;
  color?: string;
  defaultLayer?: MapStyle;
  hoverPoint?: ActivityPoint | null;
  heightClass?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const tileRef = useRef<import('leaflet').TileLayer | null>(null);
  const hoverMarkerRef = useRef<import('leaflet').CircleMarker | null>(null);
  const leafletRef = useRef<typeof import('leaflet') | null>(null);

  const [layer, setLayer] = useState<MapStyle>(defaultLayer);

  const coords: Array<[number, number]> =
    points && points.some((p) => typeof p.lat === 'number' && typeof p.lon === 'number')
      ? points
          .filter((p): p is ActivityPoint & { lat: number; lon: number } => typeof p.lat === 'number' && typeof p.lon === 'number')
          .map((p) => [p.lat, p.lon])
      : polyline
        ? decodePolyline(polyline)
        : [];

  useEffect(() => {
    if (!containerRef.current || coords.length < 2) return;
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
      });
      mapRef.current = map;

      const cfg = TILE_LAYERS[layer];
      tileRef.current = L.tileLayer(cfg.url, {
        attribution: cfg.attribution,
        maxZoom: 17,
      }).addTo(map);

      const line = L.polyline(coords, {
        color,
        weight: 4,
        opacity: 0.92,
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

      map.fitBounds(line.getBounds(), { padding: [24, 24] });
    })();

    return () => {
      active = false;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords.length, polyline, color]);

  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;
    if (tileRef.current) {
      map.removeLayer(tileRef.current);
    }
    const cfg = TILE_LAYERS[layer];
    tileRef.current = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: 17,
    }).addTo(map);
  }, [layer]);

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

  if (coords.length < 2) {
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
      <div className="absolute top-3 right-3 z-[400] flex items-center gap-1 rounded-lg bg-slate-900/85 backdrop-blur px-1.5 py-1 border border-slate-700/70">
        <Layers className="h-3.5 w-3.5 text-slate-300 ml-1" />
        {(Object.keys(TILE_LAYERS) as MapStyle[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setLayer(key)}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
              layer === key ? 'bg-[#fc4c02] text-white' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            {key === 'topo' ? 'Topo' : key === 'osm' ? 'Mapa' : 'Oscuro'}
          </button>
        ))}
      </div>
    </div>
  );
}
