'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  Activity as ActivityIcon,
  ArrowRight,
  CheckCircle2,
  Dumbbell,
  Flame,
  HeartPulse,
  Mountain,
  RefreshCw,
  TrendingUp,
  Upload,
  Zap,
} from 'lucide-react';
import { FitnessPMCChart, WeeklyVolumeChart, type WeeklyBucket } from '@/components/Charts';
import { SportBadge } from '@/components/SportBadge';
import { TogetherBadge } from '@/components/TogetherControl';
import {
  formatDistanceKm,
  formatDuration,
  formatPaceMinKm,
  getEffectiveAvgSpeedMs,
  getEffectiveDurationSec,
} from '@/lib/metrics';
import type {
  Activity,
  AthleteProfile,
  FitnessDayPoint,
  GearItem,
  HuaweiConnectionStatus,
  MyWhooshConnectionStatus,
  StravaConnectionStatus,
} from '@/types';

interface DashboardPayload {
  profile: AthleteProfile;
  summary: {
    totalActivities: number;
    weekSessions: number;
    weekDistanceKm: number;
    weekDurationHours: number;
    weekElevationM: number;
    weekTss: number;
    fitnessCtl: number;
    fatigueAtl: number;
    formTsb: number;
    monthBySport: Record<string, number>;
  };
  pmc: FitnessDayPoint[];
  weeklyBuckets: WeeklyBucket[];
  recentActivities: Activity[];
  gear: GearItem[];
  ownedEquipmentCount: number;
  routinesCount: number;
  pendingRoutesCount: number;
  strava: StravaConnectionStatus;
  mywhoosh?: MyWhooshConnectionStatus;
  huawei?: HuaweiConnectionStatus;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/dashboard')
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, []);

  if (loading || !data) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-10 w-64 rounded-xl bg-sunken" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 rounded-2xl bg-sunken" />
          ))}
        </div>
        <div className="h-72 rounded-2xl bg-sunken" />
      </div>
    );
  }

  const { profile, summary, pmc, weeklyBuckets, recentActivities, gear, strava, mywhoosh, huawei } = data;
  const targetPct = Math.min(100, Math.round((summary.weekDurationHours / Math.max(1, profile.weeklyTargetHours)) * 100));
  const wKg = profile.weightKg > 0 ? (profile.ftpWatts / profile.weightKg).toFixed(2) : '0.00';

  const formStatus =
    summary.formTsb >= 5
      ? { label: 'Fresco / Listo para rendir', color: 'text-emerald-700 dark:text-emerald-400' }
      : summary.formTsb >= -15
        ? { label: 'Zona óptima de carga', color: 'text-cyan-700 dark:text-cyan-400' }
        : { label: 'Fatiga alta · Recupera', color: 'text-amber-700 dark:text-amber-400' };

  return (
    <div className="space-y-6">
      {/* Cabecera */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Hola, {profile.name}</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Tu centro multideporte: correr, MyWhoosh ({profile.ftpWatts} W · {wKg} W/kg), montaña y fuerza en casa.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/casa"
            className="inline-flex items-center gap-2 rounded-xl bg-purple-600 hover:bg-purple-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors"
          >
            <Dumbbell className="h-4 w-4" />
            Rutina en Casa
          </Link>
          <Link
            href="/strava"
            className="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold hover:bg-sunken transition-colors"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <Upload className="h-4 w-4 text-primary" />
            {mywhoosh?.connected || huawei?.googleConnected
              ? 'MyWhoosh / Huawei'
              : strava.connected
                ? 'Sincronizar / Importar'
                : 'Conectar / Importar'}
          </Link>
        </div>
      </div>

      {/* KPIs Principales */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="card-surface p-5 space-y-2">
          <div className="flex items-center justify-between text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            <span>ESTA SEMANA (7 DÍAS)</span>
            <Flame className="h-4 w-4 text-primary" />
          </div>
          <div className="text-2xl font-bold tabular-nums">
            {summary.weekDurationHours} h{' '}
            <span className="text-sm font-normal" style={{ color: 'var(--text-muted)' }}>
              / {profile.weeklyTargetHours} h
            </span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-muted)' }}>
            <div className="h-full bg-primary rounded-full" style={{ width: `${targetPct}%` }} />
          </div>
          <div className="text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>
            {summary.weekDistanceKm} km · +{summary.weekElevationM} m · {summary.weekSessions} sesiones
          </div>
        </div>

        <div className="card-surface p-5 space-y-2">
          <div className="flex items-center justify-between text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            <span>FORMA FÍSICA (CTL)</span>
            <TrendingUp className="h-4 w-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-bold tabular-nums text-cyan-400">{summary.fitnessCtl}</div>
          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Fatiga (ATL): <strong className="text-amber-400 tabular-nums">{summary.fatigueAtl}</strong> · Carga 7d:{' '}
            <strong className="tabular-nums">{summary.weekTss} TSS</strong>
          </div>
        </div>

        <div className="card-surface p-5 space-y-2">
          <div className="flex items-center justify-between text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            <span>FRESCURA (TSB)</span>
            <HeartPulse className="h-4 w-4 text-emerald-400" />
          </div>
          <div className={`text-2xl font-bold tabular-nums ${summary.formTsb >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
            {summary.formTsb > 0 ? `+${summary.formTsb}` : summary.formTsb}
          </div>
          <div className={`text-xs font-medium ${formStatus.color}`}>{formStatus.label}</div>
        </div>

        <div className="card-surface p-5 space-y-2">
          <div className="flex items-center justify-between text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            <span>TU ECOSISTEMA</span>
            <CheckCircle2 className="h-4 w-4 text-purple-400" />
          </div>
          <div className="text-2xl font-bold tabular-nums">{summary.totalActivities} actividades</div>
          <div className="text-xs space-x-2" style={{ color: 'var(--text-secondary)' }}>
            <span>{data.ownedEquipmentCount} materiales en casa</span>
            <span>·</span>
            <span>{data.pendingRoutesCount} rutas pendientes</span>
          </div>
        </div>
      </div>

      {/* Gráficas: PMC + Volumen Semanal */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 card-surface p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-base font-bold">Carga, Fitness y Fatiga (90 días)</h2>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Calculado localmente desde potencia MyWhoosh, pulso y RPE de fuerza
              </p>
            </div>
          </div>
          <FitnessPMCChart data={pmc} />
        </div>

        <div className="lg:col-span-5 card-surface p-5">
          <div className="mb-3">
            <h2 className="text-base font-bold">Horas Semanales por Deporte</h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Últimas 8 semanas combinando cardio y fuerza en casa
            </p>
          </div>
          <WeeklyVolumeChart buckets={weeklyBuckets} />
        </div>
      </div>

      {/* Accesos directos a los 4 pilares */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link href="/casa" className="card-surface p-4 hover:border-purple-500/50 transition-colors group">
          <div className="flex items-center justify-between">
            <div className="h-10 w-10 rounded-xl bg-purple-500/15 text-purple-400 flex items-center justify-center">
              <Dumbbell className="h-5 w-5" />
            </div>
            <ArrowRight className="h-4 w-4 opacity-50 group-hover:translate-x-1 transition-transform" />
          </div>
          <div className="mt-3 font-semibold text-sm">Generar rutina en casa</div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {data.ownedEquipmentCount} materiales activos · {data.routinesCount} rutinas
          </div>
        </Link>

        <Link href="/ciclismo" className="card-surface p-4 hover:border-cyan-500/50 transition-colors group">
          <div className="flex items-center justify-between">
            <div className="h-10 w-10 rounded-xl bg-cyan-500/15 text-cyan-400 flex items-center justify-center">
              <Zap className="h-5 w-5" />
            </div>
            <ArrowRight className="h-4 w-4 opacity-50 group-hover:translate-x-1 transition-transform" />
          </div>
          <div className="mt-3 font-semibold text-sm">Centro MyWhoosh</div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {mywhoosh?.connected
              ? `Sincronizado directo · ${summary.monthBySport.mywhoosh ?? 0} este mes`
              : `${summary.monthBySport.mywhoosh ?? 0} sesiones este mes · FTP ${profile.ftpWatts} W`}
          </div>
        </Link>

        <Link href="/montana" className="card-surface p-4 hover:border-emerald-500/50 transition-colors group">
          <div className="flex items-center justify-between">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center">
              <Mountain className="h-5 w-5" />
            </div>
            <ArrowRight className="h-4 w-4 opacity-50 group-hover:translate-x-1 transition-transform" />
          </div>
          <div className="mt-3 font-semibold text-sm">Rutas de Montaña</div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Mapa topográfico · {data.pendingRoutesCount} rutas por hacer
          </div>
        </Link>

        <Link href="/strava" className="card-surface p-4 hover:border-primary/50 transition-colors group">
          <div className="flex items-center justify-between">
            <div className="h-10 w-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
              <RefreshCw className="h-5 w-5" />
            </div>
            <ArrowRight className="h-4 w-4 opacity-50 group-hover:translate-x-1 transition-transform" />
          </div>
          <div className="mt-3 font-semibold text-sm">MyWhoosh & Huawei Watch</div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {mywhoosh?.connected && (huawei?.googleConnected || (huawei?.watchDirFileCount ?? 0) > 0)
              ? 'MyWhoosh + Huawei activos (Sin Strava)'
              : mywhoosh?.connected
                ? `MyWhoosh directo (${mywhoosh.riderName || mywhoosh.email})`
                : huawei?.googleConnected || (huawei?.watchDirFileCount ?? 0) > 0
                  ? `Huawei listo (${huawei?.importedCount ?? 0} sesiones)`
                  : 'Conectar directo o subir .FIT/.GPX'}
          </div>
        </Link>
      </div>

      {/* Últimas Actividades y Material */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-8 card-surface p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold flex items-center gap-2">
              <ActivityIcon className="h-4 w-4 text-primary" />
              Últimas Actividades
            </h2>
            <Link href="/actividades" className="text-xs font-semibold text-primary hover:underline">
              Ver todas →
            </Link>
          </div>

          <div className="space-y-2.5">
            {recentActivities.map((act) => (
              <Link
                key={act.id}
                href={`/actividades/${act.id}`}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border p-3.5 hover:border-primary/50 transition-colors"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <SportBadge sport={act.sport} subSport={act.subSport} />
                    {act.doneTogether && <TogetherBadge />}
                    {act.worldName && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border border-cyan-500/20">
                        {act.worldName}
                      </span>
                    )}
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {new Date(act.startedAt).toLocaleDateString('es-ES', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div className="font-semibold text-sm">{act.title}</div>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-xs tabular-nums">
                  {act.distanceMeters > 0 && (
                    <div>
                      <div style={{ color: 'var(--text-muted)' }}>Distancia</div>
                      <div className="font-semibold">{formatDistanceKm(act.distanceMeters)}</div>
                    </div>
                  )}
                  <div>
                    <div style={{ color: 'var(--text-muted)' }}>Tiempo</div>
                    <div className="font-semibold">{formatDuration(getEffectiveDurationSec(act))}</div>
                  </div>
                  {(act.sport === 'running' ||
                    act.sport === 'trail' ||
                    act.sport === 'mountain' ||
                    act.sport === 'walking') &&
                    getEffectiveAvgSpeedMs(act) && (
                    <div>
                      <div style={{ color: 'var(--text-muted)' }}>Ritmo</div>
                      <div className="font-semibold">{formatPaceMinKm(getEffectiveAvgSpeedMs(act))}</div>
                    </div>
                  )}
                  {act.avgWatts && (
                    <div>
                      <div style={{ color: 'var(--text-muted)' }}>Potencia</div>
                      <div className="font-semibold text-cyan-400">{act.avgWatts} W</div>
                    </div>
                  )}
                  {act.elevationGain > 20 && (
                    <div>
                      <div style={{ color: 'var(--text-muted)' }}>Desnivel</div>
                      <div className="font-semibold text-emerald-400">+{act.elevationGain} m</div>
                    </div>
                  )}
                  {act.totalVolumeKg && (
                    <div>
                      <div style={{ color: 'var(--text-muted)' }}>Volumen</div>
                      <div className="font-semibold text-purple-400">{act.totalVolumeKg} kg</div>
                    </div>
                  )}
                  <div>
                    <div style={{ color: 'var(--text-muted)' }}>Carga</div>
                    <div className="font-semibold">{act.tss} TSS</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Desgaste de Zapatillas y Bicis */}
        <div className="lg:col-span-4 card-surface p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold">Desgaste de Material</h2>
            <Link href="/material" className="text-xs font-semibold text-primary hover:underline">
              Gestionar →
            </Link>
          </div>
          <div className="space-y-3">
            {gear.map((g) => {
              const totalKm = Math.round((g.initialKm + g.trackedKm) * 10) / 10;
              const pct = Math.min(100, Math.round((totalKm / Math.max(1, g.maxKm)) * 100));
              const barColor = pct >= 90 ? 'bg-rose-500' : pct >= 70 ? 'bg-amber-400' : 'bg-emerald-400';
              return (
                <div
                  key={g.id}
                  className="rounded-xl border p-3.5 space-y-2"
                  style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold truncate">{g.name}</span>
                    <span className="text-xs tabular-nums font-medium">{pct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-muted)' }}>
                    <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex justify-between text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
                    <span>{totalKm} km acumulados</span>
                    <span>Límite {g.maxKm} km</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
