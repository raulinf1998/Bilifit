'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Compass, Download, MapPin, Mountain, Plus, Trash2, Upload, X } from 'lucide-react';
import MultiRouteMap from '@/components/MultiRouteMap';
import { SportBadge } from '@/components/SportBadge';
import { formatDistanceKm, formatDuration } from '@/lib/metrics';
import type { Activity, MountainRoute } from '@/types';

export default function MountainRoutesPage() {
  const [routes, setRoutes] = useState<MountainRoute[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [showAdd, setShowAdd] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [region, setRegion] = useState('Picos de Europa / Asturias');
  const [difficulty, setDifficulty] = useState<MountainRoute['difficulty']>('Moderada');
  const [notes, setNotes] = useState('');
  const [distanceKm, setDistanceKm] = useState(14);
  const [elevationGain, setElevationGain] = useState(750);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [rtRes, mtnActRes, runActRes] = await Promise.all([
      fetch('/api/routes').then((r) => r.json()),
      fetch('/api/activities?sport=mountain').then((r) => r.json()),
      fetch('/api/activities?sport=running').then((r) => r.json()),
    ]);
    setRoutes(rtRes.routes ?? []);
    setActivities([...(mtnActRes.activities ?? []), ...(runActRes.activities ?? [])]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAddRoute(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      let res: Response;
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        if (name.trim()) fd.append('name', name.trim());
        fd.append('region', region);
        fd.append('difficulty', difficulty);
        if (notes.trim()) fd.append('notes', notes.trim());
        res = await fetch('/api/routes', { method: 'POST', body: fd });
      } else {
        res = await fetch('/api/routes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            region,
            difficulty,
            distanceKm,
            elevationGain,
            notes,
          }),
        });
      }

      if (res.ok) {
        setFile(null);
        setName('');
        setNotes('');
        setShowAdd(false);
        await load();
      }
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(route: MountainRoute) {
    const next = route.status === 'pending' ? 'completed' : 'pending';
    await fetch(`/api/routes/${route.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    });
    await load();
  }

  async function deleteRoute(id: string) {
    await fetch(`/api/routes/${id}`, { method: 'DELETE' });
    await load();
  }

  const mtnOnly = activities.filter((a) => a.sport === 'mountain');
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
            Mapa topográfico OpenTopoMap con todas tus salidas y biblioteca de tracks GPX pendientes para explorar.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowAdd((v) => !v)}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors"
        >
          {showAdd ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showAdd ? 'Cerrar' : 'Añadir Ruta GPX'}
        </button>
      </div>

      {/* Formulario añadir ruta de montaña */}
      {showAdd && (
        <form onSubmit={handleAddRoute} className="card-surface p-5 space-y-4">
          <h2 className="text-base font-bold">Guardar Nueva Ruta de Montaña</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="flex items-center gap-3 rounded-xl border border-dashed p-4 cursor-pointer hover:border-emerald-400" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-card-elevated)' }}>
                <Upload className="h-5 w-5 text-emerald-400 shrink-0" />
                <div className="text-xs">
                  <div className="font-semibold">
                    {file ? `Track seleccionado: ${file.name}` : 'Sube un archivo .GPX o .FIT (opcional, calcula km, desnivel y mapa automáticamente)'}
                  </div>
                  <div style={{ color: 'var(--text-muted)' }}>Puedes usar archivos de Wikiloc, Komoot, IGN o Strava</div>
                </div>
                <input
                  type="file"
                  accept=".gpx,.fit,.tcx"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>

            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                Nombre de la ruta {!file && '*'}
              </label>
              <input
                required={!file}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej. Peña Ubiña desde Tuiza"
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>

            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                Zona / Macizo
              </label>
              <input
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>

            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                Dificultad
              </label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as MountainRoute['difficulty'])}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              >
                <option value="Fácil">Fácil</option>
                <option value="Moderada">Moderada</option>
                <option value="Exigente">Exigente</option>
                <option value="Alta Montaña">Alta Montaña</option>
              </select>
            </div>

            {!file && (
              <>
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                    Distancia estimada (km)
                  </label>
                  <input
                    type="number"
                    min={1}
                    step={0.5}
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

            <div className="sm:col-span-2 lg:col-span-3">
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Fuentes, refugios, material recomendado, puntos técnicos..."
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-emerald-500 hover:bg-emerald-600 px-5 py-2 text-sm font-semibold text-white"
            >
              {saving ? 'Guardando...' : 'Guardar Ruta'}
            </button>
          </div>
        </form>
      )}

      {/* Mapa Global */}
      <div className="card-surface p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold flex items-center gap-2">
              <Compass className="h-4 w-4 text-emerald-400" />
              Mapa Topográfico de Tracks y Rutas
            </h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Verde: salidas montaña · Naranja: running · Discontinuo ámbar: rutas pendientes · Desnivel total montaña: +{totalMtnClimb} m
            </p>
          </div>
        </div>
        <MultiRouteMap activities={activities} routes={routes} heightClass="h-96" />
      </div>

      {/* Biblioteca de rutas planificadas */}
      <div className="space-y-3">
        <h2 className="text-lg font-bold">Biblioteca de Rutas de Montaña</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {routes.map((route) => (
            <div key={route.id} className="card-surface p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${
                      route.status === 'completed'
                        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                        : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                    }`}
                  >
                    {route.status === 'completed' ? 'Completada' : 'Pendiente'}
                  </span>
                  <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                    {route.difficulty}
                  </span>
                </div>

                <h3 className="font-bold text-base leading-snug">{route.name}</h3>
                <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  <MapPin className="h-3.5 w-3.5 text-emerald-400" />
                  <span>{route.region}</span>
                </div>

                {route.notes && (
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    {route.notes}
                  </p>
                )}
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center rounded-xl p-2.5 border tabular-nums" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-card-elevated)' }}>
                  <div>
                    <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Distancia</div>
                    <div className="text-xs font-bold">{formatDistanceKm(route.distanceMeters, 1)}</div>
                  </div>
                  <div>
                    <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Desnivel +</div>
                    <div className="text-xs font-bold text-emerald-400">+{route.elevationGain} m</div>
                  </div>
                  <div>
                    <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Cota Máx</div>
                    <div className="text-xs font-bold">{route.maxEle} m</div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => toggleStatus(route)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border hover:bg-slate-500/10"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    {route.status === 'pending' ? 'Marcar hecha' : 'Reabrir'}
                  </button>

                  <div className="flex items-center gap-1.5">
                    {route.points.length > 1 && (
                      <a
                        href={`/api/routes/${route.id}?format=gpx`}
                        className="p-2 rounded-lg border hover:bg-slate-500/10 text-emerald-400"
                        style={{ borderColor: 'var(--border-subtle)' }}
                        title="Descargar GPX"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => deleteRoute(route.id)}
                      className="p-2 rounded-lg border hover:bg-rose-500/15 text-rose-400"
                      style={{ borderColor: 'var(--border-subtle)' }}
                      title="Eliminar ruta"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

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
                  <strong>{formatDuration(act.durationSec)}</strong>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
