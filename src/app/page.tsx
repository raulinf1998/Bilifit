'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Activity as ActivityIcon, ArrowRight, CalendarDays, Clock3, Mountain, Route, Target } from 'lucide-react';
import { WeeklyVolumeChart, type WeeklyBucket } from '@/components/Charts';
import { SportBadge } from '@/components/SportBadge';
import { TogetherBadge } from '@/components/TogetherControl';
import { formatDistanceKm, formatDuration, getEffectiveDurationSec } from '@/lib/metrics';
import type { Activity, AthleteProfile } from '@/types';

type DashboardPayload = {
  profile: AthleteProfile;
  summary: { weekSessions: number; weekDistanceKm: number; weekDurationHours: number; weekElevationM: number };
  weeklyBuckets: WeeklyBucket[];
  recentActivities: Activity[];
};

const SPORTS = [
  { key: 'runningHours', label: 'Correr', color: 'bg-primary' },
  { key: 'trailHours', label: 'Trail', color: 'bg-lime-400' },
  { key: 'mountainHours', label: 'Senderismo', color: 'bg-emerald-400' },
  { key: 'walkingHours', label: 'Caminar', color: 'bg-amber-400' },
  { key: 'cyclingHours', label: 'Bici exterior', color: 'bg-blue-400' },
  { key: 'mywhooshHours', label: 'MyWhoosh', color: 'bg-cyan-400' },
  { key: 'strengthHours', label: 'Fuerza', color: 'bg-purple-400' },
] as const;

