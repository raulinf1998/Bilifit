'use client';

import Link from 'next/link';
import { Award } from 'lucide-react';
import { formatDistanceKm, formatDurationClock } from '@/lib/metrics';
import type { RunningRecord, RunningRecords } from '@/lib/running-records';

function Card({ label, record, unit = 'time' }: { label: string; record: RunningRecord | null; unit?: 'time' | 'distance' | 'elevation' }) {
  return <div className="card-surface p-4 sm:p-5 space-y-3 min-w-0">
    <div className="flex items-center justify-between gap-2 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}><span>{label}</span><Award className="h-4 w-4 text-primary shrink-0" /></div>
    <div className="text-2xl sm:text-3xl font-bold tabular-nums">{record ? unit === 'distance' ? formatDistanceKm(record.value) : unit === 'elevation' ? `+${record.value.toLocaleString('es-ES')} m` : formatDurationClock(record.value) : '—'}</div>
    {record ? <Link className="block text-xs text-primary hover:underline break-words" href={`/actividades/${record.activityId}`}>{record.title} · {new Date(record.startedAt).toLocaleDateString('es-ES')}</Link> : <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Sin datos suficientes</p>}
  </div>;
}

export default function SportRecords({ records, kind }: { records: RunningRecords; kind: 'cycling' | 'mountain' }) {
  return <section className="space-y-3" aria-label="Mejores marcas">
    <h2 className="text-lg font-bold flex items-center gap-2"><Award className="h-5 w-5 text-primary" /> Mejores marcas</h2>
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
      <Card label="Distancia más larga" record={records.longestDistance} unit="distance" />
      <Card label="Tiempo seguido en movimiento" record={records.longestContinuous} />
      {kind === 'mountain' && <Card label="Mayor desnivel positivo" record={records.greatestElevationGain} unit="elevation" />}
    </div>
    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
      {kind === 'cycling' ? 'Incluye MyWhoosh y ciclismo exterior.' : 'Incluye senderismo y trail.'} El tiempo seguido es una estimación basada en movimiento: las pausas y huecos interrumpen el tramo y las pausas ocultadas por el dispositivo pueden no detectarse.
    </p>
  </section>;
}
