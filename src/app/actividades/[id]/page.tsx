'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, Download, Save, Trash2 } from 'lucide-react';
import ActivityMap from '@/components/ActivityMap';
import { PowerZonesChart, TelemetryChart } from '@/components/Charts';
import { SportBadge } from '@/components/SportBadge';
import {
  formatDistanceKm,
  formatDuration,
  formatPaceMinKm,
  formatSpeedKmh,
  getCogganPowerZones,
  sportColor,
} from '@/lib/metrics';
import type { ActivityDetail, ActivityPoint, AthleteProfile, GearItem, SportType } from '@/types';

export default function ActivityDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [activity, setActivity] = useState<ActivityDetail | null>(null);
  const [profile, setProfile] = useState<AthleteProfile | null>(null);
  const [gear, setGear] = useState<GearItem[]>([]);
  const [hoverPoint, setHoverPoint] = useState<ActivityPoint | null>(null);
  const [editing, setEditing] = useState(false);

  const [title, setTitle] = useState('');
  const [sport, setSport] = useState<SportType>('running');
  const [gearId, setGearId] = useState('');
  const [rpe, setRpe] = useState(6);
  const [description, setDescription] = useState('');

  useEffect(() => {
    Promise.all([
      fetch(`/api/activities/${params.id}`).then((r) => (r.ok ? r.json() : null)),
      fetch('/api/profile').then((r) => r.json()),
      fetch('/api/gear').then((r) => r.json()),
    ]).then(([actRes, profRes, gearRes]) => {
      if (actRes?.activity) {
        setActivity(actRes.activity);
        setTitle(actRes.activity.title);
        setSport(actRes.activity.sport);
        setGearId(actRes.activity.gearId ?? '');
        setRpe(actRes.activity.rpe ?? 6);
        setDescription(actRes.activity.description ?? '');
      }
      setProfile(profRes?.profile ?? null);
      setGear(gearRes?.gear ?? []);
    });
  }, [params.id]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/activities/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        sport,
        gearId: gearId || null,
        rpe,
        description,
      }),
    });
    if (res.ok) {
      const d = await res.json();
      setActivity((prev) => (prev ? { ...prev, ...d.activity } : d.activity));
      setEditing(false);
    }
  }

  async function handleDelete() {
    await fetch(`/api/activities/${params.id}`, { method: 'DELETE' });
    router.push('/actividades');
  }

  if (!activity) {
    return (
      <div className="space-y-4">
        <Link href="/actividades" className="inline-flex items-center gap-2 text-sm text-[#fc4c02]">
          <ArrowLeft className="h-4 w-4" /> Volver al historial
        </Link>
        <div className="card-surface p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          Cargando actividad...
        </div>
      </div>
    );
  }

  const ftp = profile?.ftpWatts ?? 245;
  const weightKg = profile?.weightKg ?? 72;
  const hasGps =
    activity.points.some((p) => typeof p.lat === 'number' && typeof p.lon === 'number') ||
    Boolean(activity.polyline);
  const powerZones = activity.avgWatts ? getCogganPowerZones(ftp, activity.points) : null;
  const intensityFactor =
    activity.normalizedPower && ftp > 0 ? (activity.normalizedPower / ftp).toFixed(2) : null;
  const wKg = activity.avgWatts && weightKg > 0 ? (activity.avgWatts / weightKg).toFixed(2) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/actividades" className="inline-flex items-center gap-2 text-sm font-medium hover:underline">
          <ArrowLeft className="h-4 w-4" /> Volver a Actividades
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          {hasGps && (
            <a
              href={`/api/activities/${activity.id}?format=gpx`}
              className="inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold hover:bg-slate-500/10"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <Download className="h-3.5 w-3.5 text-emerald-400" /> Descargar GPX
            </a>
          )}
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="rounded-xl border px-3.5 py-2 text-xs font-semibold hover:bg-slate-500/10"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            {editing ? 'Cerrar edición' : 'Editar'}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="inline-flex items-center gap-1 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-xs font-semibold text-rose-400 hover:bg-rose-500/20"
          >
            <Trash2 className="h-3.5 w-3.5" /> Eliminar
          </button>
        </div>
      </div>

      {/* Header */}
      <div className="card-surface p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <SportBadge sport={activity.sport} subSport={activity.subSport} />
          {activity.worldName && (
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
              Mundo Virtual: {activity.worldName}
            </span>
          )}
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {new Date(activity.startedAt).toLocaleString('es-ES')} · Origen: {activity.source.toUpperCase()}
          </span>
        </div>

        <h1 className="text-2xl sm:text-3xl font-bold">{activity.title}</h1>
        {activity.description && (
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {activity.description}
          </p>
        )}

        {editing && (
          <form onSubmit={handleSave} className="pt-4 border-t grid grid-cols-1 sm:grid-cols-2 gap-4" style={{ borderColor: 'var(--border-subtle)' }}>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                Título
              </label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                Deporte
              </label>
              <select
                value={sport}
                onChange={(e) => setSport(e.target.value as SportType)}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              >
                <option value="running">Correr</option>
                <option value="mywhoosh">MyWhoosh / Bici Indoor</option>
                <option value="mountain">Montaña / Trail</option>
                <option value="cycling">Ciclismo Exterior</option>
                <option value="strength">Fuerza en Casa</option>
              </select>
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                Material asociado
              </label>
              <select
                value={gearId}
                onChange={(e) => setGearId(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              >
                <option value="">Sin material</option>
                {gear.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                RPE ({rpe}/10)
              </label>
              <input
                type="range"
                min={1}
                max={10}
                value={rpe}
                onChange={(e) => setRpe(Number(e.target.value))}
                className="w-full accent-[#fc4c02] mt-2"
              />
            </div>
            <div className="sm:col-span-2">
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <button
                type="submit"
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
              >
                <Save className="h-4 w-4" /> Guardar cambios
              </button>
            </div>
          </form>
        )}

        {/* Grid de métricas */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 pt-2">
          {activity.distanceMeters > 0 && (
            <div className="card-elevated p-3">
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Distancia</div>
              <div className="text-lg font-bold tabular-nums">{formatDistanceKm(activity.distanceMeters)}</div>
            </div>
          )}
          <div className="card-elevated p-3">
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Tiempo</div>
            <div className="text-lg font-bold tabular-nums">{formatDuration(activity.durationSec)}</div>
          </div>
          {activity.avgSpeedMs && (
            <div className="card-elevated p-3">
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {activity.sport === 'running' || activity.sport === 'mountain' ? 'Ritmo medio' : 'Vel. media'}
              </div>
              <div className="text-lg font-bold tabular-nums">
                {activity.sport === 'running' || activity.sport === 'mountain'
                  ? formatPaceMinKm(activity.avgSpeedMs)
                  : formatSpeedKmh(activity.avgSpeedMs)}
              </div>
            </div>
          )}
          {activity.elevationGain > 0 && (
            <div className="card-elevated p-3">
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Desnivel +</div>
              <div className="text-lg font-bold tabular-nums text-emerald-400">+{activity.elevationGain} m</div>
            </div>
          )}
          {activity.avgHr && (
            <div className="card-elevated p-3">
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>FC Media / Máx</div>
              <div className="text-lg font-bold tabular-nums text-rose-400">
                {activity.avgHr} / {activity.maxHr ?? '--'}
              </div>
            </div>
          )}
          {activity.avgWatts && (
            <div className="card-elevated p-3">
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Potencia / NP</div>
              <div className="text-lg font-bold tabular-nums text-cyan-400">
                {activity.avgWatts} / {activity.normalizedPower ?? activity.avgWatts} W
              </div>
            </div>
          )}
          {wKg && (
            <div className="card-elevated p-3">
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Relación W/kg</div>
              <div className="text-lg font-bold tabular-nums">{wKg} W/kg</div>
            </div>
          )}
          {intensityFactor && (
            <div className="card-elevated p-3">
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>IF (vs FTP)</div>
              <div className="text-lg font-bold tabular-nums">{intensityFactor}</div>
            </div>
          )}
          <div className="card-elevated p-3">
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Carga (TSS)</div>
            <div className="text-lg font-bold tabular-nums text-[#fc4c02]">{activity.tss}</div>
          </div>
          {activity.totalVolumeKg && (
            <div className="card-elevated p-3">
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Volumen fuerza</div>
              <div className="text-lg font-bold tabular-nums text-purple-400">{activity.totalVolumeKg} kg</div>
            </div>
          )}
        </div>
      </div>

      {/* Mapa GPS si tiene traza */}
      {hasGps && (
        <div className="card-surface p-5 space-y-3">
          <h2 className="text-base font-bold">Mapa Topográfico de la Ruta</h2>
          <ActivityMap
            points={activity.points}
            polyline={activity.polyline}
            color={sportColor(activity.sport)}
            defaultLayer={activity.sport === 'mountain' ? 'topo' : 'osm'}
            hoverPoint={hoverPoint}
            heightClass="h-96"
          />
        </div>
      )}

      {/* Gráfica de Telemetría */}
      {activity.points.length > 3 && (
        <div className="card-surface p-5 space-y-3">
          <h2 className="text-base font-bold">Perfil de Altimetría, Potencia y Frecuencia Cardíaca</h2>
          <TelemetryChart points={activity.points} onHoverPoint={setHoverPoint} />
        </div>
      )}

      {/* Zonas de Potencia + Curva de Potencia (MyWhoosh / Ciclismo) */}
      {powerZones && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-7 card-surface p-5 space-y-4">
            <h2 className="text-base font-bold">Distribución por Zonas de Potencia (FTP {ftp} W)</h2>
            <PowerZonesChart zones={powerZones} />
          </div>

          <div className="lg:col-span-5 card-surface p-5 space-y-4">
            <h2 className="text-base font-bold">Curva de Potencia de la Sesión</h2>
            {activity.powerCurve && activity.powerCurve.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {activity.powerCurve.map((p) => (
                  <div key={p.label} className="card-elevated p-3 text-center">
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      Mejor {p.label}
                    </div>
                    <div className="text-xl font-bold text-cyan-400 tabular-nums mt-1">{p.watts} W</div>
                    <div className="text-[11px] tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                      {(p.watts / weightKg).toFixed(2)} W/kg
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                No hay suficientes puntos temporales para calcular la curva de potencia.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Detalle de Fuerza en Casa */}
      {activity.strengthLogs && activity.strengthLogs.length > 0 && (
        <div className="card-surface p-5 space-y-4">
          <h2 className="text-base font-bold">Ejercicios y Series Registradas</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {activity.strengthLogs.map((ex, idx) => (
              <div key={`${ex.exerciseId}-${idx}`} className="card-elevated p-4 space-y-2">
                <div className="font-semibold text-sm">{ex.exerciseName}</div>
                <div className="space-y-1">
                  {ex.sets.map((s, sIdx) => (
                    <div key={sIdx} className="flex justify-between text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                      <span>Serie {sIdx + 1}</span>
                      <span>
                        {s.reps} reps {s.weightKg > 0 ? `× ${s.weightKg} kg` : '(peso corporal)'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
