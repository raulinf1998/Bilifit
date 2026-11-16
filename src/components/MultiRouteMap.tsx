'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
import { Layers } from 'lucide-react';
import { TILE_LAYERS } from '@/lib/map-tile-layers';
import type { MapStyle } from '@/lib/metrics';
import { sportColor } from '@/lib/metrics';
import { decodePolyline } from '@/lib/polyline';
import type { Activity, MountainRoute } from '@/types';

export default function MultiRouteMap({
  activities,
  routes,
  heightClass = 'h-96',
}: {
  activities: Activity[];
  routes: MountainRoute[];
  heightClass?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const baseRef = useRef<import('leaflet').TileLayer | null>(null);
  const [layer, setLayer] = useState<Exclude<MapStyle, 'virtual'>>('topo');
  const [mapVersion, setMapVersion] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    let active = true;

    (async () => {
      const L = (await import('leaflet')).default;
      if (!active || !containerRef.current) return;

      if (mapRef.current) {
        mapRef.current.remove();
      }

      const map = L.map(containerRef.current, { zoomControl: true, attributionControl: false });
      mapRef.current = map;

      setMapVersion((v) => v + 1);

      const allBounds: Array<[number, number]> = [];

      for (const act of activities) {
        if (!act.polyline) continue;
        const coords = decodePolyline(act.polyline);
        if (coords.length < 2) continue;
        allBounds.push(...coords);
        L.polyline(coords, {
          color: sportColor(act.sport),
          weight: 3,
          opacity: 0.72,
        })
          .bindTooltip(`${act.title} (${(act.distanceMeters / 1000).toFixed(1)} km · +${act.elevationGain}m)`)
          .addTo(map);
      }

      for (const route of routes) {
        const coords =
          route.points && route.points.length > 1
            ? route.points
                .filter((p) => typeof p.lat === 'number' && typeof p.lon === 'number')
                .map((p): [number, number] => [p.lat!, p.lon!])
            : route.polyline
              ? decodePolyline(route.polyline)
              : [];

        if (coords.length < 2) continue;
        allBounds.push(...coords);
        L.polyline(coords, {
          color: route.status === 'pending' ? '#f59e0b' : '#10b981',
          weight: 3.5,
          dashArray: route.status === 'pending' ? '6 6' : undefined,
          opacity: 0.95,
        })
          .bindTooltip(`Ruta: ${route.name} (+${route.elevationGain}m)`)
          .addTo(map);
      }

      if (allBounds.length > 0) {
        map.fitBounds(allBounds, { padding: [30, 30] });
      } else {
        map.setView([43.36, -5.85], 10);
      }
    })();

    return () => {
      active = false;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        baseRef.current = null;
      }
    };
  }, [activities, routes]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let active = true;
    void import('leaflet').then(({ default: L }) => {
      if (!active || mapRef.current !== map) return;
      if (baseRef.current) map.removeLayer(baseRef.current);
      const cfg = TILE_LAYERS[layer];
      baseRef.current = L.tileLayer(cfg.url, { maxZoom: cfg.maxZoom ?? 19, className: cfg.className }).addTo(map);
      baseRef.current.bringToBack();
    });
    return () => { active = false; };
  }, [layer, mapVersion]);

  return (
    <div className={`relative rounded-xl overflow-hidden border ${layer === 'dark' ? 'bilifit-map-dark' : ''}`} style={{ borderColor: 'var(--border-subtle)' }}>
      <div ref={containerRef} className={`${heightClass} w-full`} />
      <div className="absolute top-3 right-3 z-[400] flex flex-wrap items-center gap-1 rounded-lg bg-slate-900/85 px-1.5 py-1 border border-slate-700/70" aria-label="Tipo de mapa">
        <Layers className="h-3.5 w-3.5 text-slate-300 ml-1" />
        {(Object.keys(TILE_LAYERS) as Array<Exclude<MapStyle, 'virtual'>>).map((key) => (
          <button key={key} type="button" aria-pressed={layer === key} onClick={() => setLayer(key)} className={`px-2 py-0.5 rounded text-[11px] font-medium ${layer === key ? 'bg-primary text-onprimary' : 'text-slate-300 hover:bg-slate-800'}`}>
            {TILE_LAYERS[key].label}
          </button>
        ))}
      </div>
    </div>
  );
}
