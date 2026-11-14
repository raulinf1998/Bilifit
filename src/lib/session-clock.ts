/**
 * Cronómetro de una sesión de entrenamiento en curso.
 *
 * Por qué existe este módulo
 * --------------------------
 * Antes, la duración de una sesión se contaba sumando «+1» en un
 * `setInterval(..., 1000)`. Los navegadores móviles estrangulan o congelan los
 * temporizadores en segundo plano (Chrome/Android llega a ~1 tick por minuto
 * con la pestaña oculta; iOS/Safari y las PWA directamente paran el reloj hasta
 * que vuelves), así que quien entrenaba una hora con el móvil en el bolsillo
 * guardaba sesiones de 20-40 minutos. Aquí no se cuentan ticks: se guarda una
 * **ancla en tiempo real** (`startedAtMs`) y la duración se *deriva* de
 * `Date.now()`, de modo que el tiempo real transcurrido se recupere siempre,
 * se haya disparado el intervalo o no.
 *
 * Reglas de recuento:
 *  - Lo que pasa mientras la app está abierta cuenta, aunque la pantalla esté
 *    apagada o la pestaña en segundo plano (descansos entre series incluidos).
 *  - La pausa manual no cuenta (se acumula en `pausedAccumMs`).
 *  - Si la página se cierra/recarga en mitad de la sesión, el ancla se recupera
 *    de `localStorage`; el rato que la app estuvo cerrada sí se descuenta,
 *    salvo una tolerancia de `OFFAPP_GRACE_SEC` (5 min) para cubrir un simple
 *    refresco o cambiar de app un momento. El descuento es reversible desde el
 *    aviso del reproductor.
 */

/** Mínimo que se guarda en el historial: evita actividades de 0 segundos. */
export const MIN_TRACKED_SESSION_SEC = 60;
/** Techo de sanidad: una sesión no puede durar más de 8 horas. */
export const MAX_TRACKED_SESSION_SEC = 8 * 3600;
/** Tiempo fuera de la app que sigue contando antes de descontar nada. */
export const OFFAPP_GRACE_SEC = 300;
/** Por encima de esto, una sesión guardada a medias ya no se recupera. */
export const RESUMABLE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const CLOCK_STORAGE_PREFIX = 'bilifit:session-clock:v1:';

export type SessionClock = {
  /** Momento real (epoch ms) en el que empezó la sesión. */
  startedAtMs: number;
  /** Segundos en ms que NO cuentan: pausas manuales + ratos con la app cerrada. */
  pausedAccumMs: number;
  /** Inicio de la pausa manual en curso, o null si el reloj va corriendo. */
  pausedAtMs: number | null;
  /** Cuánto se descontó por tener la app cerrada (para poder revertirlo). */
  awayDeductedMs: number;
  /** Último instante conocido del reloj; solo se persiste, no afecta al cálculo. */
  savedAtMs: number;
};

