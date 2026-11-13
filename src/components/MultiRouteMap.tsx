'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
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

      L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 17,
      }).addTo(map);

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
      }
    };
  }, [activities, routes]);

  return (
    <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border-subtle)' }}>
      <div ref={containerRef} className={`${heightClass} w-full`} />
    </div>
  );
}
