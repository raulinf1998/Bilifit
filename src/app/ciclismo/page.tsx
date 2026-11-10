'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, Bike, Flame, Gauge, Globe, Zap } from 'lucide-react';
import ActivityImporter from '@/components/ActivityImporter';
import ActivityMap from '@/components/ActivityMap';
import MyWhooshConnectorCard from '@/components/MyWhooshConnectorCard';
import { SportBadge } from '@/components/SportBadge';
import { formatDistanceKm, formatDuration, getCogganPowerZones } from '@/lib/metrics';
import { MYWHOOSH_WORLDS, getMyWhooshWorldByIdOrName } from '@/lib/mywhoosh-maps';
import type { Activity, AthleteProfile } from '@/types';

export default function CyclingMyWhooshPage() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [profile, setProfile] = useState<AthleteProfile | null>(null);
  const [ftpDraft, setFtpDraft] = useState(245);
  const [savedNotice, setSavedNotice] = useState(false);
  const [selectedWorldId, setSelectedWorldId] = useState<string>('hudayriyat');

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

  const worldStats = useMemo(() => {
    const map = new Map<string, { count: number; km: number; latestActivity: Activity | null }>();
    for (const w of MYWHOOSH_WORLDS) {
      map.set(w.id, { count: 0, km: 0, latestActivity: null });
    }
    for (const act of myWhooshActs) {
      const w = getMyWhooshWorldByIdOrName(act.worldName) ?? getMyWhooshWorldByIdOrName(act.title);
      if (!w) continue;
      const entry = map.get(w.id);
      if (entry) {
        entry.count += 1;
        entry.km += act.distanceMeters / 1000;
        if (!entry.latestActivity) entry.latestActivity = act;
      }
    }
    return map;
  }, [myWhooshActs]);

  const selectedWorld = getMyWhooshWorldByIdOrName(selectedWorldId) ?? MYWHOOSH_WORLDS[0];
  const selectedWorldLatest = worldStats.get(selectedWorld.id)?.latestActivity ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
            <Zap className="h-6 w-6 text-cyan-400" />
            Centro MyWhoosh y Ciclismo
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Mapas interactivos por mundo de MyWhoosh, análisis de vatios, FTP, W/kg, zonas Coggan e importación .GPX/.FIT.
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

      {/* Conexión directa nativa MyWhoosh */}
      <MyWhooshConnectorCard onSynced={load} />

      {/* Atlas Interactivo de Mundos de MyWhoosh */}
      <div className="card-surface p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold flex items-center gap-2">
              <Globe className="h-4 w-4 text-cyan-400" />
              Atlas de Mundos Virtuales de MyWhoosh
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Selecciona cualquier mundo para explorar su cartografía virtual en Leaflet junto con tu última ruta grabada.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 gap-2.5 max-h-[380px] overflow-y-auto pr-1">
            {MYWHOOSH_WORLDS.map((w) => {
              const st = worldStats.get(w.id);
              const active = w.id === selectedWorld.id;
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => setSelectedWorldId(w.id)}
                  className={`text-left rounded-xl border p-2.5 transition-all ${
                    active ? 'border-cyan-400 bg-cyan-500/10' : 'hover:border-slate-600'
                  }`}
                  style={!active ? { background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' } : undefined}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-semibold text-xs truncate">{w.name}</span>
                    {st && st.count > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-semibold">
                        {st.count}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {w.regionLabel} · {st && st.km > 0 ? `${Math.round(st.km)} km` : 'Sin rutas'}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="lg:col-span-7 space-y-2.5">
            <ActivityMap
              sport="mywhoosh"
              worldName={selectedWorld.name}
              polyline={selectedWorldLatest?.polyline ?? null}
              heightClass="h-80"
            />
            <div className="flex flex-wrap items-center justify-between text-xs px-1" style={{ color: 'var(--text-secondary)' }}>
              <span>
                <strong>{selectedWorld.name}</strong> ({selectedWorld.regionLabel}) — {selectedWorld.subtitle}
              </span>
              {selectedWorldLatest && (
                <Link href={`/actividades/${selectedWorldLatest.id}`} className="text-cyan-400 hover:underline font-medium">
                  Ver última sesión: {selectedWorldLatest.title} →
                </Link>
              )}
            </div>
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
            <h2 className="text-base font-bold">Importar Archivos Manualmente (.FIT / .GPX / .TCX)</h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              Además de la sincronización directa nativa arriba, puedes subir manualmente archivos <strong>.FIT</strong> o{' '}
              <strong>.GPX</strong> (incluyendo vatios y cadencia de MyWhoosh 5.x) o sesiones de ciclismo exterior.
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
