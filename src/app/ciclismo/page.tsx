'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Award, Bike, Flame, Gauge, Zap } from 'lucide-react';
import ActivityImporter from '@/components/ActivityImporter';
import { SportBadge } from '@/components/SportBadge';
import { formatDistanceKm, formatDuration, getCogganPowerZones } from '@/lib/metrics';
import type { Activity, AthleteProfile } from '@/types';

export default function CyclingMyWhooshPage() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [profile, setProfile] = useState<AthleteProfile | null>(null);
  const [ftpDraft, setFtpDraft] = useState(245);
  const [savedNotice, setSavedNotice] = useState(false);

  const load = useCallback(async () => {
    const [mwRes, cycRes, profRes] = await Promise.all([
      fetch('/api/activities?sport=mywhoosh').then((r) => r.json()),
      fetch('/api/activities?sport=cycling').then((r) => r.json()),
      fetch('/api/profile').then((r) => r.json()),
    ]);
    const combined = [...(mwRes.activities ?? []), ...(cycRes.activities ?? [])].sort(
      (a: Activity, b: Activity) => Date.parse(b.startedAt) - Date.parse(a.startedAt)
    );
    setActivities(combined);
    if (profRes?.profile) {
      setProfile(profRes.profile);
      setFtpDraft(profRes.profile.ftpWatts);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveFtp(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ftpWatts: ftpDraft }),
    });
    if (res.ok) {
      const d = await res.json();
      setProfile(d.profile);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 2500);
    }
  }

  const myWhooshActs = activities.filter((a) => a.sport === 'mywhoosh');
  const totalKm = Math.round(activities.reduce((s, a) => s + a.distanceMeters, 0) / 1000);
  const totalHours = (activities.reduce((s, a) => s + a.durationSec, 0) / 3600).toFixed(1);
  const totalTss = activities.reduce((s, a) => s + a.tss, 0);
  const bestNp = Math.max(0, ...activities.map((a) => a.normalizedPower ?? a.avgWatts ?? 0));
  const ftp = profile?.ftpWatts ?? 245;
  const weightKg = profile?.weightKg ?? 72;
  const wKg = (ftp / weightKg).toFixed(2);
  const zones = getCogganPowerZones(ftp);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
            <Zap className="h-6 w-6 text-cyan-400" />
            Centro MyWhoosh y Ciclismo
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Análisis de vatios, FTP, W/kg, zonas Coggan e importación directa de archivos .GPX/.FIT de MyWhoosh o Strava.
          </p>
        </div>
      </div>

      {/* KPIs Ciclismo */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card-surface p-5 space-y-1.5">
          <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
            <span>FTP ACTUAL</span>
            <Gauge className="h-4 w-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-bold text-cyan-400 tabular-nums">
            {ftp} W <span className="text-sm font-normal text-slate-400">({wKg} W/kg)</span>
          </div>
          <form onSubmit={saveFtp} className="flex items-center gap-2 pt-1">
            <input
              type="number"
              min={60}
              max={600}
              value={ftpDraft}
              onChange={(e) => setFtpDraft(Number(e.target.value))}
              className="w-20 rounded-lg border px-2 py-1 text-xs tabular-nums"
              style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
            />
            <button type="submit" className="px-2.5 py-1 rounded-lg bg-cyan-500/20 text-cyan-300 text-xs font-semibold hover:bg-cyan-500/30">
              {savedNotice ? '¡Guardado!' : 'Actualizar FTP'}
            </button>
          </form>
        </div>

        <div className="card-surface p-5 space-y-1.5">
          <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
            <span>SESIONES MYWHOOSH</span>
            <Zap className="h-4 w-4 text-cyan-400" />
          </div>
          <div className="text-2xl font-bold tabular-nums">{myWhooshActs.length} sesiones</div>
          <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {activities.length} en total (indoor + exterior)
          </div>
        </div>

        <div className="card-surface p-5 space-y-1.5">
          <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
            <span>VOLUMEN ACUMULADO</span>
            <Bike className="h-4 w-4 text-blue-400" />
          </div>
          <div className="text-2xl font-bold tabular-nums">{totalKm} km</div>
          <div className="text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>
            {totalHours} horas · {totalTss} TSS total
          </div>
        </div>

        <div className="card-surface p-5 space-y-1.5">
          <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
            <span>MEJOR NP EN SESIÓN</span>
            <Award className="h-4 w-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-amber-400 tabular-nums">{bestNp} W</div>
          <div className="text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>
            {(bestNp / weightKg).toFixed(2)} W/kg normalizados
          </div>
        </div>
      </div>

      {/* Zonas de potencia + Importador MyWhoosh */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-5 card-surface p-5 space-y-3">
          <h2 className="text-base font-bold flex items-center gap-2">
            <Flame className="h-4 w-4 text-cyan-400" />
            Tus Zonas de Potencia (Coggan)
          </h2>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Calculadas para tu FTP de {ftp} W ({weightKg} kg). Úsalas para programar tus entrenos en MyWhoosh.
          </p>
          <div className="space-y-2 pt-1">
            {zones.map((z) => (
              <div
                key={z.zone}
                className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              >
                <div className="flex items-center gap-2.5">
                  <span className="font-bold w-6" style={{ color: z.color }}>
                    {z.zone}
                  </span>
                  <span className="font-medium">{z.name}</span>
                </div>
                <span className="tabular-nums font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  {z.range}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-7 card-surface p-5 space-y-4">
          <div>
            <h2 className="text-base font-bold">Importar Sesión de MyWhoosh</h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              Bilifit soporta tanto las sesiones sincronizadas desde <strong>Strava (VirtualRide)</strong> como los archivos
              <strong> .GPX</strong> (incluyendo vatios y cadencia de MyWhoosh 5.x) o <strong>.FIT</strong> descargados de la web de MyWhoosh.
            </p>
          </div>
          <ActivityImporter onImported={load} />
        </div>
      </div>

      {/* Listado de sesiones */}
      <div className="card-surface p-5 space-y-4">
        <h2 className="text-base font-bold">Sesiones de MyWhoosh y Ciclismo</h2>
        <div className="space-y-2.5">
          {activities.map((act) => (
            <Link
              key={act.id}
              href={`/actividades/${act.id}`}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border p-3.5 hover:border-cyan-400/50 transition-colors"
              style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <SportBadge sport={act.sport} subSport={act.subSport} />
                  {act.worldName && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300">
                      Mundo: {act.worldName}
                    </span>
                  )}
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {new Date(act.startedAt).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </span>
                </div>
                <div className="font-semibold text-sm">{act.title}</div>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs tabular-nums">
                <div>
                  <div style={{ color: 'var(--text-muted)' }}>Distancia</div>
                  <div className="font-semibold">{formatDistanceKm(act.distanceMeters)}</div>
                </div>
                <div>
                  <div style={{ color: 'var(--text-muted)' }}>Tiempo</div>
                  <div className="font-semibold">{formatDuration(act.durationSec)}</div>
                </div>
                {act.avgWatts && (
                  <div>
                    <div style={{ color: 'var(--text-muted)' }}>Media / NP</div>
                    <div className="font-semibold text-cyan-400">
                      {act.avgWatts} / {act.normalizedPower ?? act.avgWatts} W
                    </div>
                  </div>
                )}
                {act.avgCadence && (
                  <div>
                    <div style={{ color: 'var(--text-muted)' }}>Cadencia</div>
                    <div className="font-semibold">{act.avgCadence} rpm</div>
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
    </div>
  );
}
