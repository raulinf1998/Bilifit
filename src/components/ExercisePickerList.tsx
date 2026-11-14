'use client';

import { useMemo, useState } from 'react';
import { Check, Plus, Search } from 'lucide-react';
import { isExerciseCompatible, MUSCLE_LABELS, resolveIsPerDumbbell } from '@/lib/home-workouts';
import { useAddTick } from '@/lib/use-add-tick';
import type { Exercise } from '@/types';

interface ExercisePickerListProps {
  exercises: Exercise[];
  /** Veces que cada ejercicio ya está en la rutina (para marcar duplicados) */
  occurrences?: Record<string, number>;
  /** Material en propiedad; si se omite no se filtra ni se marca compatibilidad */
  ownedEquipmentIds?: string[];
  onAdd: (exercise: Exercise) => void;
  emptyHint?: string;
  searchPlaceholder?: string;
  maxHeightClass?: string;
  /** Clave del destello del tick para no colisionar entre varios pickers de la página */
  flashScope?: string;
}

/**
 * Lista compacta de ejercicios con buscador y filtro muscular. Cada botón
 * "+ Añadir" destella un tick (✓ Añadido) durante unos segundos como
 * confirmación visual de que el ejercicio se ha incorporado a la rutina.
 */
export function ExercisePickerList({
  exercises,
  occurrences = {},
  ownedEquipmentIds,
  onAdd,
  emptyHint = 'No hay ejercicios que coincidan con la búsqueda.',
  searchPlaceholder = 'Buscar ejercicio por nombre...',
  maxHeightClass = 'max-h-[260px]',
  flashScope = 'picker',
}: ExercisePickerListProps) {
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState<string>('all');
  const { flash, isFlashing } = useAddTick();

  const ownedSet = useMemo(
    () => (ownedEquipmentIds ? new Set(ownedEquipmentIds) : null),
    [ownedEquipmentIds]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return exercises.filter((ex) => {
      if (muscle !== 'all' && ex.muscleGroup !== muscle) return false;
      if (q && !ex.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [exercises, muscle, query]);

  const musclesPresent = useMemo(
    () => Array.from(new Set(exercises.map((ex) => ex.muscleGroup))),
    [exercises]
  );

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5" style={{ color: 'var(--text-muted)' }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-lg border pl-8 pr-3 py-2 text-base sm:text-xs"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
          />
        </div>
        <select
          value={muscle}
          onChange={(e) => setMuscle(e.target.value)}
          aria-label="Filtrar ejercicios por grupo muscular"
          className="rounded-lg border px-2 py-2 text-base sm:text-xs"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
        >
          <option value="all">Todos los músculos</option>
          {musclesPresent.map((m) => (
            <option key={m} value={m}>
              {MUSCLE_LABELS[m] ?? m}
            </option>
          ))}
        </select>
      </div>

      <div
        className={`space-y-1.5 overflow-y-auto pr-1 ${maxHeightClass}`}
        style={{ scrollbarWidth: 'thin' }}
      >
        {filtered.length === 0 ? (
          <div
            className="rounded-lg border border-dashed p-3 text-center text-[11px]"
            style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
          >
            {emptyHint}
          </div>
        ) : (
          filtered.map((ex) => {
            const added = isFlashing(`${flashScope}:${ex.id}`);
            const times = occurrences[ex.id] ?? 0;
            const compatible = ownedSet ? isExerciseCompatible(ex, ownedSet) : true;
            const perDb = resolveIsPerDumbbell({ exerciseId: ex.id, perDumbbell: ex.perDumbbell });
            return (
              <div
                key={ex.id}
                className={`flex items-center gap-2 rounded-lg border p-1.5 transition-colors ${
                  added ? 'border-emerald-500/60 bg-emerald-500/10' : ''
                }`}
                style={!added ? { borderColor: 'var(--border-subtle)' } : undefined}
              >
                <span className="w-8 h-8 rounded-lg overflow-hidden bg-[#161b26] shrink-0 flex items-center justify-center">
                  {ex.imageUrl ? (
                    <img src={ex.imageUrl} alt={ex.name} className="w-full h-full object-cover" />
                  ) : (
                    <Plus className="h-3.5 w-3.5 text-purple-400" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-semibold truncate">{ex.name}</span>
                  <span className="block text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {MUSCLE_LABELS[ex.muscleGroup] ?? ex.muscleGroup} · {ex.defaultSets} ×{' '}
                    {ex.defaultReps}
                    {perDb ? ' · ×2' : ''}
                    {times > 0 ? ` · en rutina ×${times}` : ''}
                    {!compatible ? ' · falta material' : ''}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onAdd(ex);
                    flash(`${flashScope}:${ex.id}`);
                  }}
                  className={`shrink-0 inline-flex items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition-colors min-h-[32px] min-w-[92px] ${
                    added
                      ? 'border-emerald-500/60 bg-emerald-500 text-white'
                      : 'border-purple-500/30 bg-purple-600/20 text-purple-700 dark:text-purple-300 hover:bg-purple-600/30'
                  }`}
                  aria-label={added ? `${ex.name} añadido` : `Añadir ${ex.name} a la rutina`}
                >
                  {added ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                  {added ? 'Añadido' : 'Añadir'}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
