'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeftRight,
  BookmarkPlus,
  Check,
  Dumbbell,
  Flame,
  ListChecks,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Wrench,
} from 'lucide-react';
import WorkoutPlayer from '@/components/WorkoutPlayer';
import { ROUTINE_GOAL_LABELS } from '@/lib/home-workouts';
import type {
  Exercise,
  HomeEquipment,
  MuscleGroup,
  Routine,
  RoutineExerciseItem,
  RoutineGoal,
} from '@/types';

type CasaTab = 'generator' | 'equipment' | 'routines' | 'builder';

const MUSCLE_LABELS: Record<MuscleGroup, string> = {
  piernas: 'Piernas y Glúteo',
  pecho: 'Pecho',
  espalda: 'Espalda',
  hombros: 'Hombros',
  brazos: 'Brazos',
  core: 'Core / Abdomen',
  full_body: 'Full Body',
  movilidad: 'Movilidad',
};

export default function HomeWorkoutsPage() {
  const [tab, setTab] = useState<CasaTab>('generator');
  const [equipment, setEquipment] = useState<HomeEquipment[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [loading, setLoading] = useState(true);

  // Estado equipamiento nuevo
  const [newEqName, setNewEqName] = useState('');
  const [newEqCategory, setNewEqCategory] = useState<HomeEquipment['category']>('peso_libre');
  const [newEqDetails, setNewEqDetails] = useState('');

  // Estado generador
  const [goal, setGoal] = useState<RoutineGoal>('correr_montana');
  const [level, setLevel] = useState<'principiante' | 'intermedio' | 'avanzado'>('intermedio');
  const [durationMin, setDurationMin] = useState(30);
  const [sessionEquipmentIds, setSessionEquipmentIds] = useState<string[]>([]);
  const [generatedPlan, setGeneratedPlan] = useState<{
    name: string;
    goal: RoutineGoal;
    level: 'principiante' | 'intermedio' | 'avanzado';
    estimatedMinutes: number;
    equipmentIds: string[];
    items: RoutineExerciseItem[];
  } | null>(null);
  const [swapIndex, setSwapIndex] = useState<number | null>(null);
  const [swapOptions, setSwapOptions] = useState<Exercise[]>([]);
  const [variationSeed, setVariationSeed] = useState(1);
  const [savedBanner, setSavedBanner] = useState<string | null>(null);

  // Estado Constructor Manual + Ejercicio Personalizado
  const [builderName, setBuilderName] = useState('Mi Rutina Personalizada en Casa');
  const [builderGoal, setBuilderGoal] = useState<RoutineGoal>('fuerza_general');
  const [builderItems, setBuilderItems] = useState<RoutineExerciseItem[]>([]);
  const [onlyCompatibleLib, setOnlyCompatibleLib] = useState(true);
  const [muscleFilter, setMuscleFilter] = useState<string>('all');
  const [showNewEx, setShowNewEx] = useState(false);
  const [newExName, setNewExName] = useState('');
  const [newExMuscle, setNewExMuscle] = useState<MuscleGroup>('piernas');
  const [newExPattern, setNewExPattern] = useState<Exercise['pattern']>('rodilla');
  const [newExEquip, setNewExEquip] = useState<string[]>([]);
  const [newExReps, setNewExReps] = useState('10-12');
  const [newExInstructions, setNewExInstructions] = useState('');

  // Reproductor en vivo
  const [activeWorkout, setActiveWorkout] = useState<{
    routineId?: string;
    name: string;
    items: RoutineExerciseItem[];
  } | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [eqRes, exRes, rtRes] = await Promise.all([
      fetch('/api/equipment').then((r) => r.json()),
      fetch('/api/exercises').then((r) => r.json()),
      fetch('/api/routines').then((r) => r.json()),
    ]);
    const eqList: HomeEquipment[] = eqRes.equipment ?? [];
    setEquipment(eqList);
    setExercises(exRes.exercises ?? []);
    setRoutines(rtRes.routines ?? []);
    setSessionEquipmentIds(eqList.filter((e) => e.owned).map((e) => e.id));
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const ownedEquipment = equipment.filter((e) => e.owned);
  const ownedSet = new Set(ownedEquipment.map((e) => e.id));

  const equipmentNameMap = new Map(equipment.map((e) => [e.id, e.name]));

  const compatibleCount = exercises.filter((ex) => ex.requiredEquipment.every((id) => ownedSet.has(id))).length;

  async function toggleEquipmentOwned(item: HomeEquipment) {
    const nextOwned = !item.owned;
    const res = await fetch(`/api/equipment/${item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owned: nextOwned }),
    });
    if (res.ok) {
      const d = await res.json();
      setEquipment(d.equipment);
      setSessionEquipmentIds((prev) =>
        nextOwned ? Array.from(new Set([...prev, item.id])) : prev.filter((x) => x !== item.id)
      );
    }
  }

  async function addCustomEquipment(e: React.FormEvent) {
    e.preventDefault();
    if (!newEqName.trim()) return;
    const res = await fetch('/api/equipment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newEqName,
        category: newEqCategory,
        details: newEqDetails || null,
        owned: true,
      }),
    });
    if (res.ok) {
      const d = await res.json();
      setEquipment(d.equipment);
      setSessionEquipmentIds(d.equipment.filter((x: HomeEquipment) => x.owned).map((x: HomeEquipment) => x.id));
      setNewEqName('');
      setNewEqDetails('');
    }
  }

  async function deleteCustomEq(id: string) {
    const res = await fetch(`/api/equipment/${id}`, { method: 'DELETE' });
    if (res.ok) {
      const d = await res.json();
      setEquipment(d.equipment);
      setSessionEquipmentIds((prev) => prev.filter((x) => x !== id));
    }
  }

  function toggleSessionEquipment(id: string) {
    setSessionEquipmentIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleGenerate(seedOffset = 0) {
    const nextSeed = variationSeed + seedOffset;
    setVariationSeed(nextSeed);
    setSwapIndex(null);
    const res = await fetch('/api/routines/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goal,
        level,
        durationMin,
        equipmentIds: sessionEquipmentIds,
        variationSeed: nextSeed,
      }),
    });
    const d = await res.json();
    if (d.plan) {
      setGeneratedPlan(d.plan);
    }
  }

  async function openSwapModal(idx: number) {
    if (!generatedPlan) return;
    if (swapIndex === idx) {
      setSwapIndex(null);
      return;
    }
    const item = generatedPlan.items[idx];
    const excludeIds = generatedPlan.items.map((i) => i.exerciseId);
    const res = await fetch('/api/routines/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alternativesFor: item.exerciseId,
        equipmentIds: sessionEquipmentIds,
        excludeIds,
      }),
    });
    const d = await res.json();
    setSwapOptions(d.alternatives ?? []);
    setSwapIndex(idx);
  }

  function applySwap(idx: number, ex: Exercise) {
    if (!generatedPlan) return;
    const nextItems = generatedPlan.items.map((item, i) =>
      i === idx
        ? {
            exerciseId: ex.id,
            exerciseName: ex.name,
            muscleGroup: ex.muscleGroup,
            requiredEquipment: ex.requiredEquipment,
            sets: ex.defaultSets,
            reps: ex.defaultReps,
            suggestedWeightKg: ex.requiredEquipment.includes('dumbbells') ? 12 : undefined,
            restSeconds: ex.restSeconds,
            notes: ex.instructions,
          }
        : item
    );
    setGeneratedPlan({ ...generatedPlan, items: nextItems });
    setSwapIndex(null);
  }

  async function saveGeneratedRoutine() {
    if (!generatedPlan) return;
    const res = await fetch('/api/routines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: generatedPlan.name,
        goal: generatedPlan.goal,
        level: generatedPlan.level,
        estimatedMinutes: generatedPlan.estimatedMinutes,
        equipmentIds: generatedPlan.equipmentIds,
        items: generatedPlan.items,
        notes: 'Generada automáticamente según el material disponible en casa.',
      }),
    });
    if (res.ok) {
      const d = await res.json();
      setRoutines((prev) => [d.routine, ...prev]);
      setSavedBanner(`Rutina "${d.routine.name}" guardada en Mis Rutinas.`);
      setTimeout(() => setSavedBanner(null), 3500);
    }
  }

  async function saveManualRoutine(e: React.FormEvent) {
    e.preventDefault();
    if (builderItems.length === 0) return;
    const eqIds = Array.from(new Set(builderItems.flatMap((i) => i.requiredEquipment)));
    const res = await fetch('/api/routines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: builderName,
        goal: builderGoal,
        level,
        estimatedMinutes: Math.max(15, builderItems.length * 6),
        equipmentIds: eqIds,
        items: builderItems,
        notes: 'Creada manualmente en Bilifit.',
      }),
    });
    if (res.ok) {
      const d = await res.json();
      setRoutines((prev) => [d.routine, ...prev]);
      setBuilderItems([]);
      setTab('routines');
    }
  }

  async function handleCreateCustomExercise(e: React.FormEvent) {
    e.preventDefault();
    if (!newExName.trim()) return;
    const res = await fetch('/api/exercises', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newExName,
        muscleGroup: newExMuscle,
        pattern: newExPattern,
        requiredEquipment: newExEquip,
        defaultSets: 3,
        defaultReps: newExReps,
        restSeconds: 60,
        instructions: newExInstructions || 'Ejecución controlada manteniendo buena técnica.',
      }),
    });
    if (res.ok) {
      const d = await res.json();
      setExercises((prev) => [d.exercise, ...prev]);
      setNewExName('');
      setNewExInstructions('');
      setNewExEquip([]);
      setShowNewEx(false);
    }
  }

  async function deleteRoutine(id: string) {
    await fetch(`/api/routines/${id}`, { method: 'DELETE' });
    setRoutines((prev) => prev.filter((r) => r.id !== id));
  }

  const libraryExercises = exercises.filter((ex) => {
    if (onlyCompatibleLib && !ex.requiredEquipment.every((id) => ownedSet.has(id))) return false;
    if (muscleFilter !== 'all' && ex.muscleGroup !== muscleFilter) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Cabecera */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
            <Dumbbell className="h-6 w-6 text-purple-400" />
            Entrenamiento en Casa y Material Propio
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Selecciona el material que tienes en casa, genera rutinas adaptadas al instante o crea las tuyas con temporizador en vivo.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs font-semibold px-3.5 py-2 rounded-xl border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-card)' }}>
          <Wrench className="h-4 w-4 text-purple-400" />
          <span>{ownedEquipment.length} materiales activos</span>
          <span style={{ color: 'var(--text-muted)' }}>·</span>
          <span className="text-emerald-400">{compatibleCount} ejercicios compatibles</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b pb-3" style={{ borderColor: 'var(--border-subtle)' }}>
        {[
          { id: 'generator', label: 'Generar Rutina por Material', icon: Sparkles },
          { id: 'equipment', label: `Mi Material en Casa (${ownedEquipment.length})`, icon: Wrench },
          { id: 'routines', label: `Mis Rutinas (${routines.length})`, icon: ListChecks },
          { id: 'builder', label: 'Crear Rutina y Ejercicios', icon: Plus },
        ].map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id as CasaTab)}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-colors ${
                active
                  ? 'bg-purple-600 text-white shadow-sm shadow-purple-600/30'
                  : 'border hover:bg-sunken'
              }`}
              style={!active ? { borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' } : undefined}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {savedBanner && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300 flex items-center justify-between">
          <span>{savedBanner}</span>
          <button type="button" onClick={() => setTab('routines')} className="underline font-semibold text-xs">
            Ir a Mis Rutinas
          </button>
        </div>
      )}

      {/* TAB 1: GENERADOR INTELIGENTE */}
      {tab === 'generator' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 card-surface p-5 space-y-5">
            <div>
              <h2 className="text-base font-bold flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-purple-400" />
                Configura tu Rutina
              </h2>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                Solo generaremos ejercicios que puedas hacer 100% con los materiales marcados abajo.
              </p>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                Objetivo del entrenamiento
              </label>
              <select
                value={goal}
                onChange={(e) => setGoal(e.target.value as RoutineGoal)}
                className="w-full rounded-xl border px-3 py-2.5 text-sm"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              >
                {(Object.keys(ROUTINE_GOAL_LABELS) as RoutineGoal[]).map((g) => (
                  <option key={g} value={g}>
                    {ROUTINE_GOAL_LABELS[g].label}
                  </option>
                ))}
              </select>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {ROUTINE_GOAL_LABELS[goal].description}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Duración
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {[20, 30, 45, 60].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setDurationMin(m)}
                      className={`py-2 rounded-lg text-xs font-semibold border ${
                        durationMin === m ? 'bg-purple-600 text-white border-purple-600' : ''
                      }`}
                      style={durationMin !== m ? { borderColor: 'var(--border-subtle)' } : undefined}
                    >
                      {m} min
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                  Nivel
                </label>
                <div className="space-y-1.5">
                  {(['principiante', 'intermedio', 'avanzado'] as const).map((lv) => (
                    <button
                      key={lv}
                      type="button"
                      onClick={() => setLevel(lv)}
                      className={`w-full py-1.5 px-2 rounded-lg text-xs font-semibold capitalize border ${
                        level === lv ? 'bg-purple-600 text-white border-purple-600' : ''
                      }`}
                      style={level !== lv ? { borderColor: 'var(--border-subtle)' } : undefined}
                    >
                      {lv}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Selector rápido del material para esta sesión */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  Material disponible para esta sesión
                </label>
                <button
                  type="button"
                  onClick={() => setTab('equipment')}
                  className="text-xs text-purple-400 hover:underline"
                >
                  Editar inventario
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {equipment.map((eq) => {
                  const selected = sessionEquipmentIds.includes(eq.id);
                  return (
                    <button
                      key={eq.id}
                      type="button"
                      onClick={() => toggleSessionEquipment(eq.id)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        selected
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40'
                          : 'opacity-50 hover:opacity-80'
                      }`}
                      style={!selected ? { borderColor: 'var(--border-subtle)' } : undefined}
                    >
                      {selected && <Check className="h-3 w-3" />}
                      {eq.name}
                    </button>
                  );
                })}
              </div>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                El peso corporal siempre está incluido aunque desactives todo el material.
              </p>
            </div>

            <button
              type="button"
              onClick={() => handleGenerate(1)}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-primary hover:opacity-95 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-purple-600/20"
            >
              <Sparkles className="h-4 w-4" />
              Generar Rutina con mi Material
            </button>
          </div>

          {/* Resultado generado */}
          <div className="lg:col-span-7 card-surface p-5">
            {!generatedPlan ? (
              <div className="h-full min-h-[320px] flex flex-col items-center justify-center text-center p-6 space-y-3">
                <div className="h-14 w-14 rounded-2xl bg-purple-500/15 text-purple-400 flex items-center justify-center">
                  <Dumbbell className="h-7 w-7" />
                </div>
                <div className="font-bold text-base">Listo para generar tu rutina en casa</div>
                <p className="text-xs max-w-md" style={{ color: 'var(--text-muted)' }}>
                  Elige si quieres complementar tus salidas de <strong>correr / montaña</strong>, tus sesiones de{' '}
                  <strong>MyWhoosh</strong> o hacer fuerza general. Pulsa &quot;Generar Rutina con mi Material&quot; para obtener tu sesión.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-purple-400">
                      Rutina Generada · Nivel {generatedPlan.level}
                    </span>
                    <h3 className="text-lg font-bold">{generatedPlan.name}</h3>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleGenerate(1)}
                      className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-sunken"
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> Regenerar
                    </button>
                    <button
                      type="button"
                      onClick={saveGeneratedRoutine}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-purple-500/40 bg-purple-500/15 px-3 py-2 text-xs font-semibold text-purple-700 dark:text-purple-300 hover:bg-purple-500/25"
                    >
                      <BookmarkPlus className="h-3.5 w-3.5" /> Guardar Rutina
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setActiveWorkout({
                          name: generatedPlan.name,
                          items: generatedPlan.items,
                        })
                      }
                      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 px-4 py-2 text-xs font-bold text-white"
                    >
                      <Play className="h-3.5 w-3.5" /> Empezar Ahora
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  {generatedPlan.items.map((item, idx) => (
                    <div
                      key={`${item.exerciseId}-${idx}`}
                      className="rounded-xl border p-4 space-y-2"
                      style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-bold text-purple-400">#{idx + 1}</span>
                            <span className="font-semibold text-sm">{item.exerciseName}</span>
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-sunken" style={{ color: 'var(--text-secondary)' }}>
                              {MUSCLE_LABELS[item.muscleGroup]}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                            {item.requiredEquipment.length === 0 ? (
                              <span className="text-[11px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                                Sin material (peso corporal)
                              </span>
                            ) : (
                              item.requiredEquipment.map((eqId) => (
                                <span key={eqId} className="text-[11px] px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-700 dark:text-cyan-300">
                                  {equipmentNameMap.get(eqId) ?? eqId}
                                </span>
                              ))
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="text-right text-xs tabular-nums">
                            <div className="font-bold">
                              {item.sets} × {item.reps}
                              {item.suggestedWeightKg ? ` (${item.suggestedWeightKg} kg)` : ''}
                            </div>
                            <div style={{ color: 'var(--text-muted)' }}>Descanso {item.restSeconds}s</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => openSwapModal(idx)}
                            className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-sunken"
                            style={{ borderColor: 'var(--border-subtle)' }}
                            title="Cambiar por otro ejercicio compatible con tu material"
                          >
                            <ArrowLeftRight className="h-3.5 w-3.5" /> Cambiar
                          </button>
                        </div>
                      </div>

                      {item.notes && (
                        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                          {item.notes}
                        </p>
                      )}

                      {swapIndex === idx && (
                        <div className="pt-2 border-t space-y-2" style={{ borderColor: 'var(--border-subtle)' }}>
                          <div className="text-xs font-semibold text-purple-700 dark:text-purple-300">
                            Alternativas compatibles con tu material seleccionado:
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {swapOptions.map((alt) => (
                              <button
                                key={alt.id}
                                type="button"
                                onClick={() => applySwap(idx, alt)}
                                className="text-left rounded-lg border p-2.5 text-xs hover:border-purple-400 transition-colors"
                                style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-card)' }}
                              >
                                <div className="font-semibold">{alt.name}</div>
                                <div style={{ color: 'var(--text-muted)' }}>
                                  {alt.requiredEquipment.length === 0
                                    ? 'Peso corporal'
                                    : alt.requiredEquipment.map((id) => equipmentNameMap.get(id) ?? id).join(' + ')}
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: INVENTARIO DE MATERIAL EN CASA */}
      {tab === 'equipment' && (
        <div className="space-y-6">
          <div className="card-surface p-5 space-y-4">
            <div>
              <h2 className="text-base font-bold">Selecciona el Material que Tienes en Casa</h2>
              <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                Pulsa cada tarjeta para activar o desactivar. El generador y la biblioteca se adaptan automáticamente a tu inventario.
              </p>
            </div>

            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="h-24 rounded-xl bg-sunken animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {equipment.map((eq) => (
                  <div
                    key={eq.id}
                    onClick={() => toggleEquipmentOwned(eq)}
                    className={`cursor-pointer rounded-xl border p-4 transition-all flex flex-col justify-between gap-2 ${
                      eq.owned
                        ? 'border-emerald-500/50 bg-emerald-500/10'
                        : 'hover:border-slate-500/40 opacity-75'
                    }`}
                    style={!eq.owned ? { background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' } : undefined}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold text-sm">{eq.name}</div>
                        {eq.details && (
                          <div className="text-[11px] font-medium text-cyan-400 mt-0.5">{eq.details}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {eq.isCustom && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteCustomEq(eq.id);
                            }}
                            className="p-1 rounded text-rose-400 hover:bg-rose-500/15"
                            title="Eliminar material personalizado"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <span
                          className={`h-6 w-6 rounded-lg flex items-center justify-center text-xs ${
                            eq.owned ? 'bg-emerald-500 text-white' : 'border border-slate-600'
                          }`}
                        >
                          {eq.owned ? <Check className="h-4 w-4" /> : null}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                      {eq.description}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Añadir material propio personalizado */}
          <form onSubmit={addCustomEquipment} className="card-surface p-5 space-y-4">
            <h3 className="text-base font-bold">Añadir Otro Material Propio</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                required
                value={newEqName}
                onChange={(e) => setNewEqName(e.target.value)}
                placeholder="Ej. Chaleco lastrado 10 kg / Paralelas"
                className="rounded-xl border px-3 py-2 text-sm"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              />
              <select
                value={newEqCategory}
                onChange={(e) => setNewEqCategory(e.target.value as HomeEquipment['category'])}
                className="rounded-xl border px-3 py-2 text-sm"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              >
                <option value="peso_libre">Peso libre</option>
                <option value="calistenia">Calistenia / Suspensión</option>
                <option value="resistencia">Resistencia / Gomas</option>
                <option value="cardio">Cardio / Rodillo</option>
                <option value="accesorio">Accesorio</option>
              </select>
              <div className="flex gap-2">
                <input
                  value={newEqDetails}
                  onChange={(e) => setNewEqDetails(e.target.value)}
                  placeholder="Peso o detalle (opcional)"
                  className="flex-1 rounded-xl border px-3 py-2 text-sm"
                  style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
                />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 px-4 py-2 text-sm font-semibold text-white"
                >
                  <Plus className="h-4 w-4" /> Añadir
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* TAB 3: MIS RUTINAS GUARDADAS */}
      {tab === 'routines' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {routines.map((rt) => (
            <div key={rt.id} className="card-surface p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30">
                    {ROUTINE_GOAL_LABELS[rt.goal]?.label ?? rt.goal}
                  </span>
                  <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                    {rt.estimatedMinutes} min · {rt.timesCompleted}x completada
                  </span>
                </div>

                <h3 className="text-lg font-bold">{rt.name}</h3>
                {rt.notes && (
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {rt.notes}
                  </p>
                )}

                <div className="flex flex-wrap gap-1.5">
                  {rt.equipmentIds.map((eqId) => (
                    <span
                      key={eqId}
                      className={`text-[11px] px-2 py-0.5 rounded border ${
                        ownedSet.has(eqId)
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                      }`}
                    >
                      {equipmentNameMap.get(eqId) ?? eqId}
                    </span>
                  ))}
                </div>

                <div className="space-y-1.5 pt-2">
                  {rt.items.map((item, idx) => (
                    <div
                      key={`${item.exerciseId}-${idx}`}
                      className="flex items-center justify-between text-xs rounded-lg px-3 py-1.5"
                      style={{ background: 'var(--bg-card-elevated)' }}
                    >
                      <span className="font-medium truncate pr-2">{item.exerciseName}</span>
                      <span className="tabular-nums shrink-0" style={{ color: 'var(--text-muted)' }}>
                        {item.sets} × {item.reps}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                <button
                  type="button"
                  onClick={() => deleteRoutine(rt.id)}
                  className="inline-flex items-center gap-1 text-xs text-rose-400 hover:underline"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Eliminar
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setActiveWorkout({
                      routineId: rt.id,
                      name: rt.name,
                      items: rt.items,
                    })
                  }
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 px-4 py-2 text-xs font-bold text-white"
                >
                  <Play className="h-3.5 w-3.5" /> Empezar Entreno
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* TAB 4: CONSTRUCTOR MANUAL Y BIBLIOTECA */}
      {tab === 'builder' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 card-surface p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold">Biblioteca de Ejercicios ({libraryExercises.length})</h2>
              <button
                type="button"
                onClick={() => setShowNewEx((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white"
              >
                <Plus className="h-3.5 w-3.5" /> Nuevo Ejercicio
              </button>
            </div>

            {showNewEx && (
              <form
                onSubmit={handleCreateCustomExercise}
                className="rounded-xl border p-4 space-y-3"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              >
                <div className="text-xs font-bold text-purple-700 dark:text-purple-300">Crear Ejercicio Personalizado</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    required
                    value={newExName}
                    onChange={(e) => setNewExName(e.target.value)}
                    placeholder="Nombre del ejercicio"
                    className="rounded-lg border px-3 py-2 text-xs"
                    style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
                  />
                  <select
                    value={newExMuscle}
                    onChange={(e) => setNewExMuscle(e.target.value as MuscleGroup)}
                    className="rounded-lg border px-3 py-2 text-xs"
                    style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
                  >
                    {(Object.keys(MUSCLE_LABELS) as MuscleGroup[]).map((m) => (
                      <option key={m} value={m}>
                        {MUSCLE_LABELS[m]}
                      </option>
                    ))}
                  </select>
                  <select
                    value={newExPattern}
                    onChange={(e) => setNewExPattern(e.target.value as Exercise['pattern'])}
                    className="rounded-lg border px-3 py-2 text-xs"
                    style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
                  >
                    <option value="rodilla">Patrón: Rodilla / Sentadilla</option>
                    <option value="bisagra">Patrón: Bisagra de cadera</option>
                    <option value="unilateral">Patrón: Unilateral</option>
                    <option value="empuje">Patrón: Empuje</option>
                    <option value="traccion">Patrón: Tracción</option>
                    <option value="core">Patrón: Core</option>
                    <option value="cardio">Patrón: Cardio / HIIT</option>
                    <option value="movilidad">Patrón: Movilidad</option>
                  </select>
                  <input
                    value={newExReps}
                    onChange={(e) => setNewExReps(e.target.value)}
                    placeholder="Reps (ej. 10-12 o 40 seg)"
                    className="rounded-lg border px-3 py-2 text-xs"
                    style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
                  />
                </div>
                <div>
                  <div className="text-[11px] mb-1" style={{ color: 'var(--text-muted)' }}>
                    Material necesario (deja vacío si es sin material):
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {equipment.map((eq) => {
                      const active = newExEquip.includes(eq.id);
                      return (
                        <button
                          key={eq.id}
                          type="button"
                          onClick={() =>
                            setNewExEquip((prev) =>
                              prev.includes(eq.id) ? prev.filter((x) => x !== eq.id) : [...prev, eq.id]
                            )
                          }
                          className={`px-2 py-1 rounded text-[11px] border ${
                            active ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-700 dark:text-cyan-300' : ''
                          }`}
                          style={!active ? { borderColor: 'var(--border-subtle)' } : undefined}
                        >
                          {eq.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <input
                  value={newExInstructions}
                  onChange={(e) => setNewExInstructions(e.target.value)}
                  placeholder="Instrucciones o notas técnicas..."
                  className="w-full rounded-lg border px-3 py-2 text-xs"
                  style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
                />
                <div className="flex justify-end">
                  <button type="submit" className="rounded-lg bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-white">
                    Guardar Ejercicio
                  </button>
                </div>
              </form>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <select
                value={muscleFilter}
                onChange={(e) => setMuscleFilter(e.target.value)}
                className="rounded-lg border px-3 py-1.5 text-xs"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              >
                <option value="all">Todos los músculos</option>
                {(Object.keys(MUSCLE_LABELS) as MuscleGroup[]).map((m) => (
                  <option key={m} value={m}>
                    {MUSCLE_LABELS[m]}
                  </option>
                ))}
              </select>

              <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyCompatibleLib}
                  onChange={(e) => setOnlyCompatibleLib(e.target.checked)}
                  className="accent-purple-500"
                />
                Solo compatibles con mi material
              </label>
            </div>

            <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
              {libraryExercises.map((ex) => {
                const compatible = ex.requiredEquipment.every((id) => ownedSet.has(id));
                return (
                  <div
                    key={ex.id}
                    className="rounded-xl border p-3 flex items-center justify-between gap-3"
                    style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-sm">{ex.name}</span>
                        <span className="text-[11px] px-2 py-0.5 rounded bg-sunken" style={{ color: 'var(--text-secondary)' }}>
                          {MUSCLE_LABELS[ex.muscleGroup]}
                        </span>
                        {!compatible && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300">
                            Falta material
                          </span>
                        )}
                      </div>
                      <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        {ex.requiredEquipment.length === 0
                          ? 'Sin material'
                          : ex.requiredEquipment.map((id) => equipmentNameMap.get(id) ?? id).join(' + ')}{' '}
                        · {ex.defaultSets} × {ex.defaultReps}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setBuilderItems((prev) => [
                          ...prev,
                          {
                            exerciseId: ex.id,
                            exerciseName: ex.name,
                            muscleGroup: ex.muscleGroup,
                            requiredEquipment: ex.requiredEquipment,
                            sets: ex.defaultSets,
                            reps: ex.defaultReps,
                            suggestedWeightKg: ex.requiredEquipment.includes('dumbbells') ? 10 : undefined,
                            restSeconds: ex.restSeconds,
                            notes: ex.instructions,
                          },
                        ])
                      }
                      className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-purple-600/20 text-purple-700 dark:text-purple-300 border border-purple-500/30 px-3 py-1.5 text-xs font-semibold hover:bg-purple-600/30"
                    >
                      <Plus className="h-3.5 w-3.5" /> Añadir
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Borrador de rutina manual */}
          <form onSubmit={saveManualRoutine} className="lg:col-span-5 card-surface p-5 space-y-4 h-fit">
            <h2 className="text-base font-bold flex items-center gap-2">
              <Flame className="h-4 w-4 text-primary" />
              Tu Rutina en Construcción ({builderItems.length})
            </h2>

            <div className="space-y-3">
              <input
                required
                value={builderName}
                onChange={(e) => setBuilderName(e.target.value)}
                className="w-full rounded-xl border px-3 py-2 text-sm font-medium"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              />
              <select
                value={builderGoal}
                onChange={(e) => setBuilderGoal(e.target.value as RoutineGoal)}
                className="w-full rounded-xl border px-3 py-2 text-sm"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              >
                {(Object.keys(ROUTINE_GOAL_LABELS) as RoutineGoal[]).map((g) => (
                  <option key={g} value={g}>
                    {ROUTINE_GOAL_LABELS[g].label}
                  </option>
                ))}
              </select>
            </div>

            {builderItems.length === 0 ? (
              <div className="rounded-xl border border-dashed p-6 text-center text-xs" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>
                Pulsa &quot;+ Añadir&quot; en los ejercicios de la izquierda para ir montando tu rutina personalizada.
              </div>
            ) : (
              <div className="space-y-2">
                {builderItems.map((item, idx) => (
                  <div
                    key={`${item.exerciseId}-${idx}`}
                    className="rounded-xl border p-3 space-y-2"
                    style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-xs">{item.exerciseName}</span>
                      <button
                        type="button"
                        onClick={() => setBuilderItems((prev) => prev.filter((_, i) => i !== idx))}
                        className="text-rose-400 p-1"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <label className="space-y-0.5">
                        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Series</span>
                        <input
                          type="number"
                          min={1}
                          value={item.sets}
                          onChange={(e) =>
                            setBuilderItems((prev) =>
                              prev.map((it, i) => (i === idx ? { ...it, sets: Number(e.target.value) } : it))
                            )
                          }
                          className="w-full rounded border px-2 py-1 text-xs"
                          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
                        />
                      </label>
                      <label className="space-y-0.5">
                        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Reps</span>
                        <input
                          value={item.reps}
                          onChange={(e) =>
                            setBuilderItems((prev) =>
                              prev.map((it, i) => (i === idx ? { ...it, reps: e.target.value } : it))
                            )
                          }
                          className="w-full rounded border px-2 py-1 text-xs"
                          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
                        />
                      </label>
                      <label className="space-y-0.5">
                        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Kg sug.</span>
                        <input
                          type="number"
                          min={0}
                          value={item.suggestedWeightKg ?? 0}
                          onChange={(e) =>
                            setBuilderItems((prev) =>
                              prev.map((it, i) =>
                                i === idx ? { ...it, suggestedWeightKg: Number(e.target.value) || undefined } : it
                              )
                            )
                          }
                          className="w-full rounded border px-2 py-1 text-xs"
                          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              type="submit"
              disabled={builderItems.length === 0}
              className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 py-2.5 text-sm font-bold text-white"
            >
              Guardar Rutina Personalizada
            </button>
          </form>
        </div>
      )}

      {/* Reproductor de Entrenamiento en Vivo */}
      {activeWorkout && (
        <WorkoutPlayer
          routineId={activeWorkout.routineId}
          routineName={activeWorkout.name}
          items={activeWorkout.items}
          onClose={() => setActiveWorkout(null)}
          onCompleted={() => {
            setActiveWorkout(null);
            loadAll();
            setSavedBanner('¡Entrenamiento guardado en tu historial y carga física (TSS) actualizada!');
            setTimeout(() => setSavedBanner(null), 5000);
          }}
        />
      )}
    </div>
  );
}