export default function DashboardPage() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const loadDashboard = useCallback(async () => {
    try {
      const response = await fetch('/api/dashboard', { cache: 'no-store' });
      if (!response.ok) throw new Error('Error');
      setData(await response.json());
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
    const onReload = () => void loadDashboard();
    window.addEventListener('bilifit:activities-reloaded', onReload);
    return () => window.removeEventListener('bilifit:activities-reloaded', onReload);
  }, [loadDashboard]);

  if (loading) return <div className="space-y-5 animate-pulse"><div className="h-12 w-56 rounded-xl bg-sunken" /><div className="h-64 rounded-3xl bg-sunken" /><div className="h-80 rounded-3xl bg-sunken" /></div>;
  if (!data) return <div className="card-surface p-6"><p role="alert">No se ha podido cargar el panel.</p><button onClick={() => void loadDashboard()} className="mt-3 text-primary font-semibold">Volver a intentar</button></div>;

  const { profile, summary, weeklyBuckets, recentActivities } = data;
  const goal = profile.weeklyTargetHours;
  const targetPct = goal > 0 ? Math.min(100, Math.round(summary.weekDurationHours / goal * 100)) : 0;
  const week = weeklyBuckets[weeklyBuckets.length - 1];
  const sports = week ? SPORTS.map((sport) => ({ ...sport, hours: week[sport.key] ?? 0 })).filter((sport) => sport.hours > 0).sort((a, b) => b.hours - a.hours) : [];
  const sportTotal = sports.reduce((sum, sport) => sum + sport.hours, 0);

  return (
    <div className="mx-auto max-w-6xl space-y-6 sm:space-y-8 pb-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Tu actividad, de un vistazo</p>
          <h1 className="mt-2 text-3xl sm:text-4xl font-bold tracking-tight">Hola, {profile.name}</h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>Cada movimiento cuenta. Así van tus últimos 7 días.</p>
        </div>
        <Link href="/actividades" className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">Tu historial <ArrowRight className="h-4 w-4" /></Link>
      </header>
      {error && <p role="alert" className="text-sm text-amber-500">No se han podido actualizar los datos; se muestran los anteriores.</p>}

      <section aria-labelledby="week-title" className="card-surface overflow-hidden">
        <div className="p-5 sm:p-7 grid gap-7 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary"><span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10"><Clock3 className="h-4 w-4" /></span> Últimos 7 días</div>
            <h2 id="week-title" className="mt-5 text-lg font-semibold">Horas esta semana</h2>
            <p className="mt-1 tabular-nums"><span className="text-5xl sm:text-6xl font-bold tracking-tight">{summary.weekDurationHours}</span><span className="ml-2 text-xl font-semibold" style={{ color: 'var(--text-secondary)' }}>h</span></p>
            <p className="mt-3 text-sm" style={{ color: 'var(--text-secondary)' }}>{goal > 0 ? `Objetivo: ${goal} h · ${targetPct}% completado` : 'Define tu objetivo semanal en tu perfil.'}</p>
            <div className="mt-4 h-2 max-w-md overflow-hidden rounded-full" style={{ background: 'var(--bg-muted)' }} role="progressbar" aria-label="Progreso del objetivo de horas" aria-valuemin={0} aria-valuemax={100} aria-valuenow={targetPct}><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${targetPct}%` }} /></div>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:gap-3 md:w-[370px]">
            {[
              { icon: CalendarDays, value: summary.weekSessions, label: 'sesiones', color: 'text-purple-400' },
              { icon: Route, value: summary.weekDistanceKm, label: 'km', color: 'text-cyan-400' },
              { icon: Mountain, value: `+${summary.weekElevationM}`, label: 'm desnivel', color: 'text-emerald-400' },
            ].map(({ icon: Icon, value, label, color }) => (
              <div key={label} className="rounded-2xl p-3 sm:p-4" style={{ background: 'var(--bg-card-elevated)' }}>
                <Icon className={`h-4 w-4 ${color}`} />
                <div className="mt-3 text-xl sm:text-2xl font-bold tabular-nums">{value}</div>
                <div className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <section className="card-surface p-5 sm:p-6 lg:col-span-2" aria-labelledby="chart-title">
          <div className="mb-6"><p className="text-xs font-bold uppercase tracking-widest text-primary">Tu evolución</p><h2 id="chart-title" className="mt-2 text-xl font-bold">Horas semanales por deporte</h2><p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>Últimos 8 periodos de 7 días</p></div>
          <WeeklyVolumeChart buckets={weeklyBuckets} />
        </section>
        <section className="card-surface p-5 sm:p-6" aria-labelledby="mix-title">
          <div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-widest text-primary">Tu mezcla</p><h2 id="mix-title" className="mt-2 text-xl font-bold">Deportes de la semana</h2></div><Target className="h-5 w-5 text-primary" /></div>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>Tiempo por deporte en los últimos 7 días</p>
          {sportTotal > 0 ? <div className="mt-6 space-y-4">
            <div className="flex h-3 overflow-hidden rounded-full" aria-hidden="true">{sports.map((sport) => <div key={sport.key} className={sport.color} style={{ width: `${sport.hours / sportTotal * 100}%` }} />)}</div>
            {sports.map((sport) => <div key={sport.key} className="flex items-center gap-2 text-sm"><span className={`h-2.5 w-2.5 rounded-full ${sport.color}`} /><span className="flex-1">{sport.label}</span><span className="font-semibold tabular-nums">{sport.hours.toFixed(1)} h</span></div>)}
          </div> : <p className="mt-6 rounded-xl p-4 text-sm" style={{ background: 'var(--bg-card-elevated)', color: 'var(--text-secondary)' }}>Aún no hay actividades en los últimos 7 días. Tu reparto por deporte aparecerá aquí.</p>}
        </section>
      </div>

      <section className="card-surface p-5 sm:p-6" aria-labelledby="recent-title">
        <div className="flex items-center justify-between gap-4 mb-5"><div><p className="text-xs font-bold uppercase tracking-widest text-primary">Tu historial</p><h2 id="recent-title" className="mt-2 text-xl font-bold flex items-center gap-2"><ActivityIcon className="h-5 w-5 text-primary" /> Últimas actividades</h2></div><Link href="/actividades" className="text-sm font-semibold text-primary hover:underline whitespace-nowrap">Ver todas →</Link></div>
        {recentActivities.length === 0 ? <div className="rounded-xl p-6 text-sm" style={{ background: 'var(--bg-card-elevated)', color: 'var(--text-secondary)' }}>Todavía no tienes actividades. <Link href="/strava" className="font-semibold text-primary underline">Importa una actividad</Link> para empezar.</div> : <div className="space-y-2">{recentActivities.map((act) => (
          <Link key={act.id} href={`/actividades/${act.id}`} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border p-4 hover:border-primary/50 transition-colors" style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}>
            <div className="min-w-0 space-y-2"><div className="flex flex-wrap items-center gap-2"><SportBadge sport={act.sport} subSport={act.subSport} />{act.doneTogether && <TogetherBadge />}<span className="text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(act.startedAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}</span></div><div className="font-semibold text-sm">{act.title}</div></div>
            <div className="flex items-center gap-5 text-sm tabular-nums"><div><div className="text-xs" style={{ color: 'var(--text-muted)' }}>Tiempo</div><div className="font-bold">{formatDuration(getEffectiveDurationSec(act))}</div></div>{act.distanceMeters > 0 && <div><div className="text-xs" style={{ color: 'var(--text-muted)' }}>Distancia</div><div className="font-bold">{formatDistanceKm(act.distanceMeters)}</div></div>}{act.elevationGain > 0 && <div><div className="text-xs" style={{ color: 'var(--text-muted)' }}>Desnivel</div><div className="font-bold">+{act.elevationGain} m</div></div>}<ArrowRight className="h-4 w-4 shrink-0 text-primary" /></div>
          </Link>
        ))}</div>}
      </section>
    </div>
  );
}
