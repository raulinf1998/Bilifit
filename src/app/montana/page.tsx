'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Compass, Mountain } from 'lucide-react';
import MultiRouteMap from '@/components/MultiRouteMap';
import { SportBadge } from '@/components/SportBadge';
import SportRecords from '@/components/SportRecords';
import type { RunningRecords } from '@/lib/running-records';
import { formatDistanceKm, formatDurationClock, getEffectiveDurationSec } from '@/lib/metrics';
import type { Activity, MountainRoute } from '@/types';

export default function MountainRoutesPage() {
  const [routes, setRoutes] = useState<MountainRoute[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [records, setRecords] = useState<RunningRecords | null>(null);
  const [recordsError, setRecordsError] = useState(false);


  const loadRecords = useCallback(async () => {
    try {
      const res = await fetch('/api/sport-records?type=mountain', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      setRecords((await res.json()).records);
      setRecordsError(false);
    } catch { setRecordsError(true); }
  }, []);

  const load = useCallback(async () => {
    void loadRecords();
    const [rtRes, mtnActRes, trailActRes, runActRes] = await Promise.all([
      fetch('/api/routes').then((r) => r.json()),
      fetch('/api/activities?sport=mountain').then((r) => r.json()),
      fetch('/api/activities?sport=trail').then((r) => r.json()),
      fetch('/api/activities?sport=running').then((r) => r.json()),
    ]);
    setRoutes(rtRes.routes ?? []);
    setActivities([...(mtnActRes.activities ?? []), ...(trailActRes.activities ?? []), ...(runActRes.activities ?? [])]);
  }, [loadRecords]);

  useEffect(() => {
    load();
    const onReload = () => load();
    window.addEventListener('bilifit:activities-reloaded', onReload);
    return () => window.removeEventListener('bilifit:activities-reloaded', onReload);
  }, [load]);

  const mtnOnly = activities.filter((a) => a.sport === 'mountain' || a.sport === 'trail');
  const totalMtnClimb = Math.round(mtnOnly.reduce((s, a) => s + a.elevationGain, 0));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
            <Mountain className="h-6 w-6 text-emerald-400" />
            Rutas de Montaña y Trail
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Explora tus recorridos de montaña y trail en el mapa y consulta tus salidas registradas.
          </p>
        </div>

      </div>

      {/* Mapa Global */}
      <div className="card-surface p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold flex items-center gap-2">
              <Compass className="h-4 w-4 text-emerald-400" />
              Mapa de recorridos y rutas
            </h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Verde: salidas montaña · Naranja: running · Discontinuo ámbar: rutas pendientes · Desnivel total montaña: +{totalMtnClimb} m
            </p>
          </div>
        </div>
        <MultiRouteMap activities={activities} routes={routes} defaultLayer="osm" heightClass="h-96" />
      </div>

      {recordsError && <p role="alert" className="text-sm text-rose-500">No se pudieron cargar las marcas. <button type="button" className="underline" onClick={() => void loadRecords()}>Reintentar</button></p>}
      {records && <SportRecords records={records} kind="mountain" />}

      {/* Últimas salidas de montaña */}
      <div className="card-surface p-5 space-y-3">
        <h2 className="text-base font-bold">Salidas de Montaña Registradas ({mtnOnly.length})</h2>
        <div className="space-y-2.5">
          {mtnOnly.map((act) => (
            <Link
              key={act.id}
              href={`/actividades/${act.id}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3.5 hover:border-emerald-400/50 transition-colors"
              style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <SportBadge sport={act.sport} subSport={act.subSport} />
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {new Date(act.startedAt).toLocaleDateString('es-ES')}
                  </span>
                </div>
                <div className="font-semibold text-sm">{act.title}</div>
              </div>
              <div className="flex items-center gap-5 text-xs tabular-nums">
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Dist: </span>
                  <strong>{formatDistanceKm(act.distanceMeters)}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>D+: </span>
                  <strong className="text-emerald-400">+{act.elevationGain} m</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Tiempo: </span>
                  <strong>{formatDurationClock(getEffectiveDurationSec(act))}</strong>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
