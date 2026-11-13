'use client';

import { useEffect, useState } from 'react';
import { Check, CheckCircle2, Clock, Copy, Pause, Play, Plus, SkipForward, Volume2, X } from 'lucide-react';
import { TogetherToggleButton } from '@/components/TogetherControl';
import { formatDurationClock } from '@/lib/metrics';
import type { RoutineExerciseItem, StrengthSetLog } from '@/types';

export interface LastExerciseLogRef {
  startedAt: string;
  sets: Array<{ reps: number; weightKg: number; durationSec?: number }>;
}

function playTimerBeep() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch {
    // Ignorar si el navegador bloquea AudioContext
  }
}

function parseNumericReps(repsLabel: string): number {
  const m = repsLabel.match(/\d+/);
  return m ? Number(m[0]) : 10;
}

function isTimedReps(repsLabel?: string): boolean {
  return Boolean(repsLabel && /\bseg\b/i.test(repsLabel));
}

function parseDecimalInput(raw: string): number {
  const normalized = raw.replace(',', '.').trim();
  if (!normalized) return 0;
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export default function WorkoutPlayer({
  routineId,
  routineName,
  items,
  lastExerciseLogs,
  onClose,
  onCompleted,
}: {
  routineId?: string;
  routineName: string;
  items: RoutineExerciseItem[];
  lastExerciseLogs?: Record<string, LastExerciseLogRef>;
  onClose: () => void;
  onCompleted: () => void;
}) {
  const [elapsedSec, setElapsedSec] = useState(0);
  const [paused, setPaused] = useState(false);
  const [restLeft, setRestLeft] = useState<number>(0);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [rpe, setRpe] = useState(7);
  const [notes, setNotes] = useState('');
  const [doneTogether, setDoneTogether] = useState(false);
  const [saving, setSaving] = useState(false);

  const [logs, setLogs] = useState<StrengthSetLog[]>(() =>
    items.map((item) => {
      const timed = isTimedReps(item.reps);
      const targetVal = parseNumericReps(item.reps);
      return {
        exerciseId: item.exerciseId,
        exerciseName: item.exerciseName,
        equipmentUsed: item.requiredEquipment,
        sets: Array.from({ length: item.sets }, () => ({
          reps: timed ? 1 : targetVal,
          ...(timed ? { durationSec: targetVal } : {}),
          weightKg: item.suggestedWeightKg ?? 0,
          completed: false,
        })),
      };
    })
  );

  const [repsInputs, setRepsInputs] = useState<string[][]>(() =>
    items.map((item) => Array.from({ length: item.sets }, () => String(parseNumericReps(item.reps))))
  );

  const [weightInputs, setWeightInputs] = useState<string[][]>(() =>
    items.map((item) =>
      Array.from({ length: item.sets }, () => (item.suggestedWeightKg ? String(item.suggestedWeightKg) : ''))
    )
  );

  // Cronómetro global de sesión
  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      setElapsedSec((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [paused]);

  // Temporizador de descanso entre series
  useEffect(() => {
    if (restLeft <= 0) return;
    const id = window.setInterval(() => {
      setRestLeft((prev) => {
        if (prev === 1 && soundEnabled) {
          playTimerBeep();
        }
        return Math.max(0, prev - 1);
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [restLeft, soundEnabled]);

  function toggleSet(exIdx: number, setIdx: number, restSeconds: number) {
    setLogs((prev) =>
      prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        const nextSets = ex.sets.map((s, j) => {
          if (j !== setIdx) return s;
          const nextCompleted = !s.completed;
          if (nextCompleted) {
            setRestLeft(restSeconds);
          }
          return { ...s, completed: nextCompleted };
        });
        return { ...ex, sets: nextSets };
      })
    );
  }

  function updateSetRepsInput(exIdx: number, setIdx: number, raw: string) {
    setRepsInputs((prev) =>
      prev.map((row, i) => (i === exIdx ? row.map((v, j) => (j === setIdx ? raw : v)) : row))
    );
    const val = Math.max(0, Math.round(parseDecimalInput(raw)));
    const timed = isTimedReps(items[exIdx]?.reps);
    setLogs((prev) =>
      prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        return {
          ...ex,
          sets: ex.sets.map((s, j) =>
            j === setIdx ? (timed ? { ...s, reps: 1, durationSec: val } : { ...s, reps: val }) : s
          ),
        };
      })
    );
  }

  function updateSetWeightInput(exIdx: number, setIdx: number, raw: string) {
    setWeightInputs((prev) =>
      prev.map((row, i) => (i === exIdx ? row.map((v, j) => (j === setIdx ? raw : v)) : row))
    );
    const val = parseDecimalInput(raw);
    setLogs((prev) =>
      prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        return {
          ...ex,
          sets: ex.sets.map((s, j) => (j === setIdx ? { ...s, weightKg: val } : s)),
        };
      })
    );
  }

  function applyWeightToEmptySets(exIdx: number, rawWeight: string) {
    const val = parseDecimalInput(rawWeight);
    setWeightInputs((prev) =>
      prev.map((row, i) => (i === exIdx ? row.map((v) => (v.trim() === '' ? rawWeight : v)) : row))
    );
    setLogs((prev) =>
      prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        return {
          ...ex,
          sets: ex.sets.map((s, j) =>
            weightInputs[exIdx]?.[j]?.trim() === '' ? { ...s, weightKg: val } : s
          ),
        };
      })
    );
  }

  function addExtraSet(exIdx: number) {
    setLogs((prev) =>
      prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        const last = ex.sets[ex.sets.length - 1] ?? { reps: 10, weightKg: 0, completed: false };
        return { ...ex, sets: [...ex.sets, { ...last, completed: false }] };
      })
    );
    setRepsInputs((prev) =>
      prev.map((row, i) => (i === exIdx ? [...row, row[row.length - 1] ?? '10'] : row))
    );
    setWeightInputs((prev) =>
      prev.map((row, i) => (i === exIdx ? [...row, row[row.length - 1] ?? ''] : row))
    );
  }

  const completedSets = logs.reduce((acc, ex) => acc + ex.sets.filter((s) => s.completed).length, 0);
  const totalSets = logs.reduce((acc, ex) => acc + ex.sets.length, 0);
  const totalVolumeKg = logs.reduce(
    (acc, ex) =>
      acc +
      ex.sets
        .filter((s) => s.completed)
        .reduce((sAcc, s) => sAcc + (s.durationSec && s.durationSec > 0 ? 1 : s.reps) * s.weightKg, 0),
    0
  );

  async function finishWorkout() {
    setSaving(true);
    try {
      const res = await fetch('/api/routines/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routineId,
          title: routineName,
          durationSec: Math.max(300, elapsedSec),
          rpe,
          notes,
          doneTogether,
          strengthLogs: logs,
        }),
      });
      if (res.ok) {
        onCompleted();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <div
        className="w-full max-w-3xl rounded-2xl border shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col"
        style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
      >
        {/* Header del reproductor */}
        <div
          className="px-5 py-4 border-b flex flex-wrap items-center justify-between gap-3"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-card-elevated)' }}
        >
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-purple-400">
              Entrenamiento en Curso
            </div>
            <h3 className="text-lg font-bold">{routineName}</h3>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-xl px-3 py-1.5 border text-sm font-mono font-bold tabular-nums" style={{ borderColor: 'var(--border-subtle)' }}>
              <Clock className="h-4 w-4 text-primary" />
              {formatDurationClock(elapsedSec)}
            </div>
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              className="p-2 rounded-xl border hover:bg-sunken"
              style={{ borderColor: 'var(--border-subtle)' }}
              title={paused ? 'Reanudar' : 'Pausar'}
            >
              {paused ? <Play className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> : <Pause className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => setSoundEnabled((s) => !s)}
              className={`p-2 rounded-xl border ${soundEnabled ? 'text-cyan-600 dark:text-cyan-400' : 'opacity-40'}`}
              style={{ borderColor: 'var(--border-subtle)' }}
              title="Sonido fin de descanso"
            >
              <Volume2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl border hover:bg-rose-500/20 text-rose-600 dark:text-rose-400"
              style={{ borderColor: 'var(--border-subtle)' }}
              title="Cerrar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Barra de Descanso Activo */}
        {restLeft > 0 && (
          <div className="px-5 py-3 bg-cyan-500/15 border-b border-cyan-500/30 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">Descanso entre series</span>
              <span className="text-xl font-mono font-bold text-cyan-600 dark:text-cyan-400 tabular-nums">{restLeft}s</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRestLeft((r) => r + 15)}
                className="px-2.5 py-1 rounded-lg bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 text-xs font-medium hover:bg-cyan-500/30"
              >
                +15s
              </button>
              <button
                type="button"
                onClick={() => setRestLeft(0)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sunken text-ink text-xs font-medium border border-line"
              >
                <SkipForward className="h-3.5 w-3.5" /> Saltar
              </button>
            </div>
          </div>
        )}

        {/* Lista de ejercicios y series */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {logs.map((ex, exIdx) => {
            const spec = items[exIdx];
            const timed = isTimedReps(spec?.reps);
            const rowWeights = weightInputs[exIdx] ?? [];
            const firstWeightRaw = rowWeights.find((w) => parseDecimalInput(w) > 0) ?? '';
            const hasEmptyWeightSlot = rowWeights.some((w) => w.trim() === '');
            const prevLog = lastExerciseLogs?.[ex.exerciseId];
            return (
              <div
                key={`${ex.exerciseId}-${exIdx}`}
                className="rounded-xl border p-4 space-y-3"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-card-elevated)' }}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-sm sm:text-base">
                      {exIdx + 1}. {ex.exerciseName}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      Objetivo: {spec?.reps} · Descanso: {spec?.restSeconds ?? 60}s
                    </div>
                    {prevLog && prevLog.sets.length > 0 && (
                      <div className="text-[11px] mt-0.5 text-cyan-600 dark:text-cyan-400 tabular-nums">
                        Último ({new Date(prevLog.startedAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}):{' '}
                        {prevLog.sets
                          .map((s) => (s.weightKg > 0 ? `${s.weightKg} kg` : 'corporal'))
                          .join(' / ')}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {firstWeightRaw && hasEmptyWeightSlot && ex.sets.length > 1 && (
                      <button
                        type="button"
                        onClick={() => applyWeightToEmptySets(exIdx, firstWeightRaw)}
                        title="Copiar este peso al resto de series vacías"
                        className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg border hover:bg-sunken"
                        style={{ borderColor: 'var(--border-subtle)' }}
                      >
                        <Copy className="h-3 w-3" /> Igualar {firstWeightRaw} kg
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => addExtraSet(exIdx)}
                      className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-lg border hover:bg-sunken"
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      <Plus className="h-3.5 w-3.5" /> Serie
                    </button>
                  </div>
                </div>

                {spec?.notes && (
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    {spec.notes}
                  </p>
                )}

                <div className="space-y-2">
                  {ex.sets.map((set, setIdx) => (
                    <div
                      key={setIdx}
                      className={`grid grid-cols-12 gap-2 items-center rounded-lg px-3 py-2 border transition-colors ${
                        set.completed ? 'bg-emerald-500/10 border-emerald-500/35' : ''
                      }`}
                      style={!set.completed ? { borderColor: 'var(--border-subtle)' } : undefined}
                    >
                      <div className="col-span-2 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                        Serie {setIdx + 1}
                      </div>
                      <div className="col-span-4 flex items-center gap-1.5">
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          placeholder="0"
                          value={repsInputs[exIdx]?.[setIdx] ?? ''}
                          onChange={(e) => updateSetRepsInput(exIdx, setIdx, e.target.value)}
                          className="w-16 rounded border px-2 py-1 text-xs tabular-nums"
                          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
                        />
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {timed ? 'seg' : 'reps'}
                        </span>
                      </div>
                      <div className="col-span-4 flex items-center gap-1.5">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          inputMode="decimal"
                          placeholder="Peso"
                          value={weightInputs[exIdx]?.[setIdx] ?? ''}
                          onChange={(e) => updateSetWeightInput(exIdx, setIdx, e.target.value)}
                          className="w-16 rounded border px-2 py-1 text-xs tabular-nums"
                          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
                        />
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          kg
                        </span>
                      </div>
                      <div className="col-span-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() => toggleSet(exIdx, setIdx, spec?.restSeconds ?? 60)}
                          className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors ${
                            set.completed
                              ? 'bg-emerald-500 text-white'
                              : 'border hover:border-emerald-400'
                          }`}
                          style={!set.completed ? { borderColor: 'var(--border-subtle)' } : undefined}
                          aria-label="Completar serie"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* RPE, compañera/o y notas al finalizar */}
          <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium">Esfuerzo percibido (RPE 1–10)</span>
              <div className="flex items-center gap-3">
                <TogetherToggleButton
                  compact
                  active={doneTogether}
                  onClick={() => setDoneTogether((v) => !v)}
                />
                <span className="font-bold text-primary tabular-nums">{rpe} / 10</span>
              </div>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              value={rpe}
              onChange={(e) => setRpe(Number(e.target.value))}
              className="w-full accent-primary"
            />
            <textarea
              rows={2}
              placeholder="Notas opcionales de sensaciones..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
            />
          </div>
        </div>

        {/* Footer */}
        <div
          className="px-5 py-4 border-t flex flex-wrap items-center justify-between gap-3"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-card-elevated)' }}
        >
          <div className="text-xs space-x-3" style={{ color: 'var(--text-secondary)' }}>
            <span>
              Series: <strong className="tabular-nums">{completedSets}/{totalSets}</strong>
            </span>
            <span>
              Volumen: <strong className="tabular-nums">{Math.round(totalVolumeKg)} kg</strong>
            </span>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={finishWorkout}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors"
          >
            <CheckCircle2 className="h-4 w-4" />
            {saving ? 'Guardando...' : 'Finalizar y Guardar Entreno'}
          </button>
        </div>
      </div>
    </div>
  );
}
