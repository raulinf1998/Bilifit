'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Flag, Loader2, RefreshCw, Save, Settings } from 'lucide-react';
import { getCogganPowerZones } from '@/lib/metrics';
import type { ReloadActivitiesResult } from '@/lib/reprocess';
import type { AthleteProfile } from '@/types';

export default function SettingsPage() {
  const [profile, setProfile] = useState<AthleteProfile | null>(null);
  const [saved, setSaved] = useState(false);
  const [reloadingAll, setReloadingAll] = useState(false);
  const [reloadSources, setReloadSources] = useState(true);
  const [detectClimbs, setDetectClimbs] = useState(true);
  const [reloadResult, setReloadResult] = useState<ReloadActivitiesResult | null>(null);
  const [reloadError, setReloadError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/profile')
      .then((r) => r.json())
      .then((d) => setProfile(d.profile));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    const res = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
    });
    if (res.ok) {
      const d = await res.json();
      setProfile(d.profile);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
  }

  async function handleReloadAll() {
    setReloadingAll(true);
    setReloadError(null);
    try {
      const res = await fetch('/api/activities/reload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reloadSources, detectClimbs }),
      });
      const data = await res.json();
      if (!res.ok) {
        setReloadError(data.error || 'No se pudieron recargar las actividades.');
      } else {
        setReloadResult(data as ReloadActivitiesResult);
        window.dispatchEvent(new CustomEvent('bilifit:activities-reloaded'));
      }
    } catch (err) {
      setReloadError(err instanceof Error ? err.message : 'Error de conexión al recargar.');
    } finally {
      setReloadingAll(false);
    }
  }

  if (!profile) {
    return <div className="card-surface p-8 text-sm">Cargando perfil...</div>;
  }

  const zones = getCogganPowerZones(profile.ftpWatts);
  const hrZones = [
    { z: 'Z1', name: 'Recuperación', range: `< ${Math.round(profile.maxHr * 0.6)} ppm` },
    { z: 'Z2', name: 'Aeróbico / Base', range: `${Math.round(profile.maxHr * 0.6)}-${Math.round(profile.maxHr * 0.72)} ppm` },
    { z: 'Z3', name: 'Tempo', range: `${Math.round(profile.maxHr * 0.73)}-${Math.round(profile.maxHr * 0.82)} ppm` },
    { z: 'Z4', name: 'Umbral', range: `${Math.round(profile.maxHr * 0.83)}-${Math.round(profile.maxHr * 0.91)} ppm` },
    { z: 'Z5', name: 'VO2 Max', range: `> ${Math.round(profile.maxHr * 0.91)} ppm` },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
          <Settings className="h-6 w-6 text-primary" />
          Ajustes Fisiológicos del Atleta
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          Bilifit usa estos umbrales para calcular automáticamente tus TSS, W/kg, Fitness (CTL) y zonas de MyWhoosh/Running.
        </p>
      </div>

      {saved && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3.5 text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" /> Perfil fisiológico guardado correctamente.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <form onSubmit={handleSave} className="lg:col-span-7 card-surface p-5 space-y-4">
          <h2 className="text-base font-bold">Parámetros y Objetivos</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                Nombre de atleta
              </label>
              <input
                value={profile.name}
                onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                className="w-full rounded-xl border px-3 py-2 text-sm"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>

            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                Peso corporal (kg)
              </label>
              <input
                type="number"
                step={0.5}
                value={profile.weightKg}
                onChange={(e) => setProfile({ ...profile, weightKg: Number(e.target.value) })}
                className="w-full rounded-xl border px-3 py-2 text-sm tabular-nums"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>

            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                FTP Ciclismo / MyWhoosh (W)
              </label>
              <input
                type="number"
                value={profile.ftpWatts}
                onChange={(e) => setProfile({ ...profile, ftpWatts: Number(e.target.value) })}
                className="w-full rounded-xl border px-3 py-2 text-sm tabular-nums"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>

            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                FC Máxima (ppm)
              </label>
              <input
                type="number"
                value={profile.maxHr}
                onChange={(e) => setProfile({ ...profile, maxHr: Number(e.target.value) })}
                className="w-full rounded-xl border px-3 py-2 text-sm tabular-nums"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>

            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                FC Reposo (ppm)
              </label>
              <input
                type="number"
                value={profile.restingHr}
                onChange={(e) => setProfile({ ...profile, restingHr: Number(e.target.value) })}
                className="w-full rounded-xl border px-3 py-2 text-sm tabular-nums"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>

            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                Umbral Láctico LTHR (ppm)
              </label>
              <input
                type="number"
                value={profile.lthr}
                onChange={(e) => setProfile({ ...profile, lthr: Number(e.target.value) })}
                className="w-full rounded-xl border px-3 py-2 text-sm tabular-nums"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>

            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                Objetivo semanal (horas)
              </label>
              <input
                type="number"
                step={0.5}
                value={profile.weeklyTargetHours}
                onChange={(e) => setProfile({ ...profile, weeklyTargetHours: Number(e.target.value) })}
                className="w-full rounded-xl border px-3 py-2 text-sm tabular-nums"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-xl bg-primary hover:bg-primaryhover px-5 py-2.5 text-sm font-semibold text-onprimary"
            >
              <Save className="h-4 w-4" /> Guardar Perfil
            </button>
          </div>
        </form>

        <div className="lg:col-span-5 space-y-5">
          <div className="card-surface p-5 space-y-3">
            <h2 className="text-base font-bold">
              Zonas de Potencia ({(profile.ftpWatts / Math.max(1, profile.weightKg)).toFixed(2)} W/kg)
            </h2>
            <div className="space-y-1.5">
              {zones.map((z) => (
                <div key={z.zone} className="flex justify-between text-xs py-1 border-b last:border-0" style={{ borderColor: 'var(--border-subtle)' }}>
                  <span>
                    <strong style={{ color: z.color }}>{z.zone}</strong> {z.name}
                  </span>
                  <span className="tabular-nums font-medium">{z.range}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card-surface p-5 space-y-3">
            <h2 className="text-base font-bold">Zonas de Frecuencia Cardíaca</h2>
            <div className="space-y-1.5">
              {hrZones.map((z) => (
                <div key={z.z} className="flex justify-between text-xs py-1 border-b last:border-0" style={{ borderColor: 'var(--border-subtle)' }}>
                  <span>
                    <strong className="text-rose-400">{z.z}</strong> {z.name}
                  </span>
                  <span className="tabular-nums font-medium">{z.range}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Mantenimiento y Recarga completa de actividades + Segmentos */}
      <div className="card-surface p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-base font-bold flex items-center gap-2">
              <Flag className="h-4 w-4 text-amber-500" />
              Recarga de Actividades y Búsqueda de Segmentos
            </h2>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Vuelve a procesar todas tus sesiones guardadas (actualizando métricas con tu perfil, nombres por defecto,
              tiempo en movimiento y parciales), refresca las fuentes conectadas (Huawei / Google Drive, MyWhoosh y
              Strava) y detecta y empareja automáticamente segmentos y marcas PR en todo tu historial.
            </p>
          </div>

          <button
            type="button"
            disabled={reloadingAll}
            onClick={handleReloadAll}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary hover:bg-primaryhover disabled:opacity-60 px-5 py-2.5 text-sm font-semibold text-onprimary shrink-0 transition-colors"
          >
            {reloadingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {reloadingAll ? 'Recargando actividades...' : 'Recargar actividades y buscar segmentos'}
          </button>
        </div>

        <div className="flex flex-wrap gap-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={reloadSources}
              onChange={(e) => setReloadSources(e.target.checked)}
              className="rounded accent-primary"
            />
            Refrescar sesiones desde fuentes conectadas (Drive / Huawei, MyWhoosh, Strava)
          </label>
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={detectClimbs}
              onChange={(e) => setDetectClimbs(e.target.checked)}
              className="rounded accent-primary"
            />
            Auto-detectar nuevas subidas y segmentos
          </label>
        </div>

        {reloadError && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3.5 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{reloadError}</span>
          </div>
        )}

        {reloadResult && (
          <div
            className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-4 space-y-3 text-xs"
            role="status"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>
                  Recarga completada: {reloadResult.reprocessedActivities} de {reloadResult.totalActivities} actividades
                  reprocesadas
                </span>
              </div>
              <div className="flex items-center gap-3 font-semibold">
                <Link href="/segmentos" className="text-primary hover:underline">
                  Ver segmentos →
                </Link>
                <Link href="/actividades" className="text-primary hover:underline">
                  Ver actividades →
                </Link>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 tabular-nums">
              <div className="rounded-lg border p-2.5" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}>
                <div style={{ color: 'var(--text-muted)' }}>Segmentos</div>
                <div className="font-bold text-sm mt-0.5">
                  +{reloadResult.segments.created} nuevos · {reloadResult.segments.total} totales
                </div>
                <div className="mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                  {reloadResult.segments.effortsMatched} pasadas en {reloadResult.segments.activitiesMatched} sesiones
                </div>
              </div>

              {(
                [
                  ['Huawei / Drive', reloadResult.sources.huawei],
                  ['MyWhoosh', reloadResult.sources.mywhoosh],
                  ['Strava', reloadResult.sources.strava],
                ] as const
              ).map(([label, src]) => (
                <div
                  key={label}
                  className="rounded-lg border p-2.5"
                  style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
                >
                  <div style={{ color: 'var(--text-muted)' }}>{label}</div>
                  <div className="font-bold text-sm mt-0.5">
                    {src.status === 'ok'
                      ? `${src.imported} nuevas · ${src.updated} act.`
                      : src.status === 'skipped'
                        ? 'No conectado'
                        : 'Con aviso'}
                  </div>
                  {src.error && <div className="text-[11px] text-rose-500 mt-0.5 truncate">{src.error}</div>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
