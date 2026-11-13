'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  BookmarkPlus,
  Camera,
  Check,
  Dumbbell,
  Flame,
  Image as ImageIcon,
  ListChecks,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Wrench,
  X,
  ZoomIn,
} from 'lucide-react';
import ImageLightboxModal from '@/components/ImageLightboxModal';
import ImageUploadControl from '@/components/ImageUploadControl';
import WorkoutPlayer, { type LastExerciseLogRef } from '@/components/WorkoutPlayer';
import {
  isSingleDumbbellByDefault,
  resolveIsPerDumbbell,
  ROUTINE_GOAL_LABELS,
} from '@/lib/home-workouts';
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
  const [lastExerciseLogs, setLastExerciseLogs] = useState<Record<string, LastExerciseLogRef>>({});
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
  const [builderCoverImageUrl, setBuilderCoverImageUrl] = useState<string | null>(null);
  const [builderItems, setBuilderItems] = useState<RoutineExerciseItem[]>([]);
  const [onlyCompatibleLib, setOnlyCompatibleLib] = useState(true);
  const [muscleFilter, setMuscleFilter] = useState<string>('all');
  const [showNewEx, setShowNewEx] = useState(false);
  const [newExName, setNewExName] = useState('');
  const [newExMuscle, setNewExMuscle] = useState<MuscleGroup>('piernas');
  const [newExPattern, setNewExPattern] = useState<Exercise['pattern']>('rodilla');
  const [newExEquip, setNewExEquip] = useState<string[]>([]);
  const [newExPerDumbbell, setNewExPerDumbbell] = useState(true);
  const [newExReps, setNewExReps] = useState('10-12');
  const [newExInstructions, setNewExInstructions] = useState('');
  const [newExImageUrl, setNewExImageUrl] = useState<string | null>(null);

  // Modal de edición de rutina e imágenes
  const [editingRoutine, setEditingRoutine] = useState<Routine | null>(null);
  const [savingRoutineEdit, setSavingRoutineEdit] = useState(false);

  // Modal lightbox de imagen ampliada / cambio de foto
  const [lightbox, setLightbox] = useState<{
    exerciseId?: string;
    imageUrl: string | null | undefined;
    title: string;
    subtitle?: string;
    description?: string;
    canEdit?: boolean;
  } | null>(null);

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
    setLastExerciseLogs(rtRes.lastExerciseLogs ?? {});
    setSessionEquipmentIds(eqList.filter((e) => e.owned).map((e) => e.id));
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const requestedTab = new URLSearchParams(window.location.search).get('tab');
    if (
      requestedTab === 'generator' ||
      requestedTab === 'equipment' ||
      requestedTab === 'routines' ||
      requestedTab === 'builder'
    ) {
      setTab(requestedTab);
    }
  }, []);

  const ownedEquipment = equipment.filter((e) => e.owned);
  const ownedSet = new Set(ownedEquipment.map((e) => e.id));
  const equipmentNameMap = new Map(equipment.map((e) => [e.id, e.name]));

  const exerciseImagesMap = useMemo(() => {
    const map: Record<string, string | null | undefined> = {};
    for (const ex of exercises) {
      map[ex.id] = ex.imageUrl ?? null;
    }
    return map;
  }, [exercises]);

  const exercisePerDumbbellMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const ex of exercises) {
      map[ex.id] = Boolean(ex.perDumbbell);
    }
    return map;
  }, [exercises]);

  const resolveItemImage = useCallback(
    (exerciseId: string, itemImageUrl?: string | null): string | null => {
      const isDefaultAsset = Boolean(itemImageUrl && itemImageUrl.startsWith(`/exercises/${exerciseId}.`));
      return (isDefaultAsset ? exerciseImagesMap[exerciseId] : itemImageUrl) || exerciseImagesMap[exerciseId] || null;
    },
    [exerciseImagesMap]
  );

  const compatibleCount = exercises.filter((ex) => ex.requiredEquipment.every((id) => ownedSet.has(id))).length;

  async function updateExerciseImage(exerciseId: string, nextUrl: string | null) {
    const res = await fetch(`/api/exercises/${encodeURIComponent(exerciseId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: nextUrl }),
    });
    if (res.ok) {
      const data = await res.json();
      const updatedEx: Exercise | undefined = data.exercise;
      if (updatedEx) {
        setExercises((prev) => prev.map((e) => (e.id === exerciseId ? updatedEx : e)));
        setLightbox((prev) =>
          prev && prev.exerciseId === exerciseId ? { ...prev, imageUrl: updatedEx.imageUrl ?? null } : prev
        );
      }
    }
  }

  async function saveEditingRoutine(e: React.FormEvent) {
    e.preventDefault();
    if (!editingRoutine) return;
    setSavingRoutineEdit(true);
    try {
      const res = await fetch(`/api/routines/${editingRoutine.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editingRoutine.name.trim() || 'Rutina',
          notes: editingRoutine.notes ?? null,
          coverImageUrl: editingRoutine.coverImageUrl ?? null,
          items: editingRoutine.items,
        }),
      });
      if (res.ok) {
        const d = await res.json();
        setRoutines((prev) => prev.map((r) => (r.id === d.routine.id ? d.routine : r)));
        setEditingRoutine(null);
        setSavedBanner('Rutina e imágenes actualizadas.');
        setTimeout(() => setSavedBanner(null), 3500);
      }
    } finally {
      setSavingRoutineEdit(false);
    }
  }

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
            perDumbbell: Boolean(ex.perDumbbell),
            restSeconds: ex.restSeconds,
            notes: ex.instructions,
            imageUrl: ex.imageUrl ?? null,
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
        coverImageUrl: builderCoverImageUrl,
        notes: 'Creada manualmente en Bilifit.',
      }),
    });
    if (res.ok) {
      const d = await res.json();
      setRoutines((prev) => [d.routine, ...prev]);
      setBuilderItems([]);
      setBuilderCoverImageUrl(null);
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
        imageUrl: newExImageUrl,
        perDumbbell: newExEquip.includes('dumbbells') && newExPerDumbbell,
      }),
    });
    if (res.ok) {
      const d = await res.json();
      setExercises((prev) => [d.exercise, ...prev]);
      setNewExName('');
      setNewExInstructions('');
      setNewExEquip([]);
      setNewExPerDumbbell(true);
      setNewExImageUrl(null);
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2.5">
            <Dumbbell className="h-6 w-6 text-purple-400 shrink-0" />
            <span>Entrenamiento en Casa y Rutinas</span>
          </h1>
          <p className="text-xs sm:text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Guía visual de cada ejercicio, rutinas listas para usar en el teléfono y seguimiento de pesos diarios.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs font-semibold px-3.5 py-2 rounded-xl border w-fit" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-card)' }}>
          <Wrench className="h-4 w-4 text-purple-400 shrink-0" />
          <span>{ownedEquipment.length} materiales</span>
          <span style={{ color: 'var(--text-muted)' }}>·</span>
          <span className="text-emerald-400">{compatibleCount} ejercicios</span>
        </div>
      </div>

      {/* Tabs adaptadas a móvil y PC */}
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 border-b pb-3" style={{ borderColor: 'var(--border-subtle)' }}>
        {[
          { id: 'generator', label: 'Generar Rutina', fullLabel: 'Generar Rutina por Material', icon: Sparkles },
          { id: 'equipment', label: `Material (${ownedEquipment.length})`, fullLabel: `Mi Material en Casa (${ownedEquipment.length})`, icon: Wrench },
          { id: 'routines', label: `Mis Rutinas (${routines.length})`, fullLabel: `Mis Rutinas (${routines.length})`, icon: ListChecks },
          { id: 'builder', label: 'Crear y Fotos', fullLabel: 'Crear Rutina y Ejercicios', icon: Plus },
        ].map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id as CasaTab)}
              className={`inline-flex items-center justify-center sm:justify-start gap-2 px-3 sm:px-4 py-2.5 sm:py-2 rounded-xl text-xs sm:text-sm font-semibold transition-colors min-h-[42px] ${
                active
                  ? 'bg-purple-600 text-white shadow-sm shadow-purple-600/30'
                  : 'border hover:bg-sunken'
              }`}
              style={!active ? { borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' } : undefined}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="sm:hidden truncate">{t.label}</span>
              <span className="hidden sm:inline">{t.fullLabel}</span>
            </button>
          );
        })}
      </div>

      {savedBanner && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300 flex items-center justify-between gap-3">
          <span>{savedBanner}</span>
          <button type="button" onClick={() => setTab('routines')} className="underline font-semibold text-xs shrink-0">
            Ir a Mis Rutinas
          </button>
        </div>
      )}

      {/* TAB 1: GENERADOR INTELIGENTE */}
      {tab === 'generator' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 card-surface p-4 sm:p-5 space-y-5">
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
                className="w-full rounded-xl border px-3 py-2.5 text-base sm:text-sm"
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
                      className={`py-2 rounded-lg text-xs font-semibold border min-h-[38px] ${
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
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-primary hover:opacity-95 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-purple-600/20 min-h-[46px]"
            >
              <Sparkles className="h-4 w-4" />
              Generar Rutina con mi Material
            </button>
          </div>

          {/* Resultado generado */}
          <div className="lg:col-span-7 card-surface p-4 sm:p-5">
            {!generatedPlan ? (
              <div className="h-full min-h-[280px] flex flex-col items-center justify-center text-center p-4 sm:p-6 space-y-3">
                <div className="h-14 w-14 rounded-2xl bg-purple-500/15 text-purple-400 flex items-center justify-center">
                  <Dumbbell className="h-7 w-7" />
                </div>
                <div className="font-bold text-base">Listo para generar tu rutina en casa</div>
                <p className="text-xs max-w-md" style={{ color: 'var(--text-muted)' }}>
                  Elige si quieres complementar tus salidas de <strong>correr / montaña</strong>, tus sesiones de{' '}
                  <strong>MyWhoosh</strong> o hacer fuerza general. Pulsa &quot;Generar Rutina con mi Material&quot; para obtener tu sesión.
                </p>
                {routines.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setTab('routines')}
                    className="inline-flex items-center gap-1.5 rounded-xl border px-4 py-2.5 text-xs font-semibold hover:bg-sunken min-h-[42px]"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <ListChecks className="h-3.5 w-3.5 text-purple-400" />
                    Ver Mis Rutinas ({routines.length})
                  </button>
                )}
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

                  <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                    <button
                      type="button"
                      onClick={() => handleGenerate(1)}
                      className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-sunken min-h-[38px]"
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> Regenerar
                    </button>
                    <button
                      type="button"
                      onClick={saveGeneratedRoutine}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-purple-500/40 bg-purple-500/15 px-3 py-2 text-xs font-semibold text-purple-700 dark:text-purple-300 hover:bg-purple-500/25 min-h-[38px]"
                    >
                      <BookmarkPlus className="h-3.5 w-3.5" /> Guardar
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setActiveWorkout({
                          name: generatedPlan.name,
                          items: generatedPlan.items,
                        })
                      }
                      className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 px-4 py-2 text-xs font-bold text-white min-h-[40px]"
                    >
                      <Play className="h-3.5 w-3.5" /> Empezar Ahora
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  {generatedPlan.items.map((item, idx) => {
                    const imgUrl = resolveItemImage(item.exerciseId, item.imageUrl);
                    const perDb = resolveIsPerDumbbell(item, exercisePerDumbbellMap[item.exerciseId]);
                    const isSingleDb =
                      !perDb &&
                      (isSingleDumbbellByDefault(item.exerciseId) || item.requiredEquipment.includes('dumbbells'));
                    return (
                      <div
                        key={`${item.exerciseId}-${idx}`}
                        className="rounded-xl border p-3.5 sm:p-4 space-y-2"
                        style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
                      >
                        <div className="flex items-start gap-3">
                          {imgUrl && (
                            <button
                              type="button"
                              onClick={() =>
                                setLightbox({
                                  exerciseId: item.exerciseId,
                                  imageUrl: imgUrl,
                                  title: `${idx + 1}. ${item.exerciseName}`,
                                  subtitle: `${item.sets} × ${item.reps}`,
                                  description: item.notes,
                                  canEdit: true,
                                })
                              }
                              className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-xl overflow-hidden border shrink-0 bg-[#161b26]"
                              style={{ borderColor: 'var(--border-subtle)' }}
                              title="Toca para ampliar imagen"
                            >
                              <img src={imgUrl} alt={item.exerciseName} className="w-full h-full object-cover" />
                              <span className="absolute bottom-0.5 right-0.5 h-4 w-4 rounded bg-black/70 text-white flex items-center justify-center">
                                <ZoomIn className="h-2.5 w-2.5" />
                              </span>
                            </button>
                          )}

                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-xs font-bold text-purple-400">#{idx + 1}</span>
                                  <span className="font-semibold text-sm">{item.exerciseName}</span>
                                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-sunken" style={{ color: 'var(--text-secondary)' }}>
                                    {MUSCLE_LABELS[item.muscleGroup]}
                                  </span>
                                  {perDb && (
                                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded border border-purple-500/35 bg-purple-500/15 text-purple-700 dark:text-purple-300">
                                      Por mancuerna (×2)
                                    </span>
                                  )}
                                  {isSingleDb && (
                                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded border border-cyan-500/35 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
                                      1 mancuerna
                                    </span>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-1.5 mt-1">
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

                              <div className="flex items-center gap-2 shrink-0">
                                <div className="text-right text-xs tabular-nums">
                                  <div className="font-bold">
                                    {item.sets} × {item.reps}
                                    {item.suggestedWeightKg ? ` (${item.suggestedWeightKg} kg${perDb ? ' c/u' : ''})` : ''}
                                  </div>
                                  <div style={{ color: 'var(--text-muted)' }}>Descanso {item.restSeconds}s</div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => openSwapModal(idx)}
                                  className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-sunken min-h-[34px]"
                                  style={{ borderColor: 'var(--border-subtle)' }}
                                  title="Cambiar por otro ejercicio compatible con tu material"
                                >
                                  <ArrowLeftRight className="h-3.5 w-3.5" /> Cambiar
                                </button>
                              </div>
                            </div>

                            {item.notes && (
                              <p className="text-xs leading-relaxed mt-1.5" style={{ color: 'var(--text-secondary)' }}>
                                {item.notes}
                              </p>
                            )}
                          </div>
                        </div>

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
                                  className="flex items-center gap-2.5 text-left rounded-lg border p-2 text-xs hover:border-purple-400 transition-colors"
                                  style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-card)' }}
                                >
                                  {alt.imageUrl && (
                                    <img
                                      src={alt.imageUrl}
                                      alt={alt.name}
                                      className="w-10 h-10 rounded-lg object-cover bg-[#161b26] shrink-0"
                                    />
                                  )}
                                  <div className="min-w-0">
                                    <div className="font-semibold truncate">{alt.name}</div>
                                    <div className="truncate" style={{ color: 'var(--text-muted)' }}>
                                      {alt.requiredEquipment.length === 0
                                        ? 'Peso corporal'
                                        : alt.requiredEquipment.map((id) => equipmentNameMap.get(id) ?? id).join(' + ')}
                                    </div>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: INVENTARIO DE MATERIAL EN CASA */}
      {tab === 'equipment' && (
        <div className="space-y-6">
          <div className="card-surface p-4 sm:p-5 space-y-4">
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
          <form onSubmit={addCustomEquipment} className="card-surface p-4 sm:p-5 space-y-4">
            <h3 className="text-base font-bold">Añadir Otro Material Propio</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                required
                value={newEqName}
                onChange={(e) => setNewEqName(e.target.value)}
                placeholder="Ej. Chaleco lastrado 10 kg / Paralelas"
                className="rounded-xl border px-3 py-2 text-base sm:text-sm"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              />
              <select
                value={newEqCategory}
                onChange={(e) => setNewEqCategory(e.target.value as HomeEquipment['category'])}
                className="rounded-xl border px-3 py-2 text-base sm:text-sm"
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
                  className="flex-1 min-w-0 rounded-xl border px-3 py-2 text-base sm:text-sm"
                  style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
                />
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 px-4 py-2 text-sm font-semibold text-white shrink-0"
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
            <div key={rt.id} className="card-surface p-4 sm:p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-3">
                {rt.coverImageUrl && (
                  <button
                    type="button"
                    onClick={() =>
                      setLightbox({
                        imageUrl: rt.coverImageUrl,
                        title: rt.name,
                        subtitle: ROUTINE_GOAL_LABELS[rt.goal]?.label ?? rt.goal,
                        description: rt.notes ?? undefined,
                        canEdit: false,
                      })
                    }
                    className="relative w-full h-36 sm:h-44 rounded-xl overflow-hidden border bg-[#161b26] block"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <img src={rt.coverImageUrl} alt={rt.name} className="w-full h-full object-cover" />
                    <span className="absolute bottom-2 right-2 h-7 w-7 rounded-lg bg-black/70 text-white flex items-center justify-center">
                      <ZoomIn className="h-4 w-4" />
                    </span>
                  </button>
                )}

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

                {/* Lista de ejercicios con miniatura visual clicable */}
                <div className="space-y-1.5 pt-1">
                  {rt.items.map((item, idx) => {
                    const thumbUrl = resolveItemImage(item.exerciseId, item.imageUrl);
                    const perDb = resolveIsPerDumbbell(item, exercisePerDumbbellMap[item.exerciseId]);
                    const isSingleDb =
                      !perDb &&
                      (isSingleDumbbellByDefault(item.exerciseId) || item.requiredEquipment.includes('dumbbells'));
                    return (
                      <div
                        key={`${item.exerciseId}-${idx}`}
                        className="flex items-center gap-2.5 text-xs rounded-xl px-2.5 py-2"
                        style={{ background: 'var(--bg-card-elevated)' }}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setLightbox({
                              exerciseId: item.exerciseId,
                              imageUrl: thumbUrl,
                              title: `${idx + 1}. ${item.exerciseName}`,
                              subtitle: `${item.sets} × ${item.reps} · Descanso ${item.restSeconds}s`,
                              description: item.notes,
                              canEdit: true,
                            })
                          }
                          className="relative w-11 h-11 rounded-lg overflow-hidden border shrink-0 bg-[#161b26] flex items-center justify-center"
                          style={{ borderColor: 'var(--border-subtle)' }}
                          title="Toca para ver la imagen en grande o subir foto"
                        >
                          {thumbUrl ? (
                            <img src={thumbUrl} alt={item.exerciseName} className="w-full h-full object-cover" />
                          ) : (
                            <Camera className="h-4 w-4 text-purple-400" />
                          )}
                        </button>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-semibold text-xs sm:text-[13px] truncate">
                              {idx + 1}. {item.exerciseName}
                            </span>
                            {perDb && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-purple-500/35 bg-purple-500/15 text-purple-700 dark:text-purple-300 shrink-0">
                                Por mancuerna (×2)
                              </span>
                            )}
                            {isSingleDb && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-cyan-500/35 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 shrink-0">
                                1 mancuerna
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
                            {item.sets} × {item.reps}
                            {typeof item.suggestedWeightKg === 'number' && item.suggestedWeightKg > 0
                              ? ` (${item.suggestedWeightKg} kg${perDb ? ' c/u' : ''})`
                              : ''}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setEditingRoutine({ ...rt, items: rt.items.map((it) => ({ ...it })) })}
                    className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold hover:bg-sunken min-h-[36px]"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <Pencil className="h-3.5 w-3.5 text-purple-400" /> Imágenes / Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteRoutine(rt.id)}
                    className="inline-flex items-center gap-1 text-xs text-rose-400 hover:underline min-h-[36px]"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Eliminar
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setActiveWorkout({
                      routineId: rt.id,
                      name: rt.name,
                      items: rt.items,
                    })
                  }
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white min-h-[44px]"
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
          <div className="lg:col-span-7 card-surface p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold">Biblioteca de Ejercicios ({libraryExercises.length})</h2>
              <button
                type="button"
                onClick={() => setShowNewEx((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-purple-600 px-3.5 py-2 text-xs font-semibold text-white min-h-[38px]"
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
                    className="rounded-lg border px-3 py-2 text-base sm:text-xs"
                    style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
                  />
                  <select
                    value={newExMuscle}
                    onChange={(e) => setNewExMuscle(e.target.value as MuscleGroup)}
                    className="rounded-lg border px-3 py-2 text-base sm:text-xs"
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
                    className="rounded-lg border px-3 py-2 text-base sm:text-xs"
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
                    className="rounded-lg border px-3 py-2 text-base sm:text-xs"
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
                  {newExEquip.includes('dumbbells') && (
                    <label className="mt-2 inline-flex items-center gap-2 text-[11px] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newExPerDumbbell}
                        onChange={(e) => setNewExPerDumbbell(e.target.checked)}
                        className="accent-purple-500"
                      />
                      <span>Usa 2 mancuernas (anotar peso por mancuerna y multiplicar volumen ×2)</span>
                    </label>
                  )}
                </div>
                <input
                  value={newExInstructions}
                  onChange={(e) => setNewExInstructions(e.target.value)}
                  placeholder="Instrucciones o notas técnicas..."
                  className="w-full rounded-lg border px-3 py-2 text-base sm:text-xs"
                  style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
                />
                <div className="space-y-1.5">
                  <div className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
                    Imagen del ejercicio (opcional)
                  </div>
                  <ImageUploadControl
                    label="Foto del ejercicio"
                    value={newExImageUrl}
                    onChange={setNewExImageUrl}
                    compact
                  />
                </div>
                <div className="flex justify-end">
                  <button type="submit" className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-white min-h-[38px]">
                    Guardar Ejercicio
                  </button>
                </div>
              </form>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <select
                value={muscleFilter}
                onChange={(e) => setMuscleFilter(e.target.value)}
                className="rounded-lg border px-3 py-2 text-base sm:text-xs"
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

            <div className="space-y-2 max-h-[540px] overflow-y-auto pr-1">
              {libraryExercises.map((ex) => {
                const compatible = ex.requiredEquipment.every((id) => ownedSet.has(id));
                const perDb = resolveIsPerDumbbell({ exerciseId: ex.id, perDumbbell: ex.perDumbbell });
                const isSingleDb =
                  !perDb &&
                  (isSingleDumbbellByDefault(ex.id) || ex.requiredEquipment.includes('dumbbells'));
                return (
                  <div
                    key={ex.id}
                    className="rounded-xl border p-2.5 sm:p-3 flex items-center justify-between gap-2.5"
                    style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() =>
                          setLightbox({
                            exerciseId: ex.id,
                            imageUrl: ex.imageUrl,
                            title: ex.name,
                            subtitle: `${MUSCLE_LABELS[ex.muscleGroup]} · ${ex.defaultSets} × ${ex.defaultReps}`,
                            description: ex.instructions,
                            canEdit: true,
                          })
                        }
                        className="relative w-12 h-12 rounded-xl overflow-hidden border shrink-0 bg-[#161b26] flex items-center justify-center"
                        style={{ borderColor: 'var(--border-subtle)' }}
                        title="Toca para ampliar o cambiar foto"
                      >
                        {ex.imageUrl ? (
                          <img src={ex.imageUrl} alt={ex.name} className="w-full h-full object-cover" />
                        ) : (
                          <Camera className="h-4 w-4 text-purple-400" />
                        )}
                      </button>

                      <div className="space-y-0.5 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold text-xs sm:text-sm truncate">{ex.name}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-sunken" style={{ color: 'var(--text-secondary)' }}>
                            {MUSCLE_LABELS[ex.muscleGroup]}
                          </span>
                          {perDb && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-purple-500/35 bg-purple-500/15 text-purple-700 dark:text-purple-300">
                              Por mancuerna (×2)
                            </span>
                          )}
                          {isSingleDb && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-cyan-500/35 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
                              1 mancuerna
                            </span>
                          )}
                          {!compatible && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300">
                              Falta material
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                          {ex.requiredEquipment.length === 0
                            ? 'Sin material'
                            : ex.requiredEquipment.map((id) => equipmentNameMap.get(id) ?? id).join(' + ')}{' '}
                          · {ex.defaultSets} × {ex.defaultReps}
                        </div>
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
                            perDumbbell: perDb,
                            restSeconds: ex.restSeconds,
                            notes: ex.instructions,
                            imageUrl: ex.imageUrl ?? null,
                          },
                        ])
                      }
                      className="shrink-0 inline-flex items-center gap-1 rounded-xl bg-purple-600/20 text-purple-700 dark:text-purple-300 border border-purple-500/30 px-3 py-2 text-xs font-semibold hover:bg-purple-600/30 min-h-[38px]"
                    >
                      <Plus className="h-3.5 w-3.5" /> Añadir
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Borrador de rutina manual */}
          <form onSubmit={saveManualRoutine} className="lg:col-span-5 card-surface p-4 sm:p-5 space-y-4 h-fit">
            <h2 className="text-base font-bold flex items-center gap-2">
              <Flame className="h-4 w-4 text-primary" />
              Tu Rutina en Construcción ({builderItems.length})
            </h2>

            <div className="space-y-3">
              <input
                required
                value={builderName}
                onChange={(e) => setBuilderName(e.target.value)}
                className="w-full rounded-xl border px-3 py-2 text-base sm:text-sm font-medium"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              />
              <select
                value={builderGoal}
                onChange={(e) => setBuilderGoal(e.target.value as RoutineGoal)}
                className="w-full rounded-xl border px-3 py-2 text-base sm:text-sm"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              >
                {(Object.keys(ROUTINE_GOAL_LABELS) as RoutineGoal[]).map((g) => (
                  <option key={g} value={g}>
                    {ROUTINE_GOAL_LABELS[g].label}
                  </option>
                ))}
              </select>

              <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-card-elevated)' }}>
                <div className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                  <ImageIcon className="h-3.5 w-3.5 text-purple-400" />
                  Imagen de portada de la rutina (opcional)
                </div>
                <ImageUploadControl
                  label="Portada"
                  value={builderCoverImageUrl}
                  onChange={setBuilderCoverImageUrl}
                  compact
                />
              </div>
            </div>

            {builderItems.length === 0 ? (
              <div className="rounded-xl border border-dashed p-6 text-center text-xs" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>
                Pulsa &quot;+ Añadir&quot; en los ejercicios de la izquierda para ir montando tu rutina personalizada.
              </div>
            ) : (
              <div className="space-y-2">
                {builderItems.map((item, idx) => {
                  const thumb = resolveItemImage(item.exerciseId, item.imageUrl);
                  return (
                    <div
                      key={`${item.exerciseId}-${idx}`}
                      className="rounded-xl border p-3 space-y-2"
                      style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {thumb && (
                            <img src={thumb} alt={item.exerciseName} className="w-8 h-8 rounded-lg object-cover bg-[#161b26] shrink-0" />
                          )}
                          <span className="font-semibold text-xs truncate">{item.exerciseName}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setBuilderItems((prev) => prev.filter((_, i) => i !== idx))}
                          className="text-rose-400 p-1 shrink-0"
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
                            className="w-full rounded border px-2 py-1.5 text-base sm:text-xs"
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
                            className="w-full rounded border px-2 py-1.5 text-base sm:text-xs"
                            style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
                          />
                        </label>
                        <label className="space-y-0.5">
                          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                            {resolveIsPerDumbbell(item, exercisePerDumbbellMap[item.exerciseId]) ? 'Kg c/u sug.' : 'Kg sug.'}
                          </span>
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
                            className="w-full rounded border px-2 py-1.5 text-base sm:text-xs"
                            style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
                          />
                        </label>
                      </div>
                      <ImageUploadControl
                        label="Imagen del ejercicio en esta rutina"
                        value={item.imageUrl ?? null}
                        onChange={(nextUrl) =>
                          setBuilderItems((prev) =>
                            prev.map((it, i) => (i === idx ? { ...it, imageUrl: nextUrl } : it))
                          )
                        }
                        compact
                      />
                    </div>
                  );
                })}
              </div>
            )}

            <button
              type="submit"
              disabled={builderItems.length === 0}
              className="w-full rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 py-3 text-sm font-bold text-white min-h-[44px]"
            >
              Guardar Rutina Personalizada
            </button>
          </form>
        </div>
      )}

      {/* Modal para editar una rutina y sus imágenes */}
      {editingRoutine && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6 overflow-hidden">
          <form
            onSubmit={saveEditingRoutine}
            className="w-full max-w-2xl h-[100dvh] sm:h-auto sm:max-h-[90vh] rounded-none sm:rounded-2xl border-0 sm:border shadow-2xl overflow-hidden flex flex-col"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
          >
            <div
              className="px-4 sm:px-5 py-3.5 border-b flex items-center justify-between gap-3 shrink-0"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-card-elevated)' }}
            >
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-purple-400">
                  Personalizar rutina e imágenes
                </div>
                <h3 className="text-base sm:text-lg font-bold truncate">{editingRoutine.name}</h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingRoutine(null)}
                className="h-10 w-10 rounded-xl border flex items-center justify-center hover:bg-sunken shrink-0"
                style={{ borderColor: 'var(--border-subtle)' }}
                aria-label="Cerrar editor"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-4">
              <div className="space-y-3">
                <label className="block space-y-1">
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                    Nombre de la rutina
                  </span>
                  <input
                    required
                    value={editingRoutine.name}
                    onChange={(e) => setEditingRoutine({ ...editingRoutine, name: e.target.value })}
                    className="w-full rounded-xl border px-3 py-2 text-base sm:text-sm font-medium"
                    style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                    Notas
                  </span>
                  <textarea
                    rows={2}
                    value={editingRoutine.notes ?? ''}
                    onChange={(e) => setEditingRoutine({ ...editingRoutine, notes: e.target.value })}
                    className="w-full rounded-xl border px-3 py-2 text-base sm:text-sm"
                    style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
                  />
                </label>

                <div className="rounded-xl border p-3.5 space-y-2" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-card-elevated)' }}>
                  <div className="text-xs font-semibold">Imagen de portada de la rutina</div>
                  <ImageUploadControl
                    label="Portada de rutina"
                    value={editingRoutine.coverImageUrl ?? null}
                    onChange={(nextUrl) => setEditingRoutine({ ...editingRoutine, coverImageUrl: nextUrl })}
                  />
                </div>
              </div>

              <div className="space-y-2.5">
                <div className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  Imágenes de los ejercicios ({editingRoutine.items.length})
                </div>
                {editingRoutine.items.map((item, idx) => {
                  const effectiveImg = resolveItemImage(item.exerciseId, item.imageUrl);
                  return (
                    <div
                      key={`${item.exerciseId}-${idx}`}
                      className="rounded-xl border p-3 space-y-2.5"
                      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-card-elevated)' }}
                    >
                      <div className="flex items-center gap-3">
                        {effectiveImg && (
                          <img
                            src={effectiveImg}
                            alt={item.exerciseName}
                            className="w-12 h-12 rounded-xl object-cover bg-[#161b26] shrink-0"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold truncate">
                            {idx + 1}. {item.exerciseName}
                          </div>
                          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {item.sets} × {item.reps}
                          </div>
                        </div>
                      </div>
                      <ImageUploadControl
                        label="Foto propia en esta rutina"
                        value={item.imageUrl ?? null}
                        onChange={(nextUrl) =>
                          setEditingRoutine({
                            ...editingRoutine,
                            items: editingRoutine.items.map((it, i) =>
                              i === idx ? { ...it, imageUrl: nextUrl } : it
                            ),
                          })
                        }
                        compact
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <div
              className="px-4 sm:px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t flex items-center justify-end gap-2 shrink-0"
              style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-card-elevated)' }}
            >
              <button
                type="button"
                onClick={() => setEditingRoutine(null)}
                className="rounded-xl border px-4 py-2.5 text-xs font-semibold min-h-[42px]"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingRoutineEdit}
                className="rounded-xl bg-emerald-500 hover:bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white min-h-[42px]"
              >
                {savingRoutineEdit ? 'Guardando...' : 'Guardar Cambios'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal de imagen ampliada / subida rápida */}
      <ImageLightboxModal
        open={Boolean(lightbox)}
        imageUrl={lightbox?.imageUrl}
        title={lightbox?.title ?? ''}
        subtitle={lightbox?.subtitle}
        description={lightbox?.description}
        canEdit={Boolean(lightbox?.canEdit)}
        canReset={Boolean(lightbox?.canEdit && lightbox.exerciseId && !lightbox.exerciseId.startsWith('ex_custom_'))}
        onClose={() => setLightbox(null)}
        onImageUpdated={
          lightbox?.exerciseId
            ? (nextUrl) => updateExerciseImage(lightbox.exerciseId!, nextUrl)
            : undefined
        }
        onResetImage={
          lightbox?.exerciseId
            ? () => updateExerciseImage(lightbox.exerciseId!, null)
            : undefined
        }
      />

      {/* Reproductor de Entrenamiento en Vivo */}
      {activeWorkout && (
        <WorkoutPlayer
          routineId={activeWorkout.routineId}
          routineName={activeWorkout.name}
          items={activeWorkout.items}
          exerciseImages={exerciseImagesMap}
          exercisePerDumbbell={exercisePerDumbbellMap}
          lastExerciseLogs={lastExerciseLogs}
          onExerciseImageUpdated={(exerciseId, nextUrl) => {
            setExercises((prev) =>
              prev.map((e) => (e.id === exerciseId ? { ...e, imageUrl: nextUrl } : e))
            );
          }}
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
