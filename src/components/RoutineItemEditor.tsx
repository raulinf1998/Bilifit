'use client';

import { Check, Trash2 } from 'lucide-react';
import ImageUploadControl from '@/components/ImageUploadControl';
import { resolveIsPerDumbbell } from '@/lib/home-workouts';
import type { RoutineExerciseItem } from '@/types';

interface RoutineItemEditorProps {
  item: RoutineExerciseItem;
  index: number;
  thumbUrl: string | null;
  /** Valor `perDumbbell` persistido para el ejercicio (para rutinas antiguas sin flag) */
  perDumbbellLookup?: boolean;
  justAdded?: boolean;
  onChange: (next: RoutineExerciseItem) => void;
  onRemove?: () => void;
}

/**
 * Ficha editable de un ejercicio dentro de una rutina (series, repeticiones,
 * peso sugerido e imagen propia). Se usa tanto en el constructor manual como
 * en la edición de una rutina ya guardada.
 */
export function RoutineItemEditor({
  item,
  index,
  thumbUrl,
  perDumbbellLookup,
  justAdded,
  onChange,
  onRemove,
}: RoutineItemEditorProps) {
  const perDb = resolveIsPerDumbbell(item, perDumbbellLookup);
  const weightLabel = perDb ? 'Kg c/u sug.' : 'Kg sug.';

  return (
    <div
      className={`rounded-xl border p-3 space-y-2 transition-colors ${
        justAdded ? 'border-emerald-500/60 bg-emerald-500/10' : ''
      }`}
      style={{
        background: justAdded ? undefined : 'var(--bg-card-elevated)',
        borderColor: justAdded ? undefined : 'var(--border-subtle)',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {thumbUrl && (
            <img
              src={thumbUrl}
              alt={item.exerciseName}
              className="w-8 h-8 rounded-lg object-cover bg-[#161b26] shrink-0"
            />
          )}
          <span className="font-semibold text-xs truncate">
            {index + 1}. {item.exerciseName}
          </span>
          {perDb && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded border border-purple-500/35 bg-purple-500/15 text-purple-700 dark:text-purple-300 shrink-0">
              ×2
            </span>
          )}
          {justAdded && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 shrink-0 animate-fade-in">
              <Check className="h-3 w-3" /> Añadido
            </span>
          )}
        </div>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-rose-400 p-1 shrink-0 rounded-lg hover:bg-rose-500/15"
            title="Quitar ejercicio de la rutina"
            aria-label={`Quitar ${item.exerciseName} de la rutina`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <label className="space-y-0.5">
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            Series
          </span>
          <input
            type="number"
            min={1}
            value={item.sets}
            onChange={(e) => onChange({ ...item, sets: Math.max(1, Number(e.target.value) || 1) })}
            className="w-full rounded border px-2 py-1.5 text-base sm:text-xs"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
          />
        </label>
        <label className="space-y-0.5">
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            Reps
          </span>
          <input
            value={item.reps}
            onChange={(e) => onChange({ ...item, reps: e.target.value })}
            className="w-full rounded border px-2 py-1.5 text-base sm:text-xs"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
          />
        </label>
        <label className="space-y-0.5">
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {weightLabel}
          </span>
          <input
            type="number"
            min={0}
            step="any"
            value={item.suggestedWeightKg ?? 0}
            onChange={(e) =>
              onChange({ ...item, suggestedWeightKg: Number(e.target.value) || undefined })
            }
            className="w-full rounded border px-2 py-1.5 text-base sm:text-xs"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
          />
        </label>
      </div>

      <ImageUploadControl
        label="Imagen del ejercicio en esta rutina"
        value={item.imageUrl ?? null}
        onChange={(nextUrl) => onChange({ ...item, imageUrl: nextUrl })}
        compact
      />
    </div>
  );
}
