'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarRange, Check, Loader2, Plus, Trash2, Wrench, X } from 'lucide-react';
import { sportLabel } from '@/lib/metrics';
import {
  GEAR_SPORT_OPTIONS,
  dayEndIso,
  dayStartIso,
  defaultGearSports,
  gearRangePresets,
} from '@/lib/gear-scope';
import type { GearItem, SportType } from '@/types';

type AssignPreview = {
  updated: number;
  unchanged: number;
  affectedKm: number;
  projectedTotalKm: number;
  overMax: boolean;
};

const CATEGORY_LABELS: Record<GearItem['category'], string> = {
  running_shoes: 'Zapatillas Asfalto',
  trail_shoes: 'Zapatillas Trail / Montaña',
  road_bike: 'Bicicleta Carretera',
  mtb_bike: 'Bicicleta MTB / Gravel',
  indoor_trainer: 'Bici + Rodillo (MyWhoosh)',
};

/** Píldora de filtro (franja o deporte), con estado activo. */
function chipClass(active: boolean): string {
  return `rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
    active ? 'bg-amber-500/20 text-amber-300 border border-amber-500/45' : 'border hover:bg-sunken'
  }`;
}

export default function GearManagementPage() {
  const [gear, setGear] = useState<GearItem[]>([]);
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState<GearItem['category']>('running_shoes');
  const [defaultForSport, setDefaultForSport] = useState<string>('running');
  const [initialKm, setInitialKm] = useState(0);
  const [maxKm, setMaxKm] = useState(750);

  // Diálogo «Aplicar a sesiones…»: reparte el material por deporte y franja de fechas
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [rangePreset, setRangePreset] = useState('all');
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [assignSports, setAssignSports] = useState<SportType[]>([]);
  const [onlyWithoutGear, setOnlyWithoutGear] = useState(false);
  const [assignBusy, setAssignBusy] = useState(false);
  const [preview, setPreview] = useState<AssignPreview | null>(null);
  const [assignNotice, setAssignNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const presets = gearRangePresets();

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

  function buildAssignBody(mode: 'assign' | 'unassign', dryRun: boolean) {
    const preset = presets.find((p) => p.id === rangePreset);
    const from = rangePreset === 'custom' ? rangeFrom : (preset?.from ?? '');
    const to = rangePreset === 'custom' ? rangeTo : (preset?.to ?? '');
    return JSON.stringify({
      mode,
      dryRun,
      sports: assignSports,
      onlyWithoutGear,
      // Se mandan ya como límite ISO de día completo local: un 'YYYY-MM-DD' suelto se
      // leería como medianoche UTC y descolocaría el primer y el último día
      from: dayStartIso(from),
      to: dayEndIso(to),
    });
  }

  /** `dryRun` para contar antes de tocar nada; `assignFor` abre la ficha correspondiente. */
  async function runAssign(gearId: string, mode: 'assign' | 'unassign', dryRun: boolean) {
    setAssignBusy(true);
    setAssignNotice(null);
    try {
      const res = await fetch(`/api/gear/${gearId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: buildAssignBody(mode, dryRun),
      });
      const data = (await res.json().catch(() => null)) as
        | {
            error?: string;
            affectedKm?: number;
            projectedTotalKm?: number;
            overMax?: boolean;
            gear?: GearItem[];
            result?: { updated?: number; unchanged?: number };
          }
        | null;
      if (!res.ok) {
        setAssignNotice({ tone: 'warn', text: data?.error || 'No se pudo aplicar el material' });
        return;
      }
      if (data?.gear) setGear(data.gear);
      const updated = data?.result?.updated ?? 0;
      setPreview({
        updated,
        unchanged: data?.result?.unchanged ?? 0,
        affectedKm: data?.affectedKm ?? 0,
        projectedTotalKm: data?.projectedTotalKm ?? 0,
        overMax: Boolean(data?.overMax),
      });
      if (!dryRun) {
        setAssignNotice({
          tone: updated > 0 ? 'ok' : 'warn',
          text:
            updated > 0
              ? `${updated} ${updated === 1 ? 'sesión' : 'sesiones'} ${
                  mode === 'unassign' ? 'sin este material' : 'con este material'
                } (${data?.affectedKm ?? 0} km).`
              : 'Ninguna sesión del rango necesita cambio: ya estaba todo igual.',
        });
      }
    } catch {
      setAssignNotice({ tone: 'warn', text: 'Error de conexión con el servidor' });
    } finally {
      setAssignBusy(false);
    }
  }

  useEffect(() => {
    if (!assignFor) return;
    // Se re-cuenta con un dryRun corto: el número de sesiones cambia al mover la franja
    // o los deportes, y conviene verlo antes de aceptar.
    const timer = setTimeout(() => {
      void runAssign(assignFor, 'assign', true);
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignFor, rangePreset, rangeFrom, rangeTo, onlyWithoutGear, assignSports.join('|')]);

  function openAssignPanel(g: GearItem) {
    if (assignFor === g.id) {
      setAssignFor(null);
      setPreview(null);
      setAssignNotice(null);
      return;
    }
    setAssignFor(g.id);
    setRangePreset('all');
    setRangeFrom('');
    setRangeTo('');
    setAssignSports(defaultGearSports(g));
    setOnlyWithoutGear(false);
    setPreview(null);
    setAssignNotice(null);
  }

  function toggleAssignSport(sport: SportType) {
    setAssignSports((prev) => (prev.includes(sport) ? prev.filter((x) => x !== sport) : [...prev, sport]));
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
                <div className="text-[11px] px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 w-fit">
                  Por defecto para: {sportLabel(g.defaultForSport)}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={() => openAssignPanel(g)}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                    assignFor === g.id ? 'border-amber-500/45 bg-amber-500/15 text-amber-300' : 'hover:bg-sunken'
                  }`}
                  style={
                    assignFor === g.id
                      ? undefined
                      : { borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }
                  }
                  title="Asignar este material a todas las sesiones de sus deportes en una franja de fechas"
                >
                  <CalendarRange className="h-3.5 w-3.5" />
                  {assignFor === g.id ? 'Cerrar' : 'Aplicar a sesiones…'}
                </button>
              </div>

              {assignFor === g.id && (
                <div
                  className="rounded-xl border p-3.5 space-y-3"
                  style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-card-elevated)' }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs font-bold">Repartir «{g.name}» entre sus sesiones</div>
                    <button
                      type="button"
                      onClick={() => setAssignFor(null)}
                      className="p-1 rounded-lg hover:bg-sunken shrink-0"
                      aria-label="Cerrar"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {presets.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setRangePreset(p.id)}
                        className={chipClass(rangePreset === p.id)}
                        style={rangePreset === p.id ? undefined : { borderColor: 'var(--border-subtle)' }}
                      >
                        {p.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setRangePreset('custom')}
                      className={chipClass(rangePreset === 'custom')}
                      style={rangePreset === 'custom' ? undefined : { borderColor: 'var(--border-subtle)' }}
                    >
                      A medida
                    </button>
                  </div>

                  {rangePreset === 'custom' && (
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="date"
                        value={rangeFrom}
                        onChange={(e) => setRangeFrom(e.target.value)}
                        className="rounded-lg border px-2 py-1.5 text-xs tabular-nums"
                        style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
                      />
                      <input
                        type="date"
                        value={rangeTo}
                        onChange={(e) => setRangeTo(e.target.value)}
                        className="rounded-lg border px-2 py-1.5 text-xs tabular-nums"
                        style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
                      />
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      Deportes a los que aplicar
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {GEAR_SPORT_OPTIONS.map((sp) => (
                        <button
                          key={sp}
                          type="button"
                          onClick={() => toggleAssignSport(sp)}
                          className={chipClass(assignSports.includes(sp))}
                          style={assignSports.includes(sp) ? undefined : { borderColor: 'var(--border-subtle)' }}
                        >
                          {sportLabel(sp)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="flex items-start gap-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                    <input
                      type="checkbox"
                      checked={onlyWithoutGear}
                      onChange={(e) => setOnlyWithoutGear(e.target.checked)}
                      className="mt-0.5 accent-amber-500"
                    />
                    <span>
                      Sólo en las que no tengan material asignado
                      <span className="block" style={{ color: 'var(--text-muted)' }}>
                        Si no se marca, las del rango cambian a este material aunque llevaran otro.
                      </span>
                    </span>
                  </label>

                  <div
                    className="rounded-lg px-2.5 py-2 text-[11px] tabular-nums"
                    style={{ background: 'var(--bg-sunken)', color: 'var(--text-secondary)' }}
                  >
                    {assignBusy ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Loader2 className="h-3 w-3 animate-spin" /> Contando sesiones…
                      </span>
                    ) : preview && preview.updated > 0 ? (
                      <>
                        {preview.updated} {preview.updated === 1 ? 'sesión' : 'sesiones'} · {preview.affectedKm} km ·
                        quedará {preview.projectedTotalKm} de {g.maxKm} km
                        {preview.unchanged > 0 ? ` · ${preview.unchanged} ya lo llevaban` : ''}
                        {preview.overMax ? ' · por encima de la vida útil' : ''}
                      </>
                    ) : (
                      'Ninguna sesión del rango necesita este cambio.'
                    )}
                  </div>

                  {assignNotice && (
                    <div
                      className={`rounded-lg px-2.5 py-2 text-[11px] ${
                        assignNotice.tone === 'ok'
                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                      }`}
                    >
                      {assignNotice.text}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={assignBusy || !preview || preview.updated === 0}
                      onClick={() => runAssign(g.id, 'assign', false)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-3 py-1.5 text-[11px] font-bold text-black disabled:opacity-50 hover:bg-amber-400"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Aplicar a {preview?.updated ?? 0} {preview?.updated === 1 ? 'sesión' : 'sesiones'}
                    </button>
                    <button
                      type="button"
                      disabled={assignBusy}
                      onClick={() => runAssign(g.id, 'unassign', false)}
                      className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[11px] font-semibold hover:bg-sunken disabled:opacity-50"
                      style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
                      title="Quitar este material sólo de las sesiones del rango y los deportes marcados. No recupera la asignación anterior: esas sesiones se quedan sin material."
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Quitar de esas sesiones
                    </button>
                  </div>
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
            className="inline-flex items-center gap-2 rounded-xl bg-primary hover:bg-primaryhover px-5 py-2 text-sm font-semibold text-onprimary"
          >
            <Plus className="h-4 w-4" /> Guardar Material
          </button>
        </div>
      </form>
    </div>
  );
}
