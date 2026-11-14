'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  History,
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
import {
  countPrefilledExercises,
  isTimedReps,
  parseDecimalInput,
  planSetRows,
} from '@/lib/workout-prefill';
import {
  clearSessionClock,
  createSessionClock,
  elapsedSessionSec,
  isSessionClockPaused,
  keepAwayTime,
  pauseSessionClock,
  readSessionClock,
  resumeSessionClock,
  sessionClockStorageKey,
  sumTimedSetSec,
  writeSessionClock,
  type SessionClock,
} from '@/lib/session-clock';
import { uploadExerciseOrWorkoutImage } from '@/lib/client-image';
import {
  calculateStrengthSetVolumeKg,
  isSingleDumbbellByDefault,
  resolveIsPerDumbbell,
} from '@/lib/home-workouts';
import { formatDurationClock } from '@/lib/metrics';
import type { RoutineExerciseItem, StrengthSessionPrefill, StrengthSetLog } from '@/types';

export interface LastExerciseLogRef {
  startedAt: string;
  perDumbbell?: boolean;
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

export default function WorkoutPlayer({
  routineId,
  routineName,
  items,
  exerciseImages,
  exercisePerDumbbell,
  lastExerciseLogs,
  previousSession,
  onExerciseImageUpdated,
  onClose,
  onCompleted,
}: {
  routineId?: string;
  routineName: string;
  items: RoutineExerciseItem[];
  exerciseImages?: Record<string, string | null | undefined>;
  exercisePerDumbbell?: Record<string, boolean>;
  lastExerciseLogs?: Record<string, LastExerciseLogRef>;
  /** Última sesión del mismo tipo: sus series precargan reps y peso. */
  previousSession?: StrengthSessionPrefill | null;
  onExerciseImageUpdated?: (exerciseId: string, nextUrl: string | null) => void;
  onClose: () => void;
  onCompleted: () => void;
}) {
  // Una rutina tiene su propio cronómetro guardado; los entrenos generados al momento
  // se distinguen por la lista de ejercicios (mismo nombre, distinto entreno).
  const clockKey = sessionClockStorageKey(
    routineId ?? `name:${routineName}:${items.map((it) => `${it.exerciseId}x${it.sets}`).join(',')}`
  );
  // El ancla del cronómetro vive en `SessionClock` (tiempo real), no en un contador
  // de ticks: así la duración sigue siendo correcta aunque el navegador congele el
  // intervalo con la pantalla apagada, y se puede recuperar si la página se recarga.
  const [clock, setClock] = useState<SessionClock | null>(null);
  const [nowTick, setNowTick] = useState(0);
  // Fin (epoch ms) del descanso en curso y segundos que llevaba al arrancar.
  const [restEndsAtMs, setRestEndsAtMs] = useState<number | null>(null);
  const [restBeeped, setRestBeeped] = useState(false);
  // Aviso de que se ha recuperado una sesión empezada antes (y su pausa por estar cerrada).
  const [resumedInfo, setResumedInfo] = useState<{ startedAtMs: number; deductedSec: number } | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const clockRef = useRef<SessionClock | null>(null);
  clockRef.current = clock;
  const completedSetsRef = useRef(0);
  // Momento del último ancla guardada y bandera de "esta sesión ya no se guarda"
  const clockSavedAtRef = useRef(0);
  const draftDisabledRef = useRef(false);
  const [largeImages, setLargeImages] = useState(false);
  const [rpe, setRpe] = useState(7);
  const [notes, setNotes] = useState('');
  const [doneTogether, setDoneTogether] = useState(false);
  const [workoutImages, setWorkoutImages] = useState<string[]>([]);
  const [uploadingWorkoutImg, setUploadingWorkoutImg] = useState(false);
  const [workoutImgError, setWorkoutImgError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<'finish' | 'discard' | null>(null);
  const [finishError, setFinishError] = useState<string | null>(null);
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

  // Series iniciales: las que se hicieron la última vez que se entrenó este mismo
  // tipo de sesión; el resto (y los ejercicios nuevos) mantienen lo que dice la rutina.
  const previousLogs = previousSession?.logs ?? null;
  const initialRows = items.map((item) => planSetRows(item, previousLogs?.[item.exerciseId]));
  const prefilledExerciseCount = countPrefilledExercises(items, previousLogs);

  const [logs, setLogs] = useState<StrengthSetLog[]>(() =>
    items.map((item, idx) => {
      const perDumbbell = resolveIsPerDumbbell(item, exercisePerDumbbell?.[item.exerciseId]);
      return {
        exerciseId: item.exerciseId,
        exerciseName: item.exerciseName,
        equipmentUsed: item.requiredEquipment,
        ...(perDumbbell ? { perDumbbell: true } : {}),
        sets: initialRows[idx].sets,
      };
    })
  );

  const [repsInputs, setRepsInputs] = useState<string[][]>(() => initialRows.map((row) => [...row.reps]));

  const [weightInputs, setWeightInputs] = useState<string[][]>(() => initialRows.map((row) => [...row.weights]));

  function clockStorage() {
    return typeof window !== 'undefined' ? window.localStorage : null;
  }

  /**
   * Guarda el ancla de la sesión en curso. Solo la persiste cuando la sesión ya es
   * real (un minuto hecho o alguna serie marcada) y como mucho cada 10 s, salvo en
   * los momentos clave (pausa, ocultar la pestaña, desmontar), para que al volver a
   * abrir la app sólo se descuente el rato en que de verdad no pudo medir.
   */
  function persistClock(nowMs = Date.now(), options: { immediate?: boolean; next?: SessionClock | null } = {}) {
    if (draftDisabledRef.current) return;
    const current = options.next ?? clockRef.current;
    if (!current) return;
    if (!options.immediate && nowMs - clockSavedAtRef.current < 10_000) return;
    if (elapsedSessionSec(current, nowMs) < 60 && completedSetsRef.current === 0) return;
    clockSavedAtRef.current = nowMs;
    writeSessionClock(clockStorage(), clockKey, current, nowMs);
  }

  // Sesión guardada o descartada: el ancla deja de existir y ya no se reescribe
  // (ni siquiera cuando el reproductor se desmonte justo después).
  function forgetSessionDraft() {
    draftDisabledRef.current = true;
    clearSessionClock(clockStorage(), clockKey);
  }

  // Al abrir el reproductor se retoma la sesión en curso si la había (misma rutina
  // y empezada en las últimas 6 h); si no, se arranca un cronómetro nuevo.
  useEffect(() => {
    draftDisabledRef.current = false;
    clockSavedAtRef.current = 0;
    const restored = readSessionClock(clockStorage(), clockKey, Date.now());
    if (restored) {
      clockSavedAtRef.current = Date.now();
      setClock(restored);
      setResumedInfo({
        startedAtMs: restored.startedAtMs,
        deductedSec: Math.round(restored.awayDeductedMs / 1000),
      });
      writeSessionClock(clockStorage(), clockKey, restored, Date.now());
    } else {
      setClock(createSessionClock(Date.now()));
    }
  }, [clockKey]);

  // El reloj sólo alimenta el render: la duración real se deriva del ancla, así que
  // aunque este intervalo se estrangule en segundo plano el tiempo no se pierde.
  useEffect(() => {
    if (!clock) return;
    setNowTick(Date.now());
    const id = window.setInterval(() => {
      const nowMs = Date.now();
      setNowTick(nowMs);
      persistClock(nowMs);
    }, 1000);
    const onVisibility = () => {
      const nowMs = Date.now();
      setNowTick(nowMs);
      if (document.visibilityState === 'hidden') persistClock(nowMs, { immediate: true });
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
      persistClock(Date.now(), { immediate: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock, clockKey]);

  // Fin de descanso: se detecta por marca de tiempo, no restando segundos, para que
  // el aviso suene (o se corrija al volver) aunque el navegador congele el intervalo.
  useEffect(() => {
    if (restEndsAtMs === null) return;
    const leftMs = restEndsAtMs - Date.now();
    if (leftMs > 0) {
      const id = window.setTimeout(() => setNowTick(Date.now()), Math.min(leftMs, 1000));
      return () => window.clearTimeout(id);
    }
    if (!restBeeped) {
      setRestBeeped(true);
      if (soundEnabled) playTimerBeep();
    }
    setRestEndsAtMs(null);
    return undefined;
  }, [restEndsAtMs, restBeeped, soundEnabled]);

  function startRestTimer(seconds: number) {
    if (seconds <= 0) return;
    setRestEndsAtMs(Date.now() + seconds * 1000);
    setRestBeeped(false);
  }

  function skipRest() {
    setRestEndsAtMs(null);
    setRestBeeped(false);
  }

  function extendRest(seconds: number) {
    const nowMs = Date.now();
    setRestEndsAtMs((prev) => (prev === null ? nowMs + seconds * 1000 : Math.max(prev, nowMs) + seconds * 1000));
    setRestBeeped(false);
  }

  // Cerrar popup de confirmación con Escape si no se está guardando
  useEffect(() => {
    if (!confirmAction) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) {
        setConfirmAction(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirmAction, saving]);

  const elapsedSec = clock ? elapsedSessionSec(clock, nowTick || Date.now()) : 0;
  const paused = clock ? isSessionClockPaused(clock) : false;
  const restLeft =
    restEndsAtMs === null ? 0 : Math.max(0, Math.ceil((restEndsAtMs - (nowTick || Date.now())) / 1000));
  function togglePauseClock() {
    const nowMs = Date.now();
    const base = clock ?? createSessionClock(nowMs);
    const next = isSessionClockPaused(base) ? resumeSessionClock(base, nowMs) : pauseSessionClock(base, nowMs);
    clockRef.current = next;
    setClock(next);
    persistClock(nowMs, { immediate: true, next });
    setNowTick(nowMs);
  }

  function resolveItemImage(spec: RoutineExerciseItem | undefined): string | null {
    if (!spec) return null;
    if (spec.exerciseId in localExerciseImages) {
      return localExerciseImages[spec.exerciseId];
    }
    const isDefaultAsset = Boolean(spec.imageUrl && spec.imageUrl.startsWith(`/exercises/${spec.exerciseId}.`));
    return (isDefaultAsset ? exerciseImages?.[spec.exerciseId] : spec.imageUrl) || exerciseImages?.[spec.exerciseId] || null;
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
    // Al marcar la serie arranca el descanso; al desmarcar no se corta el que hubiera.
    if (!logs[exIdx]?.sets[setIdx]?.completed) {
      startRestTimer(restSeconds);
      // Marcar serie convierte la sesión en algo que merece la pena recuperar
      persistClock(Date.now(), { immediate: completedSetsRef.current === 0 });
    }
    setLogs((prev) =>
      prev.map((ex, i) => {
        if (i !== exIdx) return ex;
        return {
          ...ex,
          sets: ex.sets.map((s, j) => (j === setIdx ? { ...s, completed: !s.completed } : s)),
        };
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
  completedSetsRef.current = completedSets;
  const completedExercises = logs.filter((ex) => ex.sets.some((s) => s.completed)).length;
  const totalSets = logs.reduce((acc, ex) => acc + ex.sets.length, 0);
  const progressPct = totalSets > 0 ? Math.round((completedSets / totalSets) * 100) : 0;
  const totalVolumeKg = logs.reduce((acc, ex, idx) => {
    const spec = items[idx];
    const perDb = resolveIsPerDumbbell(
      { exerciseId: ex.exerciseId, perDumbbell: spec?.perDumbbell ?? ex.perDumbbell },
      exercisePerDumbbell?.[ex.exerciseId]
    );
    return (
      acc +
      ex.sets
        .filter((s) => s.completed)
        .reduce((sAcc, s) => sAcc + calculateStrengthSetVolumeKg(s, perDb), 0)
    );
  }, 0);

  async function finishWorkout() {
    setSaving(true);
    setFinishError(null);
    const completedLogs: StrengthSetLog[] = logs
      .map((ex) => ({
        ...ex,
        sets: ex.sets.filter((s) => s.completed),
      }))
      .filter((ex) => ex.sets.length > 0);
    // Medición honesta: lo que dice el cronómetro (con sus pausas descontadas) y,
    // como red de seguridad, la suma de las series temporizadas completadas.
    const measuredSec = clock ? elapsedSessionSec(clock, Date.now()) : 0;
    const timedSetSec = sumTimedSetSec(completedLogs);
    try {
      const res = await fetch('/api/routines/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          routineId,
          title: routineName,
          durationSec: Math.max(measuredSec, timedSetSec),
          startedAtMs: clock?.startedAtMs ?? null,
          rpe,
          notes,
          doneTogether,
          images: workoutImages,
          strengthLogs: completedLogs,
        }),
      });
      if (res.ok) {
        forgetSessionDraft();
        setConfirmAction(null);
        onCompleted();
      } else {
        setFinishError('No se pudo guardar el entrenamiento. Inténtalo de nuevo.');
      }
    } catch {
      setFinishError('Error de conexión al guardar el entrenamiento.');
    } finally {
      setSaving(false);
    }
  }

  function handleRequestClose() {
    if (completedSets > 0 || elapsedSec >= 10 || workoutImages.length > 0) {
      setFinishError(null);
      setConfirmAction('discard');
      return;
    }
    // Cierre trivial (nada hecho y casi sin tiempo): se descarta el ancla para que
    // la próxima sesión de esta rutina no arrastre este rato perdido.
    forgetSessionDraft();
    onClose();
  }

  function resetSessionClock() {
    const nowMs = Date.now();
    const fresh = createSessionClock(nowMs);
    draftDisabledRef.current = false;
    clockRef.current = fresh;
    setClock(fresh);
    persistClock(nowMs, { immediate: true, next: fresh });
    setResumedInfo(null);
    setNowTick(nowMs);
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
              onClick={handleRequestClose}
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
                style={{ borderColor: 'var(--border-subtle)', opacity: paused ? 0.6 : 1 }}
                title={paused ? 'Cronómetro en pausa: este tiempo no se cuenta' : 'Tiempo de la sesión'}
              >
                <Clock className={`h-3.5 w-3.5 ${paused ? 'text-amber-500' : 'text-primary'}`} />
                {formatDurationClock(elapsedSec)}
                {paused && <span className="font-sans text-[10px] uppercase tracking-wide">pausa</span>}
              </div>
              <button
                type="button"
                onClick={togglePauseClock}
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
                onClick={() => extendRest(15)}
                className="px-3 py-1.5 rounded-lg bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 text-xs font-semibold hover:bg-cyan-500/30 min-h-[34px]"
              >
                +15s
              </button>
              <button
                type="button"
                onClick={skipRest}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-sunken text-ink text-xs font-semibold border border-line min-h-[34px]"
              >
                <SkipForward className="h-3.5 w-3.5" /> Saltar
              </button>
            </div>
          </div>
        )}

        {previousSession && prefilledExerciseCount > 0 && (
          <div
            className="mx-3 mt-3 sm:mx-5 sm:mt-4 rounded-xl border px-3 py-2 text-[11px] sm:text-xs flex items-start gap-2 animate-fade-in"
            style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-card-elevated)', color: 'var(--text-secondary)' }}
          >
            <History className="h-3.5 w-3.5 mt-0.5 shrink-0 text-cyan-500" />
            <span>
              Repeticiones y peso precargados de tu sesión del{' '}
              <strong className="font-semibold">
                {new Date(previousSession.startedAt).toLocaleDateString('es-ES', {
                  day: 'numeric',
                  month: 'short',
                  year: previousSession.startedAt.includes('-') ? '2-digit' : undefined,
                })}
              </strong>{' '}
              ({prefilledExerciseCount} de {items.length}{' '}
              {prefilledExerciseCount === 1 ? 'ejercicio' : 'ejercicios'}).
              {prefilledExerciseCount < items.length
                ? ' Los que no hiciste aquella vez mantienen los valores de la rutina.'
                : ''}
            </span>
          </div>
        )}

        {resumedInfo && (
          <div
            className="mx-3 mt-3 sm:mx-5 sm:mt-4 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[11px] sm:text-xs flex flex-wrap items-center gap-2 animate-fade-in"
          >
            <Clock className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="flex-1 min-w-[180px] text-amber-800 dark:text-amber-300">
              Sesión retomada: empezó a las{' '}
              <strong className="font-semibold">
                {new Date(resumedInfo.startedAtMs).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
              </strong>
              . El cronómetro sigue contando aunque el navegador congele la pestaña o apagues la pantalla.
              {resumedInfo.deductedSec > 0
                ? ` Se han descontado ${formatDurationClock(resumedInfo.deductedSec)} con la app cerrada.`
                : ''}
            </span>
            {resumedInfo.deductedSec > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (!clock) return;
                  const nowMs = Date.now();
                  const next = keepAwayTime(clock, nowMs);
                  clockRef.current = next;
                  setClock(next);
                  persistClock(nowMs, { immediate: true, next });
                  setNowTick(nowMs);
                  setResumedInfo((prev) => (prev ? { ...prev, deductedSec: 0 } : prev));
                }}
                className="rounded-lg border border-amber-500/40 px-2 py-1 text-[11px] font-semibold text-amber-800 dark:text-amber-300 hover:bg-amber-500/15 min-h-[32px]"
              >
                Contar igualmente
              </button>
            )}
            <button
              type="button"
              onClick={resetSessionClock}
              className="rounded-lg border border-amber-500/40 px-2 py-1 text-[11px] font-semibold text-amber-800 dark:text-amber-300 hover:bg-amber-500/15 min-h-[32px]"
            >
              Empezar de cero
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto overscroll-contain p-3 sm:p-5 space-y-4">
          {logs.map((ex, exIdx) => {
            const spec = items[exIdx];
            const timed = isTimedReps(spec?.reps);
            const perDb = resolveIsPerDumbbell(
              { exerciseId: ex.exerciseId, perDumbbell: spec?.perDumbbell ?? ex.perDumbbell },
              exercisePerDumbbell?.[ex.exerciseId]
            );
            const isSingleDb =
              !perDb &&
              (isSingleDumbbellByDefault(ex.exerciseId) || Boolean(spec?.requiredEquipment?.includes('dumbbells')));
            const rowWeights = weightInputs[exIdx] ?? [];
            const firstWeightRaw = rowWeights.find((w) => parseDecimalInput(w) > 0) ?? '';
            const latestWeightNum = [...rowWeights].reverse().map(parseDecimalInput).find((w) => w > 0) ?? 0;
            const hasEmptyWeightSlot = rowWeights.some((w) => w.trim() === '');
            // Referencia de la última vez: la de esta misma rutina si existe,
            // si no la última vez global que se hizo ese ejercicio.
            const prevSets = previousLogs?.[ex.exerciseId]?.sets ?? lastExerciseLogs?.[ex.exerciseId]?.sets ?? [];
            const prevDate =
              previousLogs?.[ex.exerciseId]
                ? previousSession?.startedAt ?? null
                : lastExerciseLogs?.[ex.exerciseId]?.startedAt ?? null;
            const prefilledSets = initialRows[exIdx]?.prefilledSets ?? 0;
            const imageUrl = resolveItemImage(spec);
            const exVolumeKg = Math.round(
              ex.sets
                .filter((s) => s.completed)
                .reduce((acc, s) => acc + calculateStrengthSetVolumeKg(s, perDb), 0)
            );

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
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-bold text-sm sm:text-base leading-snug">
                            {exIdx + 1}. {ex.exerciseName}
                          </span>
                          {perDb && (
                            <span
                              className="inline-flex items-center rounded-md border border-purple-500/35 bg-purple-500/15 px-2 py-0.5 text-[10px] font-semibold text-purple-700 dark:text-purple-300"
                              title="Anota el peso de 1 mancuerna; el volumen total se multiplica por 2"
                            >
                              Por mancuerna (×2)
                            </span>
                          )}
                          {isSingleDb && (
                            <span
                              className="inline-flex items-center rounded-md border border-cyan-500/35 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-700 dark:text-cyan-300"
                              title="Ejercicio con una sola mancuerna"
                            >
                              1 mancuerna
                            </span>
                          )}
                        </div>
                        <div className="text-xs mt-0.5 flex flex-wrap items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                          <span>
                            Objetivo: {spec?.reps} · Descanso: {spec?.restSeconds ?? 60}s
                          </span>
                          {prefilledSets > 0 && (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border border-cyan-500/35 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
                              title={`Series ${prefilledSets} de ${ex.sets.length} copiadas de tu última sesión de esta rutina`}
                            >
                              <History className="h-2.5 w-2.5" />
                              {prefilledSets === ex.sets.length
                                ? 'Última sesión cargada'
                                : `${prefilledSets} serie(s) de la última sesión`}
                            </span>
                          )}
                        </div>
                        {prevDate && prevSets.length > 0 && (
                          <div className="text-[11px] mt-0.5 text-cyan-600 dark:text-cyan-400 tabular-nums">
                            Último ({new Date(prevDate).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })})
                            {previousLogs?.[ex.exerciseId] ? ' en esta rutina' : ''}:{' '}
                            {prevSets
                              .map((s) => (s.weightKg > 0 ? `${s.weightKg} kg${perDb ? ' c/u' : ''}` : 'corporal'))
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
                          <Copy className="h-3 w-3" /> Igualar {firstWeightRaw} kg{perDb ? ' c/u' : ''}
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
                          placeholder={perDb ? 'kg c/u' : 'Peso'}
                          aria-label={`${ex.exerciseName} serie ${setIdx + 1} ${perDb ? 'peso por mancuerna en kg' : 'peso en kg'}`}
                          value={weightInputs[exIdx]?.[setIdx] ?? ''}
                          onChange={(e) => updateSetWeightInput(exIdx, setIdx, e.target.value)}
                          className="w-16 sm:w-20 rounded-lg border px-1.5 py-1.5 text-base sm:text-xs font-semibold text-center tabular-nums"
                          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
                        />
                        <span
                          className="text-[11px] sm:text-xs shrink-0"
                          style={{ color: perDb ? 'var(--text-secondary)' : 'var(--text-muted)' }}
                          title={perDb ? 'Peso de una sola mancuerna (kg cada una)' : undefined}
                        >
                          {perDb ? 'kg c/u' : 'kg'}
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
                  {perDb && (
                    <div
                      className="text-[11px] flex flex-wrap items-center justify-between gap-2 px-1 pt-0.5"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <span>Anota el peso de 1 mancuerna (el volumen cuenta ×2).</span>
                      {(latestWeightNum > 0 || exVolumeKg > 0) && (
                        <span className="font-semibold text-purple-600 dark:text-purple-300 tabular-nums">
                          {latestWeightNum > 0
                            ? `Par: ${Math.round(latestWeightNum * 2 * 100) / 100} kg`
                            : ''}
                          {exVolumeKg > 0
                            ? `${latestWeightNum > 0 ? ' · ' : ''}Vol.: ${exVolumeKg} kg`
                            : ''}
                        </span>
                      )}
                    </div>
                  )}
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
            onClick={() => {
              setFinishError(null);
              setConfirmAction('finish');
            }}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 px-5 py-3 sm:py-2.5 text-sm font-bold text-white transition-colors min-h-[44px]"
          >
            <CheckCircle2 className="h-4 w-4" />
            {saving ? 'Guardando...' : 'Finalizar y Guardar Entreno'}
          </button>
        </div>
      </div>

      {/* Popup de confirmación antes de finalizar o descartar el entrenamiento */}
      {confirmAction && (
        <div
          className="fixed inset-0 z-[60] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="workout-confirm-title"
          onClick={() => {
            if (!saving) setConfirmAction(null);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border p-5 space-y-4 shadow-2xl"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-1.5">
              <div
                className={`text-[11px] font-bold uppercase tracking-wider ${
                  confirmAction === 'finish'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {confirmAction === 'finish' ? 'Confirmar finalización' : 'Salir del entrenamiento'}
              </div>
              <h4 id="workout-confirm-title" className="text-lg font-bold leading-snug">
                {confirmAction === 'finish'
                  ? '¿Seguro que quieres acabar el entreno?'
                  : '¿Seguro que quieres salir sin guardar?'}
              </h4>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {confirmAction === 'finish'
                  ? 'Se guardará la sesión en tu historial y se actualizará tu volumen y carga física (TSS).'
                  : 'Si sales ahora, perderás las series, pesos y el tiempo registrado en esta sesión.'}
              </p>
            </div>

            <div
              className="grid grid-cols-3 gap-2 rounded-xl border p-3 text-center"
              style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
            >
              <div>
                <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                  Tiempo
                </div>
                <div className="text-sm font-bold tabular-nums">{formatDurationClock(elapsedSec)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                  Ejercicios / Series
                </div>
                <div className="text-sm font-bold tabular-nums">
                  {completedExercises}/{logs.length} · {completedSets}/{totalSets}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                  Volumen
                </div>
                <div className="text-sm font-bold tabular-nums">{Math.round(totalVolumeKg)} kg</div>
              </div>
            </div>

            {confirmAction === 'finish' && (completedSets < totalSets || completedExercises < logs.length) && (
              <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                {completedSets === 0
                  ? 'Aún no has marcado ningún ejercicio o serie como completado. No aparecerá ningún ejercicio hecho si guardas así.'
                  : `Solo se guardarán los ${completedExercises} ejercicios y ${completedSets} series que hayas marcado como completados.`}
              </div>
            )}

            {finishError && (
              <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-600 dark:text-rose-400">
                {finishError}
              </div>
            )}

            <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={saving}
                onClick={() => setConfirmAction(null)}
                className="rounded-xl border px-4 py-2.5 text-sm font-semibold hover:bg-sunken transition-colors min-h-[44px]"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                Seguir entrenando
              </button>
              {confirmAction === 'finish' ? (
                <button
                  type="button"
                  disabled={saving}
                  onClick={finishWorkout}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 px-4 py-2.5 text-sm font-bold text-white transition-colors min-h-[44px]"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  {saving ? 'Guardando...' : 'Sí, acabar y guardar'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    forgetSessionDraft();
                    setConfirmAction(null);
                    onClose();
                  }}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 hover:bg-rose-700 px-4 py-2.5 text-sm font-bold text-white transition-colors min-h-[44px]"
                >
                  Descartar sesión
                </button>
              )}
            </div>
          </div>
        </div>
      )}

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
