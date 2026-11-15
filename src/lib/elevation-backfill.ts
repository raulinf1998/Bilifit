/**
 * Reconstrucción del perfil de altitud desde el GPS (como hace Strava con
 * "Ground elevation from map") para relojes sin barómetro — el caso de un
 * Huawei sin altímetro, donde las salidas se guardan con desnivel 0.
 *
 * Capa con acceso a datos: usa la caché local de altitudes (`elevation_cache`)
 * y escribe el resultado recalculando lo derivado (laps, splits, extras, TSS).
 * La matemática y el cliente del DEM están en `@/lib/elevation`.
 */

import { computeSessionExtras, enrichActivityLaps, enrichPointsTelemetry } from '@/lib/analytics';
import {
  getActivityById,
  getCachedElevations,
  getAthleteProfile,
  listElevationCandidateIds,
  storeElevationCache,
  writeActivityElevation,
} from '@/lib/db';
import {
  OPEN_METEO_ELEVATION_URL,
  assessElevationNeed,
  buildMapElevation,
  deviceElevationStats,
  elevationCacheKey,
  fetchElevations,
  pickElevationSamples,
  stripPointElevation,
} from '@/lib/elevation';
import { calculateNormalizedPower, estimateActivityTSS } from '@/lib/metrics';
import type { ActivityDetail } from '@/types';

export type ElevationStatus = 'updated' | 'skipped' | 'error';

export type ElevationUpdateResult = {
  status: ElevationStatus;
  reason?: string;
  error?: string;
  gain?: number;
  loss?: number;
  maxEle?: number;
  minEle?: number;
  samples?: number;
  fromCache?: number;
  fetched?: number;
};

export type ElevationStageSummary = {
  status: 'ok' | 'skipped' | 'error';
  candidates: number;
  updated: number;
  skipped: number;
  failed: number;
  error?: string;
  reason?: string;
};

export type ElevationProviderConfig = {
  /** URL del servicio de elevaciones; 'none'/'off' lo apaga. */
  url?: string;
  fetchImpl?: typeof fetch;
};

/** Cortacircuitos del backfill: nº de salidas fallando seguidas antes de rendirse. */
export const ELEVATION_MAX_CONSECUTIVE_FAILURES = 3;

const DISABLED = new Set(['none', 'off', '0', 'false']);

/** `BILIFIT_DEM_URL` permite apuntar a otro proveedor; `none` lo apaga. */
export function resolveElevationProviderUrl(config: ElevationProviderConfig = {}): string | null {
  const explicit = config.url;
  const configured = (explicit ?? process.env.BILIFIT_DEM_URL ?? '').trim();
  if (DISABLED.has(configured.toLowerCase())) return null;
  return configured || OPEN_METEO_ELEVATION_URL;
}

/** 'none' = el proveedor está desactivado (entonces no se intenta ninguna llamada). */
export function elevationProviderEnabled(config: ElevationProviderConfig = {}): boolean {
  return resolveElevationProviderUrl(config) !== null;
}

/**
 * Rellena la altitud de una actividad a partir del modelo digital del terreno.
 *
 * Best-effort por diseño: si el servicio falla devuelve 'error' y no toca nada. Y
 * antes de nada está la regla que protege lo que ya está medido — si el reloj grabó
 * una altitud real EN UN SOLO PUNTO, se sale por 'skipped' sin consultar la red ni
 * reescribir nada. Sólo se estiman las salidas que no tienen ningún dato de altura.
 */