export type ClockStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function nonNegativeFinite(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function createSessionClock(nowMs: number): SessionClock {
  const now = Math.max(0, Math.round(nowMs));
  return { startedAtMs: now, pausedAccumMs: 0, pausedAtMs: null, awayDeductedMs: 0, savedAtMs: now };
}

export function isSessionClockPaused(clock: SessionClock): boolean {
  return clock.pausedAtMs !== null;
}

/** Milisegundos transcurridos desde el ancla, sin pausas ni descuentos. */
export function elapsedSessionMs(clock: SessionClock, nowMs: number): number {
  const now = Math.max(clock.startedAtMs, nowMs);
  const pausedNow = clock.pausedAtMs !== null ? Math.max(0, now - clock.pausedAtMs) : 0;
  const runningMs = now - clock.startedAtMs - clock.pausedAccumMs - pausedNow;
  return Math.max(0, Math.round(runningMs));
}

export function elapsedSessionSec(clock: SessionClock, nowMs: number): number {
  return Math.floor(elapsedSessionMs(clock, nowMs) / 1000);
}

export function pauseSessionClock(clock: SessionClock, nowMs: number): SessionClock {
  if (clock.pausedAtMs !== null) return clock;
  return { ...clock, pausedAtMs: Math.max(clock.startedAtMs, Math.round(nowMs)), savedAtMs: Math.round(nowMs) };
}

export function resumeSessionClock(clock: SessionClock, nowMs: number): SessionClock {
  if (clock.pausedAtMs === null) return clock;
  const now = Math.max(clock.pausedAtMs, Math.round(nowMs));
  return {
    ...clock,
    pausedAccumMs: clock.pausedAccumMs + (now - clock.pausedAtMs),
    pausedAtMs: null,
    savedAtMs: now,
  };
}

/** Devuelve el tiempo descontado por tener la app cerrada a un cálculo previo. */
export function keepAwayTime(clock: SessionClock, nowMs: number): SessionClock {
  if (clock.awayDeductedMs <= 0) return clock;
  return {
    ...clock,
    pausedAccumMs: Math.max(0, clock.pausedAccumMs - clock.awayDeductedMs),
    awayDeductedMs: 0,
    savedAtMs: Math.round(nowMs),
  };
}

/**
 * Reinicia el reloj tras haber estado la app cerrada: sólo cuenta como
 * entrenamiento el rato que la app pudo seguir midiendo (gracia incluida).
 */
export function adoptResumedClock(clock: SessionClock, nowMs: number, graceSec = OFFAPP_GRACE_SEC): SessionClock {
  const now = Math.max(0, Math.round(nowMs));
  if (clock.pausedAtMs !== null) {
    // Estaba en pausa manual: la pausa empezó al pausar y sigue abierta, así que ya
    // cubre el rato con la app cerrada. No se descuento nada y no se pierde el ancla.
    return { ...clock, savedAtMs: now };
  }
  const awayMs = Math.max(0, now - nonNegativeFinite(clock.savedAtMs, now));
  const deducted = Math.max(0, awayMs - Math.max(0, graceSec) * 1000);
  return {
    ...clock,
    pausedAccumMs: clock.pausedAccumMs + deducted,
    awayDeductedMs: clock.awayDeductedMs + deducted,
    savedAtMs: now,
  };
}

export function sessionClockStorageKey(routineIdOrName: string): string {
  return `${CLOCK_STORAGE_PREFIX}${routineIdOrName}`;
}

export function serializeSessionClock(clock: SessionClock, nowMs = Date.now()): string {
  return JSON.stringify({ ...clock, savedAtMs: Math.round(nowMs) });
}

/** Valida el ancla guardada; devuelve null si no es recuperable. */
export function parseSessionClock(raw: string | null | undefined, nowMs: number): SessionClock | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const c = data as Partial<SessionClock>;
  const now = Math.max(0, Math.round(nowMs));
  const startedAtMs = Number(c.startedAtMs);
  if (!Number.isFinite(startedAtMs) || startedAtMs <= 0 || startedAtMs > now) return null;
  if (now - startedAtMs > RESUMABLE_MAX_AGE_MS) return null; // sesión abandonada hace demasiado
  const pausedAccumMs = nonNegativeFinite(c.pausedAccumMs);
  if (pausedAccumMs > now - startedAtMs) return null; // datos corruptos
  const pausedAtMs = Number.isFinite(Number(c.pausedAtMs)) && Number(c.pausedAtMs) >= startedAtMs ? Number(c.pausedAtMs) : null;
  const savedAtMs = Math.min(now, Math.max(startedAtMs, nonNegativeFinite(c.savedAtMs, startedAtMs)));
  return {
    startedAtMs: Math.round(startedAtMs),
    pausedAccumMs: Math.round(pausedAccumMs),
    pausedAtMs: pausedAtMs === null ? null : Math.round(pausedAtMs),
    awayDeductedMs: Math.round(nonNegativeFinite(c.awayDeductedMs)),
    savedAtMs: Math.round(savedAtMs),
  };
}

/** Recupera el ancla de la sesión en curso (o null si no hay ninguna). */
export function readSessionClock(storage: ClockStorage | null, key: string, nowMs: number): SessionClock | null {
  if (!storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  const parsed = parseSessionClock(raw, nowMs);
  return parsed ? adoptResumedClock(parsed, nowMs) : null;
}

export function writeSessionClock(storage: ClockStorage | null, key: string, clock: SessionClock, nowMs = Date.now()): void {
  if (!storage) return;
  try {
    storage.setItem(key, serializeSessionClock(clock, nowMs));
  } catch {
    // Almacenamiento no disponible (modo privado, cuota llena): la sesión sigue siendo válida.
  }
}

export function clearSessionClock(storage: ClockStorage | null, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // Ignorar
  }
}

/**
 * Duración final de la sesión. Se usa el tiempo medido por el cronómetro; si no
 * hay medición fiable se recurre a la suma de las series temporizadas. Nunca se
 * rellena con una duración inventada, y el resultado se recorta al rango
 * [1 min, 8 h] en vez de forzar un mínimo de 5 minutos.
 */
export function resolveSessionDurationSec(input: { reportedSec?: unknown; timedSetSec?: unknown }): number {
  const reported = nonNegativeFinite(input.reportedSec);
  const timed = nonNegativeFinite(input.timedSetSec);
  const measured = Math.max(reported, timed);
  return Math.min(MAX_TRACKED_SESSION_SEC, Math.max(MIN_TRACKED_SESSION_SEC, Math.round(measured)));
}

/** Segundos de trabajo temporalizado realmente hechos (series de «45 seg»). */
export function sumTimedSetSec(logs: Array<{ sets?: Array<{ completed?: boolean; durationSec?: number | null }> | null }> | null | undefined): number {
  if (!Array.isArray(logs)) return 0;
  let total = 0;
  for (const ex of logs) {
    for (const s of ex?.sets ?? []) {
      if (!s || !s.completed) continue;
      total += nonNegativeFinite(s.durationSec);
    }
  }
  return Math.round(total);
}
