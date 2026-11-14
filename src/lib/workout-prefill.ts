import type { RoutineExerciseItem, StrengthPrefillExercise, StrengthPrefillSet } from '@/types';

/** «10-12», «12 por pierna» o «45 seg» -> 10 / 12 / 45 */
export function parseNumericReps(repsLabel: string): number {
  const m = repsLabel.match(/\d+/);
  return m ? Number(m[0]) : 10;
}

/** Series marcadas por tiempo («45 seg», «30 segundos») en lugar de repeticiones. */
export function isTimedReps(repsLabel?: string): boolean {
  return Boolean(repsLabel && /\bseg\b/i.test(repsLabel));
}

/** Acepta coma decimal y descarta valores negativos o no numéricos. */
export function parseDecimalInput(raw: string): number {
  const normalized = raw.replace(',', '.').trim();
  if (!normalized) return 0;
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export interface PlannedSetRow {
  reps: number;
  weightKg: number;
  durationSec?: number;
  completed: boolean;
}

export interface PlannedExerciseRows {
  sets: PlannedSetRow[];
  /** Texto de cada input de reps/segundos */
  reps: string[];
  /** Texto de cada input de peso ('' = peso corporal / sin peso anotado) */
  weights: string[];
  /** Cuántas series vienen de la sesión anterior (0 = todo por defecto) */
  prefilledSets: number;
}

function defaultRow(item: RoutineExerciseItem, timed: boolean, target: number): PlannedSetRow {
  return {
    reps: timed ? 1 : target,
    ...(timed ? { durationSec: target } : {}),
    weightKg: item.suggestedWeightKg ?? 0,
    completed: false,
  };
}

function rowFromPrevious(prev: StrengthPrefillSet, timed: boolean, target: number): PlannedSetRow {
  const weightKg = parseDecimalInput(String(prev.weightKg ?? 0));
  if (timed) {
    const seconds = Number(prev.durationSec) > 0 ? Math.round(Number(prev.durationSec)) : target;
    return { reps: 1, durationSec: seconds, weightKg, completed: false };
  }
  const reps = Number(prev.reps) > 0 ? Math.round(Number(prev.reps)) : target;
  return { reps, weightKg, completed: false };
}

/**
 * Filas iniciales de un ejercicio al empezar una sesión.
 *
 * Si `prev` existe (el ejercicio se hizo en la última sesión de este tipo) se
 * copian sus series una a una; las series que la rutina pida de más, y los
 * ejercicios que no estaban en aquella sesión, conservan los valores por
 * defecto de la rutina.
 */
export function planSetRows(
  item: RoutineExerciseItem,
  prev?: StrengthPrefillExercise | null
): PlannedExerciseRows {
  const timed = isTimedReps(item.reps);
  const target = parseNumericReps(item.reps);
  const prevSets = prev?.sets ?? [];
  const setCount = Math.max(1, Number(item.sets) > 0 ? Math.round(Number(item.sets)) : 1);

  const sets: PlannedSetRow[] = [];
  const reps: string[] = [];
  const weights: string[] = [];
  let prefilledSets = 0;

  for (let i = 0; i < setCount; i++) {
    const fromPrev = prevSets[i];
    const row = fromPrev ? rowFromPrevious(fromPrev, timed, target) : defaultRow(item, timed, target);
    if (fromPrev) prefilledSets += 1;
    sets.push(row);
    reps.push(String(timed ? row.durationSec ?? target : row.reps));
    weights.push(row.weightKg > 0 ? String(row.weightKg) : '');
  }

  return { sets, reps, weights, prefilledSets };
}

/** Ejercicios de la rutina que tienen serie(s) en la sesión anterior. */
export function countPrefilledExercises(
  items: RoutineExerciseItem[],
  logs?: Record<string, StrengthPrefillExercise> | null
): number {
  if (!logs) return 0;
  return items.filter((item) => (logs[item.exerciseId]?.sets?.length ?? 0) > 0).length;
}