export async function reconstructActivityElevation(
  activity: ActivityDetail,
  options: ElevationProviderConfig & { refresh?: boolean } = {}
): Promise<ElevationUpdateResult> {
  const url = resolveElevationProviderUrl(options);
  if (url === null) {
    return { status: 'skipped', reason: 'proveedor_desactivado' };
  }

  const rawPoints = activity.points ?? [];
  const stats = deviceElevationStats(rawPoints);
  const mapProfileBefore = activity.extras?.elevationSource === 'map';
  // También proteger una cota grabada en un punto sin coordenadas GPS.
  if (!mapProfileBefore && rawPoints.some((p) => typeof p.ele === 'number' && Number.isFinite(p.ele) && p.ele !== 0)) {
    return { status: 'skipped', reason: 'altimetro' };
  }

  // Dos situaciones en las que lo que hay en `ele` no es una medición del reloj y,
  // por tanto, se puede tirar y sustituir por el perfil del mapa:
  //   · relleno a 0 — el Huawei típico sin barómetro, que escribe `ele: 0` en todo;
  //   · «Volver a estimar» sobre un perfil que pusimos nosotros y que no tenía ningún
  //     punto real con el que corregir sesgo (si no, la estimación anterior se tomaba
  //     como dato del reloj y el cálculo no cambiaría nunca).
  const nothingToDevice = Math.abs(Number(activity.extras?.elevationBiasM ?? 0)) < 0.05;
  const refreshingOwnProfile = mapProfileBefore && options.refresh === true && nothingToDevice;
  // Un track rellenado a 0 sólo es "sin dato" si el resumen tampoco trae desnivel: si
  // lo trae, lo midió el barómetro y se quedó en la cabecera, y ése sí es su dato.
  const summaryHasDesnivel =
    Math.max(0, Number(activity.elevationGain ?? 0)) > 0 || Math.max(0, Number(activity.elevationLoss ?? 0)) > 0;
  const fillerZeros = stats.withEle > 0 && stats.usableEle === 0 && !summaryHasDesnivel;
  const replaceEle = fillerZeros || refreshingOwnProfile;
  const points = replaceEle ? stripPointElevation(rawPoints) : rawPoints;

  const need = assessElevationNeed({
    sport: activity.sport,
    points,
    // Al rehacer un perfil nuestro, el desnivel que figura en la ficha salió de ese
    // mismo perfil: no puede usarse como motivo para no rehacerlo.
    elevationGain: refreshingOwnProfile ? 0 : activity.elevationGain,
    elevationLoss: refreshingOwnProfile ? 0 : activity.elevationLoss,
  });
  if (!need.needed) {
    // Ojo: 'altimetro' también salta cuando la altitud la pusimos nosotros — si el
    // origen era el mapa, el mensaje correcto es "ya estimado", no "tu reloj ya medía".
    const reason = mapProfileBefore && need.reason === 'altimetro' ? 'ya_estimada' : need.reason;
    return { status: 'skipped', reason };
  }

  const samples = pickElevationSamples(points);
  if (samples.length < 2) {
    return { status: 'skipped', reason: 'sin_muestras' };
  }

  const keys = samples.map((s) => elevationCacheKey(s.lat, s.lon));
  const cached = options.refresh ? new Map<string, number>() : getCachedElevations(keys);
  const missingIdx: number[] = [];
  samples.forEach((s, i) => {
    if (!cached.has(keys[i])) missingIdx.push(i);
  });

  let fetchedCount = 0;
  const fetchedByIndex = new Map<number, number | null>();
  if (missingIdx.length > 0) {
    const list = await fetchElevations(
      missingIdx.map((i) => [samples[i].lat, samples[i].lon] as [number, number]),
      { fetchImpl: options.fetchImpl, url: url ?? undefined }
    );
    const store: Array<{ key: string; ele: number }> = [];
    missingIdx.forEach((sampleIdx, k) => {
      const ele = list[k] ?? null;
      fetchedByIndex.set(sampleIdx, ele);
      if (typeof ele === 'number') {
        store.push({ key: keys[sampleIdx], ele });
        fetchedCount++;
      }
    });
    if (store.length > 0) storeElevationCache(store);
  }

  const sampleEle = samples.map((s, i) => cached.get(keys[i]) ?? fetchedByIndex.get(i) ?? null);
  const built = buildMapElevation({ points, samples, sampleEle });
  if (!built) {
    return { status: 'error', error: 'El servicio de elevaciones no tiene dato para este recorrido' };
  }

  // El enriquecimiento añade además la pendiente (grade) de cada punto
  const enrichedPoints = enrichPointsTelemetry(built.points, activity.sport);
  const enrichedLaps = enrichActivityLaps(activity.laps ?? [], enrichedPoints, {
    durationSec: activity.durationSec,
    movingTimeSec: activity.movingTimeSec,
    excludePausedTime: Boolean(activity.excludePausedTime),
  });
  const nowIso = new Date().toISOString();
  const extras = computeSessionExtras(
    {
      sport: activity.sport,
      durationSec: activity.durationSec,
      movingTimeSec: activity.movingTimeSec,
      distanceMeters: activity.distanceMeters,
      elevationGain: built.gain,
      avgSpeedMs: activity.avgSpeedMs ?? null,
      avgHr: activity.avgHr ?? null,
      avgWatts: activity.avgWatts ?? null,
      normalizedPower: activity.normalizedPower ?? null,
      excludePausedTime: Boolean(activity.excludePausedTime),
      extras: {
        ...(activity.extras ?? {}),
        maxEle: null,
        minEle: null,
        elevationSource: 'map',
        elevationSamples: built.samples,
        elevationUpdatedAt: nowIso,
        elevationBiasM: built.biasM,
      },
    },
    enrichedPoints
  );

  const normalizedPower =
    activity.normalizedPower ?? (enrichedPoints.length > 10 ? calculateNormalizedPower(enrichedPoints) : null);
  const tss = estimateActivityTSS(
    {
      sport: activity.sport,
      durationSec: activity.durationSec,
      movingTimeSec: activity.movingTimeSec,
      avgWatts: activity.avgWatts ?? null,
      normalizedPower,
      avgHr: activity.avgHr ?? null,
      rpe: activity.rpe ?? null,
      elevationGain: built.gain,
    },
    getAthleteProfile()
  );

  // La consulta externa puede tardar: no sobrescribir una edición o importación
  // concurrente que haya añadido datos del reloj mientras esperábamos.
  const current = getActivityById(activity.id);
  if (!current) return { status: 'error', error: 'La actividad ya no existe' };
  if (JSON.stringify(current.points) !== JSON.stringify(activity.points) ||
      current.elevationGain !== activity.elevationGain || current.elevationLoss !== activity.elevationLoss ||
      current.extras?.elevationSource !== activity.extras?.elevationSource) {
    return { status: 'skipped', reason: 'actividad_modificada' };
  }
  const saved = writeActivityElevation(activity.id, {
    points: enrichedPoints,
    laps: enrichedLaps,
    extras,
    elevationGain: built.gain,
    elevationLoss: built.loss,
    tss,
  });
  if (!saved) {
    return { status: 'error', error: 'La actividad ya no existe' };
  }

  return {
    status: 'updated',
    reason: need.reason,
    gain: built.gain,
    loss: built.loss,
    maxEle: built.maxEle,
    minEle: built.minEle,
    samples: built.samples,
    fromCache: samples.length - missingIdx.length,
    fetched: fetchedCount,
  };
}

