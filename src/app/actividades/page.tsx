'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Plus, Search, Trash2, X } from 'lucide-react';
import { SportBadge } from '@/components/SportBadge';
import { formatDistanceKm, formatDuration, formatPaceMinKm, formatSpeedKmh } from '@/lib/metrics';
import type { Activity, GearItem, SportType } from '@/types';

const FILTERS: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'Todas' },
  { id: 'running', label: 'Correr' },
  { id: 'trail', label: 'Trail Running' },
  { id: 'mountain', label: 'Senderismo' },
  { id: 'walking', label: 'Caminar' },
  { id: 'mywhoosh', label: 'MyWhoosh' },
  { id: 'cycling', label: 'Ciclismo Ext.' },
  { id: 'strength', label: 'Fuerza en Casa' },
];

export default function ActivitiesPage() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [gear, setGear] = useState<GearItem[]>([]);
  const [sport, setSport] = useState('all');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [showManual, setShowManual] = useState(false);

  // Form state manual
  const [title, setTitle] = useState('');
  const [mSport, setMSport] = useState<SportType>('running');
  const [durationMin, setDurationMin] = useState(45);
  const [distanceKm, setDistanceKm] = useState(8);
  const [elevationGain, setElevationGain] = useState(120);
  const [avgHr, setAvgHr] = useState('');
  const [avgWatts, setAvgWatts] = useState('');
  const [rpe, setRpe] = useState(6);
  const [gearId, setGearId] = useState('');
  const [description, setDescription] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (sport !== 'all') params.set('sport', sport);
    if (q.trim()) params.set('q', q.trim());

    const [actRes, gearRes] = await Promise.all([
      fetch(`/api/activities?${params.toString()}`),
      fetch('/api/gear'),
    ]);
    const actData = await actRes.json();
    const gearData = await gearRes.json();
    setActivities(actData.activities ?? []);
    setGear(gearData.gear ?? []);
    setLoading(false);
  }, [sport, q]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreateManual(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/activities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        sport: mSport,
        durationMin,
        distanceKm: mSport === 'strength' ? 0 : distanceKm,
        elevationGain: mSport === 'strength' ? 0 : elevationGain,
        avgHr: avgHr ? Number(avgHr) : null,
        avgWatts: avgWatts ? Number(avgWatts) : null,
        rpe,
        gearId: gearId || null,
        description,
      }),
    });
    if (res.ok) {
      setTitle('');
      setDescription('');
      setShowManual(false);
      await load();
    }
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    await fetch(`/api/activities/${id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Historial de Actividades</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Unifica sesiones de MyWhoosh, reloj Huawei, rutas GPS de montaña y entrenos de fuerza en casa.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowManual((v) => !v)}
          className="inline-flex items-center gap-2 rounded-xl bg-[#fc4c02] hover:bg-[#e54400] px-4 py-2.5 text-sm font-semibold text-white transition-colors"
        >
          {showManual ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showManual ? 'Cancelar' : 'Registrar Manual'}
        </button>
      </div>

      {showManual && (
        <form onSubmit={handleCreateManual} className="card-surface p-5 space-y-4">
          <h2 className="text-base font-bold">Registrar Actividad Manualmente</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                Deporte
              </label>
              <select
                value={mSport}
                onChange={(e) => setMSport(e.target.value as SportType)}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              >
                <option value="running">Correr</option>
                <option value="trail">Trail Running</option>
                <option value="mountain">Senderismo</option>
                <option value="walking">Caminar</option>
                <option value="mywhoosh">MyWhoosh (Bici Indoor)</option>
                <option value="cycling">Ciclismo Exterior</option>
                <option value="strength">Fuerza en Casa</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                Título
              </label>
              <input
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ej. Rodaje por el río / MyWhoosh Tempo"
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>

            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                Duración (minutos)
              </label>
              <input
                type="number"
                min={1}
                value={durationMin}
                onChange={(e) => setDurationMin(Number(e.target.value))}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>

            {mSport !== 'strength' && (
              <>
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                    Distancia (km)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={distanceKm}
                    onChange={(e) => setDistanceKm(Number(e.target.value))}
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                    Desnivel + (m)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={elevationGain}
                    onChange={(e) => setElevationGain(Number(e.target.value))}
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                FC Media (ppm, opcional)
              </label>
              <input
                type="number"
                value={avgHr}
                onChange={(e) => setAvgHr(e.target.value)}
                placeholder="150"
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>

            {(mSport === 'mywhoosh' || mSport === 'cycling') && (
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                  Potencia Media (W, opcional)
                </label>
                <input
                  type="number"
                  value={avgWatts}
                  onChange={(e) => setAvgWatts(e.target.value)}
                  placeholder="220"
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
                />
              </div>
            )}

            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                Material usado (zapatillas/bici)
              </label>
              <select
                value={gearId}
                onChange={(e) => setGearId(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              >
                <option value="">Automático por deporte</option>
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
          </div>

          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Sensaciones o notas..."
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
          />

          <div className="flex justify-end">
            <button
              type="submit"
              className="rounded-xl bg-emerald-500 hover:bg-emerald-600 px-5 py-2 text-sm font-semibold text-white"
            >
              Guardar Actividad
            </button>
          </div>
        </form>
      )}

      {/* Filtros y buscador */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setSport(f.id)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                sport === f.id ? 'bg-[#fc4c02] text-white border-[#fc4c02]' : 'hover:bg-slate-500/10'
              }`}
              style={sport !== f.id ? { borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' } : undefined}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="relative w-full md:w-64">
          <Search className="h-4 w-4 absolute left-3 top-2.5" style={{ color: 'var(--text-muted)' }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar actividad..."
            className="w-full rounded-xl border pl-9 pr-3 py-2 text-sm"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
          />
        </div>
      </div>

      {/* Listado */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 rounded-2xl bg-slate-800/40 animate-pulse" />
          ))}
        </div>
      ) : activities.length === 0 ? (
        <div className="card-surface p-10 text-center space-y-2">
          <div className="font-semibold">No hay actividades con este filtro</div>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Prueba otro filtro, registra una sesión manual o importa un archivo desde Strava / MyWhoosh.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {activities.map((act) => (
            <Link
              key={act.id}
              href={`/actividades/${act.id}`}
              className="card-surface p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:border-[#fc4c02]/50 transition-colors"
            >
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <SportBadge sport={act.sport} subSport={act.subSport} />
                  <span
                    className="text-[11px] uppercase px-2 py-0.5 rounded-md border"
                    style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
                  >
                    {act.source}
                  </span>
                  {act.worldName && (
                    <span className="text-[11px] px-2 py-0.5 rounded-md bg-cyan-500/15 text-cyan-300">
                      {act.worldName}
                    </span>
                  )}
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {new Date(act.startedAt).toLocaleDateString('es-ES', {
                      weekday: 'short',
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                </div>
                <div className="font-semibold text-base">{act.title}</div>
                {act.gearName && (
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Material: {act.gearName}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-5">
                <div className="flex flex-wrap items-center gap-4 text-xs tabular-nums">
                  {act.distanceMeters > 0 && (
                    <div>
                      <div style={{ color: 'var(--text-muted)' }}>Distancia</div>
                      <div className="font-bold text-sm">{formatDistanceKm(act.distanceMeters)}</div>
                    </div>
                  )}
                  <div>
                    <div style={{ color: 'var(--text-muted)' }}>Duración</div>
                    <div className="font-bold text-sm">{formatDuration(act.durationSec)}</div>
                  </div>
                  {(act.sport === 'running' ||
                    act.sport === 'trail' ||
                    act.sport === 'mountain' ||
                    act.sport === 'walking') &&
                    act.avgSpeedMs && (
                    <div>
                      <div style={{ color: 'var(--text-muted)' }}>Ritmo</div>
                      <div className="font-bold text-sm">{formatPaceMinKm(act.avgSpeedMs)}</div>
                    </div>
                  )}
                  {(act.sport === 'mywhoosh' || act.sport === 'cycling') && act.avgSpeedMs && (
                    <div>
                      <div style={{ color: 'var(--text-muted)' }}>Vel.</div>
                      <div className="font-bold text-sm">{formatSpeedKmh(act.avgSpeedMs)}</div>
                    </div>
                  )}
                  {act.avgWatts && (
                    <div>
                      <div style={{ color: 'var(--text-muted)' }}>Potencia</div>
                      <div className="font-bold text-sm text-cyan-400">
                        {act.avgWatts} W{act.normalizedPower ? ` (NP ${act.normalizedPower})` : ''}
                      </div>
                    </div>
                  )}
                  {act.elevationGain > 15 && (
                    <div>
                      <div style={{ color: 'var(--text-muted)' }}>Desnivel</div>
                      <div className="font-bold text-sm text-emerald-400">+{act.elevationGain} m</div>
                    </div>
                  )}
                  {act.totalVolumeKg && (
                    <div>
                      <div style={{ color: 'var(--text-muted)' }}>Volumen</div>
                      <div className="font-bold text-sm text-purple-400">{act.totalVolumeKg} kg</div>
                    </div>
                  )}
                  <div>
                    <div style={{ color: 'var(--text-muted)' }}>Carga</div>
                    <div className="font-bold text-sm">{act.tss} TSS</div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={(e) => handleDelete(e, act.id)}
                  className="p-2 rounded-lg text-rose-400 hover:bg-rose-500/15 transition-colors"
                  title="Eliminar actividad"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
