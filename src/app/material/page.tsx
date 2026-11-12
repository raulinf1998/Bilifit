'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Wrench } from 'lucide-react';
import { sportLabel } from '@/lib/metrics';
import type { GearItem } from '@/types';

const CATEGORY_LABELS: Record<GearItem['category'], string> = {
  running_shoes: 'Zapatillas Asfalto',
  trail_shoes: 'Zapatillas Trail / Montaña',
  road_bike: 'Bicicleta Carretera',
  mtb_bike: 'Bicicleta MTB / Gravel',
  indoor_trainer: 'Bici + Rodillo (MyWhoosh)',
};

export default function GearManagementPage() {
  const [gear, setGear] = useState<GearItem[]>([]);
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState<GearItem['category']>('running_shoes');
  const [defaultForSport, setDefaultForSport] = useState<string>('running');
  const [initialKm, setInitialKm] = useState(0);
  const [maxKm, setMaxKm] = useState(750);

  const load = useCallback(async () => {
    const res = await fetch('/api/gear');
    const d = await res.json();
    setGear(d.gear ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/gear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        brand,
        category,
        defaultForSport: defaultForSport || null,
        initialKm,
        maxKm,
      }),
    });
    if (res.ok) {
      setName('');
      setBrand('');
      setInitialKm(0);
      await load();
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/gear/${id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
          <Wrench className="h-6 w-6 text-amber-400" />
          Zapatillas, Bicis y Desgaste
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          Controla los kilómetros acumulados de tus zapatillas de asfalto/trail y de tu bici/rodillo de MyWhoosh.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {gear.map((g) => {
          const totalKm = Math.round((g.initialKm + g.trackedKm) * 10) / 10;
          const pct = Math.min(100, Math.round((totalKm / Math.max(1, g.maxKm)) * 100));
          const barColor = pct >= 90 ? 'bg-rose-500' : pct >= 70 ? 'bg-amber-400' : 'bg-emerald-400';

          return (
            <div key={g.id} className="card-surface p-5 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-[11px] font-semibold text-amber-400">
                    {CATEGORY_LABELS[g.category]}
                  </span>
                  <h3 className="font-bold text-base">{g.name}</h3>
                  {g.brand && (
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {g.brand}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(g.id)}
                  className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/15"
                  title="Eliminar material"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs tabular-nums">
                  <span className="font-semibold">{totalKm} km totales</span>
                  <span style={{ color: 'var(--text-muted)' }}>
                    {pct}% de {g.maxKm} km
                  </span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-muted)' }}>
                  <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
                  Inicial: {g.initialKm} km · Registrado en Bilifit: {g.trackedKm} km
                </div>
              </div>

              {g.defaultForSport && (
                <div className="text-[11px] px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-300 w-fit">
                  Por defecto para: {sportLabel(g.defaultForSport)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Añadir nuevo material deportivo */}
      <form onSubmit={handleAdd} className="card-surface p-5 space-y-4">
        <h2 className="text-base font-bold">Añadir Zapatillas o Bicicleta</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nombre (ej. Hoka Speedgoat 6)"
            className="rounded-xl border px-3 py-2 text-sm"
            style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
          />
          <input
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            placeholder="Marca (ej. Hoka)"
            className="rounded-xl border px-3 py-2 text-sm"
            style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as GearItem['category'])}
            className="rounded-xl border px-3 py-2 text-sm"
            style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
          >
            {(Object.keys(CATEGORY_LABELS) as GearItem['category'][]).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>

          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
              Asignar automáticamente al deporte
            </label>
            <select
              value={defaultForSport}
              onChange={(e) => setDefaultForSport(e.target.value)}
              className="w-full rounded-xl border px-3 py-2 text-sm"
              style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
            >
              <option value="">Ninguno</option>
              <option value="running">Correr</option>
              <option value="trail">Trail Running</option>
              <option value="mountain">Senderismo</option>
              <option value="walking">Caminar</option>
              <option value="mywhoosh">MyWhoosh</option>
              <option value="cycling">Ciclismo Exterior</option>
            </select>
          </div>

          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
              Km iniciales previos
            </label>
            <input
              type="number"
              min={0}
              value={initialKm}
              onChange={(e) => setInitialKm(Number(e.target.value))}
              className="w-full rounded-xl border px-3 py-2 text-sm"
              style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
            />
          </div>

          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
              Alerta de vida útil (km)
            </label>
            <input
              type="number"
              min={50}
              value={maxKm}
              onChange={(e) => setMaxKm(Number(e.target.value))}
              className="w-full rounded-xl border px-3 py-2 text-sm"
              style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-xl bg-[#fc4c02] hover:bg-[#e54400] px-5 py-2 text-sm font-semibold text-white"
          >
            <Plus className="h-4 w-4" /> Guardar Material
          </button>
        </div>
      </form>
    </div>
  );
}
