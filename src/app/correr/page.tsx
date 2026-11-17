'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Award, Footprints, Timer, MapPin } from 'lucide-react';
import { SportBadge } from '@/components/SportBadge';
import { formatDistanceKm, formatDurationClock, getEffectiveDistanceMeters, getEffectiveDurationSec } from '@/lib/metrics';
import type { RunningRecord, RunningRecords } from '@/lib/running-records';
import type { Activity } from '@/types';

function RecordCard({ label, record, distance = false }: { label: string; record: RunningRecord | null; distance?: boolean }) {
  return (
    <div className="card-surface p-4 sm:p-5 space-y-3 min-w-0">
      <div className="flex items-center justify-between gap-2 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}><span>{label}</span><Award className="h-4 w-4 text-primary shrink-0" /></div>
      <div className="text-2xl sm:text-3xl font-bold tabular-nums">{record ? (distance ? formatDistanceKm(record.value) : formatDurationClock(record.value)) : '—'}</div>
      {record ? <Link className="block text-xs text-primary hover:underline break-words" href={`/actividades/${record.activityId}`}>{record.title} · {new Date(record.startedAt).toLocaleDateString('es-ES')}</Link> : <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Sin datos suficientes</p>}
    </div>
  );
}

export default function RunningPage() {
  const [data, setData] = useState<{ activities: Activity[]; records: RunningRecords } | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/running', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      setData(await res.json()); setError(false);
    } catch { setError(true); }
  }, []);
  useEffect(() => {
    void load();
    const onReload = () => void load();
    window.addEventListener('bilifit:activities-reloaded', onReload);
    return () => window.removeEventListener('bilifit:activities-reloaded', onReload);
  }, [load]);
  return (
    <div className="space-y-6">
      <header><h1 className="text-2xl font-bold flex items-center gap-2.5"><Footprints className="h-6 w-6 text-primary" /> Correr</h1><p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>Tus mejores marcas y tus carreras registradas, en un solo lugar.</p></header>
      {error && <p role="alert" className="text-sm text-rose-500">No se pudieron cargar las carreras. <button onClick={() => void load()} className="underline">Reintentar</button></p>}
      {!data && !error && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Cargando carreras…</p>}
      {data && <>
        <section className="space-y-3"><h2 className="text-lg font-bold flex items-center gap-2"><Award className="h-5 w-5 text-primary" /> Mejores marcas</h2>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            <RecordCard label="1 km más rápido" record={data.records.fastest['1 km']} />
            <RecordCard label="5 km más rápidos" record={data.records.fastest['5 km']} />
            <RecordCard label="10 km más rápidos" record={data.records.fastest['10 km']} />
            <RecordCard label="Distancia más larga" record={data.records.longestDistance} distance />
            <RecordCard label="Tiempo seguido corriendo" record={data.records.longestContinuous} />
          </div>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>Sólo actividades de correr, no trail. Las marcas por distancia se estiman a partir del recorrido y cuentan las pausas registradas; los huecos de más de dos minutos dividen el recorrido. El tiempo seguido es una estimación basada en movimiento: las pausas y huecos de datos interrumpen el tramo; si el reloj oculta pausas automáticas puede no detectarlas. Las carreras con descansos manuales no generan marcas de distancia rápida ni tiempo seguido. Sin datos suficientes se muestra —.</p>
        </section>
        <section className="card-surface p-5 space-y-4"><h2 className="text-base font-bold flex items-center gap-2"><Footprints className="h-4 w-4 text-primary" /> Carreras ({data.activities.length})</h2>
          {data.activities.length === 0 ? <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Aún no hay carreras registradas.</p> : <div className="space-y-2">{data.activities.map((act) => <Link key={act.id} href={`/actividades/${act.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3.5 hover:border-primary/50" style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}>
            <div className="space-y-1"><div className="flex flex-wrap items-center gap-2"><SportBadge sport={act.sport} subSport={act.subSport} /><span className="text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(act.startedAt).toLocaleDateString('es-ES')}</span></div><div className="font-semibold text-sm">{act.title}</div></div>
            <div className="flex flex-wrap gap-4 text-xs tabular-nums"><span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {formatDistanceKm(getEffectiveDistanceMeters(act))}</span><span className="flex items-center gap-1"><Timer className="h-3.5 w-3.5" /> {formatDurationClock(getEffectiveDurationSec(act))}</span></div>
          </Link>)}</div>}
        </section>
      </>}
    </div>
  );
}
