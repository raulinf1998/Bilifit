'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Pause,
  Play,
  Plus,
  SkipForward,
  Trash2,
  Volume2,
  X,
  ZoomIn,
} from 'lucide-react';
import ImageLightboxModal from '@/components/ImageLightboxModal';
import { TogetherToggleButton } from '@/components/TogetherControl';
import { uploadExerciseOrWorkoutImage } from '@/lib/client-image';
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
  exerciseImages,
  lastExerciseLogs,
  onExerciseImageUpdated,
  onClose,
  onCompleted,
}: {
  routineId?: string;
  routineName: string;
  items: RoutineExerciseItem[];
  exerciseImages?: Record<string, string | null | undefined>;
  lastExerciseLogs?: Record<string, LastExerciseLogRef>;
  onExerciseImageUpdated?: (exerciseId: string, nextUrl: string | null) => void;
  onClose: () => void;
  onCompleted: () => void;
}) {
  const [elapsedSec, setElapsedSec] = useState(0);
  const [paused, setPaused] = useState(false);
  const [restLeft, setRestLeft] = useState<number>(0);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [largeImages, setLargeImages] = useState(false);
  const [rpe, setRpe] = useState(7);
  const [notes, setNotes] = useState('');
  const [doneTogether, setDoneTogether] = useState(false);
  const [workoutImages, setWorkoutImages] = useState<string[]>([]);
  const [uploadingWorkoutImg, setUploadingWorkoutImg] = useState(false);
  const [workoutImgError, setWorkoutImgError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const workoutFileRef = useRef<HTMLInputElement | null>(null);

  const [localExerciseImages, setLocalExerciseImages] = useState<Record<string, string | null>>({});
  const [lightbox, setLightbox] = useState<{
    kind: 'exercise' | 'workout';
    exerciseId?: string;
    imageUrl: string | null | undefined;
    title: string;
    subtitle?: string;
    description?: string;
  } | null>(null);

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

  function resolveItemImage(spec: RoutineExerciseItem | undefined): string | null {
    if (!spec) return null;
    if (spec.exerciseId in localExerciseImages) {
      return localExerciseImages[spec.exerciseId];
    }
    return spec.imageUrl || exerciseImages?.[spec.exerciseId] || null;
  }

  async function saveCustomExerciseImage(exerciseId: string, nextUrl: string | null) {
    const res = await fetch(`/api/exercises/${encodeURIComponent(exerciseId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl: nextUrl }),
    });
    if (res.ok) {
      const data = await res.json().catch(() => null);
      const resolvedUrl: string | null = data?.exercise?.imageUrl ?? nextUrl;
      setLocalExerciseImages((prev) => ({ ...prev, [exerciseId]: resolvedUrl }));
      onExerciseImageUpdated?.(exerciseId, resolvedUrl);
      setLightbox((prev) => (prev ? { ...prev, imageUrl: resolvedUrl } : null));
    }
  }

  async function handleWorkoutPhotosSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    setWorkoutImgError(null);
    setUploadingWorkoutImg(true);
    try {
      const uploaded: string[] = [];
      for (const file of files.slice(0, 6)) {
        const url = await uploadExerciseOrWorkoutImage(file);
        uploaded.push(url);
      }
      setWorkoutImages((prev) => Array.from(new Set([...prev, ...uploaded])).slice(0, 12));
    } catch (err) {
      setWorkoutImgError(err instanceof Error ? err.message : 'No se pudo subir la imagen.');
    } finally {
      setUploadingWorkoutImg(false);
    }
  }

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
  const progressPct = totalSets > 0 ? Math.round((completedSets / totalSets) * 100) : 0;
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
          images: workoutImages,
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
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-6 overflow-hidden">
      <div
        className="w-full max-w-3xl h-[100dvh] sm:h-auto sm:max-h-[92vh] rounded-none sm:rounded-2xl border-0 sm:border shadow-2xl overflow-hidden flex flex-col"
        style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
      >
        {/* Header del reproductor optimizado para móvil */}
        <div
          className="px-3.5 sm:px-5 pt-3 pb-2.5 border-b space-y-2 shrink-0"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-card-elevated)' }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-purple-400">
                Entrenamiento en Curso
              </div>
              <h3 className="text-base sm:text-lg font-bold truncate">{routineName}</h3>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="h-10 w-10 shrink-0 rounded-xl border hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 flex items-center justify-center"
              style={{ borderColor: 'var(--border-subtle)' }}
              title="Cerrar"
              aria-label="Cerrar reproductor"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <div
                className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 border text-xs sm:text-sm font-mono font-bold tabular-nums"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                <Clock className="h-3.5 w-3.5 text-primary" />
                {formatDurationClock(elapsedSec)}
              </div>
              <button
                type="button"
                onClick={() => setPaused((p) => !p)}
                className="h-9 w-9 rounded-xl border hover:bg-sunken flex items-center justify-center"
                style={{ borderColor: 'var(--border-subtle)' }}
                title={paused ? 'Reanudar' : 'Pausar'}
                aria-label={paused ? 'Reanudar' : 'Pausar'}
              >
                {paused ? <Play className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> : <Pause className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => setSoundEnabled((s) => !s)}
                className={`h-9 w-9 rounded-xl border flex items-center justify-center ${soundEnabled ? 'text-cyan-600 dark:text-cyan-400' : 'opacity-40'}`}
                style={{ borderColor: 'var(--border-subtle)' }}
                title="Sonido fin de descanso"
                aria-label="Sonido fin de descanso"
              >
                <Volume2 className="h-4 w-4" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => setLargeImages((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors min-h-[36px] ${
                largeImages
                  ? 'bg-purple-600 text-white border-purple-600'
                  : 'hover:bg-sunken'
              }`}
              style={!largeImages ? { borderColor: 'var(--border-subtle)' } : undefined}
              title="Alternar tamaño de las imágenes de ejercicios"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              {largeImages ? 'Fotos grandes' : 'Fotos compactas'}
            </button>
          </div>

          <div className="h-1.5 w-full rounded-full overflow-hidden bg-sunken">
            <div
              className="h-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Barra de Descanso Activo */}
        {restLeft > 0 && (
          <div className="px-4 py-2.5 bg-cyan-500/15 border-b border-cyan-500/30 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">Descanso</span>
              <span className="text-lg sm:text-xl font-mono font-bold text-cyan-600 dark:text-cyan-400 tabular-nums">{restLeft}s</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRestLeft((r) => r + 15)}
                className="px-3 py-1.5 rounded-lg bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 text-xs font-semibold hover:bg-cyan-500/30 min-h-[34px]"
              >
                +15s
              </button>
              <button
                type="button"
                onClick={() => setRestLeft(0)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-sunken text-ink text-xs font-semibold border border-line min-h-[34px]"
              >
                <SkipForward className="h-3.5 w-3.5" /> Saltar
              </button>
            </div>
          </div>
        )}

        {/* Lista de ejercicios y series */}
        <div className="flex-1 overflow-y-auto overscroll-contain p-3 sm:p-5 space-y-4">
          {logs.map((ex, exIdx) => {
            const spec = items[exIdx];
            const timed = isTimedReps(spec?.reps);
            const rowWeights = weightInputs[exIdx] ?? [];
            const firstWeightRaw = rowWeights.find((w) => parseDecimalInput(w) > 0) ?? '';
            const hasEmptyWeightSlot = rowWeights.some((w) => w.trim() === '');
            const prevLog = lastExerciseLogs?.[ex.exerciseId];
            const imageUrl = resolveItemImage(spec);

            return (
              <div
                key={`${ex.exerciseId}-${exIdx}`}
                className="rounded-2xl border p-3.5 sm:p-4 space-y-3"
                style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-card-elevated)' }}
              >
                {/* Cabecera del ejercicio + imagen de referencia */}
                <div className={largeImages ? 'space-y-3' : 'flex items-start gap-3'}>
                  {imageUrl ? (
                    <button
                      type="button"
                      onClick={() =>
                        setLightbox({
                          kind: 'exercise',
                          exerciseId: ex.exerciseId,
                          imageUrl,
                          title: `${exIdx + 1}. ${ex.exerciseName}`,
                          subtitle: `${spec?.sets ?? ex.sets.length} × ${spec?.reps ?? ''} · Descanso ${spec?.restSeconds ?? 60}s`,
                          description: spec?.notes,
                        })
                      }
                      className={`group relative overflow-hidden border bg-[#161b26] shrink-0 transition-transform active:scale-95 ${
                        largeImages
                          ? 'w-full max-w-[260px] mx-auto aspect-square rounded-2xl block'
                          : 'w-16 h-16 sm:w-20 sm:h-20 rounded-xl'
                      }`}
                      style={{ borderColor: 'var(--border-subtle)' }}
                      title="Toca para ampliar imagen o subir foto"
                    >
                      <img
                        src={imageUrl}
                        alt={ex.exerciseName}
                        className="w-full h-full object-cover"
                      />
                      <span className="absolute bottom-1 right-1 h-5 w-5 rounded-md bg-black/65 text-white flex items-center justify-center">
                        <ZoomIn className="h-3 w-3" />
                      </span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        setLightbox({
                          kind: 'exercise',
                          exerciseId: ex.exerciseId,
                          imageUrl: null,
                          title: `${exIdx + 1}. ${ex.exerciseName}`,
                          subtitle: `${spec?.sets ?? ex.sets.length} × ${spec?.reps ?? ''}`,
                          description: spec?.notes,
                        })
                      }
                      className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl border border-dashed shrink-0 flex flex-col items-center justify-center gap-1 text-[10px] font-medium hover:bg-sunken"
                      style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
                    >
                      <Camera className="h-4 w-4 text-purple-400" />
                      <span>Foto</span>
                    </button>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-bold text-sm sm:text-base leading-snug">
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
                    </div>

                    {spec?.notes && (
                      <p className="text-xs leading-relaxed mt-1.5" style={{ color: 'var(--text-secondary)' }}>
                        {spec.notes}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      {firstWeightRaw && hasEmptyWeightSlot && ex.sets.length > 1 && (
                        <button
                          type="button"
                          onClick={() => applyWeightToEmptySets(exIdx, firstWeightRaw)}
                          title="Copiar este peso al resto de series vacías"
                          className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border hover:bg-sunken min-h-[34px]"
                          style={{ borderColor: 'var(--border-subtle)' }}
                        >
                          <Copy className="h-3 w-3" /> Igualar {firstWeightRaw} kg
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => addExtraSet(exIdx)}
                        className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border hover:bg-sunken min-h-[34px]"
                        style={{ borderColor: 'var(--border-subtle)' }}
                      >
                        <Plus className="h-3.5 w-3.5" /> Serie
                      </button>
                    </div>
                  </div>
                </div>

                {/* Series: diseño móvil sin desbordes y sin zoom automático en iOS */}
                <div className="space-y-2">
                  {ex.sets.map((set, setIdx) => (
                    <div
                      key={setIdx}
                      className={`flex items-center justify-between gap-2 rounded-xl px-2.5 sm:px-3 py-2 border transition-colors ${
                        set.completed ? 'bg-emerald-500/10 border-emerald-500/35' : ''
                      }`}
                      style={!set.completed ? { borderColor: 'var(--border-subtle)' } : undefined}
                    >
                      <div className="shrink-0 w-7 sm:w-14 text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
                        <span className="sm:hidden">S{setIdx + 1}</span>
                        <span className="hidden sm:inline">Serie {setIdx + 1}</span>
                      </div>

                      <div className="flex items-center gap-1 sm:gap-1.5 min-w-0">
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          placeholder="0"
                          aria-label={`${ex.exerciseName} serie ${setIdx + 1} ${timed ? 'segundos' : 'repeticiones'}`}
                          value={repsInputs[exIdx]?.[setIdx] ?? ''}
                          onChange={(e) => updateSetRepsInput(exIdx, setIdx, e.target.value)}
                          className="w-14 sm:w-16 rounded-lg border px-1.5 py-1.5 text-base sm:text-xs font-semibold text-center tabular-nums"
                          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
                        />
                        <span className="text-[11px] sm:text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>
                          {timed ? 'seg' : 'reps'}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 sm:gap-1.5 min-w-0">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          inputMode="decimal"
                          placeholder="Peso"
                          aria-label={`${ex.exerciseName} serie ${setIdx + 1} peso en kg`}
                          value={weightInputs[exIdx]?.[setIdx] ?? ''}
                          onChange={(e) => updateSetWeightInput(exIdx, setIdx, e.target.value)}
                          className="w-16 sm:w-20 rounded-lg border px-1.5 py-1.5 text-base sm:text-xs font-semibold text-center tabular-nums"
                          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
                        />
                        <span className="text-[11px] sm:text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>
                          kg
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => toggleSet(exIdx, setIdx, spec?.restSeconds ?? 60)}
                        className={`h-11 w-11 sm:h-9 sm:w-9 shrink-0 rounded-xl flex items-center justify-center transition-colors ${
                          set.completed
                            ? 'bg-emerald-500 text-white shadow-sm'
                            : 'border hover:border-emerald-400'
                        }`}
                        style={!set.completed ? { borderColor: 'var(--border-subtle)' } : undefined}
                        aria-label="Completar serie"
                      >
                        <Check className="h-5 w-5 sm:h-4 sm:w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Fotos de este entrenamiento (cámara / galería del teléfono) */}
          <div className="rounded-2xl border p-4 space-y-3" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold flex items-center gap-2">
                  <ImageIcon className="h-4 w-4 text-purple-400" />
                  Fotos del entrenamiento
                </div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Opcional: guarda fotos de la pizarra, máquina o sesión al terminar.
                </p>
              </div>
              <div>
                <input
                  ref={workoutFileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleWorkoutPhotosSelected}
                />
                <button
                  type="button"
                  disabled={uploadingWorkoutImg}
                  onClick={() => workoutFileRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-sunken min-h-[40px]"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  {uploadingWorkoutImg ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4 text-purple-400" />}
                  {uploadingWorkoutImg ? 'Subiendo...' : 'Añadir foto'}
                </button>
              </div>
            </div>

            {workoutImgError && <p className="text-xs text-rose-400">{workoutImgError}</p>}

            {workoutImages.length > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                {workoutImages.map((imgUrl, idx) => (
                  <div
                    key={`${imgUrl}-${idx}`}
                    className="relative aspect-square rounded-xl overflow-hidden border bg-[#161b26]"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setLightbox({
                          kind: 'workout',
                          imageUrl: imgUrl,
                          title: `${routineName} · Foto ${idx + 1}`,
                        })
                      }
                      className="w-full h-full block"
                    >
                      <img src={imgUrl} alt={`Foto ${idx + 1}`} className="w-full h-full object-cover" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setWorkoutImages((prev) => prev.filter((_, i) => i !== idx))}
                      className="absolute top-1.5 right-1.5 h-7 w-7 rounded-lg bg-black/70 text-white flex items-center justify-center"
                      aria-label="Eliminar foto"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* RPE, compañera/o y notas al finalizar */}
          <div className="rounded-2xl border p-4 space-y-3" style={{ borderColor: 'var(--border-subtle)' }}>
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
              className="w-full rounded-lg border px-3 py-2 text-base sm:text-sm"
              style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
            />
          </div>
        </div>

        {/* Footer */}
        <div
          className="px-4 sm:px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] border-t flex flex-wrap items-center justify-between gap-3 shrink-0"
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
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 px-5 py-3 sm:py-2.5 text-sm font-bold text-white transition-colors min-h-[44px]"
          >
            <CheckCircle2 className="h-4 w-4" />
            {saving ? 'Guardando...' : 'Finalizar y Guardar Entreno'}
          </button>
        </div>
      </div>

      {/* Modal de imagen ampliada / subida de foto */}
      <ImageLightboxModal
        open={Boolean(lightbox)}
        imageUrl={lightbox?.imageUrl}
        title={lightbox?.title ?? ''}
        subtitle={lightbox?.subtitle}
        description={lightbox?.description}
        canEdit={lightbox?.kind === 'exercise'}
        canReset={Boolean(lightbox?.kind === 'exercise' && lightbox.exerciseId && !lightbox.exerciseId.startsWith('ex_custom_'))}
        onClose={() => setLightbox(null)}
        onImageUpdated={
          lightbox?.kind === 'exercise' && lightbox.exerciseId
            ? (url) => saveCustomExerciseImage(lightbox.exerciseId!, url)
            : undefined
        }
        onResetImage={
          lightbox?.kind === 'exercise' && lightbox.exerciseId
            ? () => saveCustomExerciseImage(lightbox.exerciseId!, null)
            : undefined
        }
      />
    </div>
  );
}