/** Recarga el perfil de altitud de una actividad concreta (botón de la ficha). */
export async function reloadActivityElevation(
  id: string,
  options: ElevationProviderConfig & { refresh?: boolean } = {}
): Promise<{ result: ElevationUpdateResult; activity: ActivityDetail | null }> {
  const activity = getActivityById(id);
  if (!activity) {
    return { result: { status: 'error', error: 'Actividad no encontrada' }, activity: null };
  }
  const result = await reconstructActivityElevation(activity, options);
  return { result, activity: result.status === 'updated' ? getActivityById(id) : activity };
}

/** Backfill masivo: todas las salidas de exterior guardadas sin desnivel. */
export async function backfillMissingElevation(
  options: ElevationProviderConfig & { maxActivities?: number; onProgress?: (done: number, total: number) => void } = {}
): Promise<ElevationStageSummary> {
  if (!elevationProviderEnabled(options)) {
    return { status: 'skipped', candidates: 0, updated: 0, skipped: 0, failed: 0, reason: 'proveedor_desactivado' };
  }
  const limit = Math.max(1, Math.min(500, options.maxActivities ?? 40));
  const ids = listElevationCandidateIds(limit);
  const summary: ElevationStageSummary = {
    status: 'ok',
    candidates: ids.length,
    updated: 0,
    skipped: 0,
    failed: 0,
  };
  if (ids.length === 0) return summary;

  let done = 0;
  // Si el servicio no responde, cortar pronto: cada intento cuesta tiempo de espera y
  // el backfill va dentro de «Recargar datos», que el usuario está mirando.
  let consecutiveFailures = 0;
  for (const id of ids) {
    const activity = getActivityById(id);
    if (!activity) {
      summary.skipped++;
      done++;
      continue;
    }
    try {
      const res = await reconstructActivityElevation(activity, options);
      if (res.status === 'updated') {
        summary.updated++;
        consecutiveFailures = 0;
      } else if (res.status === 'skipped') {
        summary.skipped++;
        consecutiveFailures = 0;
      } else {
        summary.failed++;
        summary.error = res.error ?? summary.error;
        consecutiveFailures++;
      }
    } catch (err) {
      summary.failed++;
      summary.error = err instanceof Error ? err.message : 'Error consultando el modelo de elevaciones';
      consecutiveFailures++;
    }
    done++;
    options.onProgress?.(done, ids.length);
    if (consecutiveFailures >= ELEVATION_MAX_CONSECUTIVE_FAILURES) {
      const left = ids.length - done;
      summary.skipped += left;
      summary.error = `${
        summary.error ?? 'El servicio de elevaciones no responde'
      } — se para tras ${ELEVATION_MAX_CONSECUTIVE_FAILURES} fallos seguidos; quedan ${left} salidas para la próxima recarga.`;
      break;
    }
  }

  if (summary.updated === 0 && summary.failed > 0) summary.status = 'error';
  else if (summary.updated === 0) summary.status = 'skipped';
  return summary;
}

/** Intento al importar: una caída del proveedor nunca impide guardar la actividad. */
export async function estimateImportedElevation(activity: ActivityDetail): Promise<ActivityDetail> {
  try {
    const result = await reconstructActivityElevation(activity);
    if (result.status === 'updated') return getActivityById(activity.id) ?? activity;
    if (result.status === 'error') console.warn('Altitud automática:', result.error);
  } catch (error) {
    console.warn('No se pudo estimar la altitud automática:', error);
  }
  return activity;
}
