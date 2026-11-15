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
  assessElevationNeed,
  buildMapElevation,
  elevationCacheKey,
  fetchElevations,
  pickElevationSamples,
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

const DISABLED = new Set(['none', 'off', '0', '', 'false']);

/** `BILIFIT_DEM_URL` permite apuntar a otro proveedor; `none` lo apaga. */
export function resolveElevationProviderUrl(config: ElevationProviderConfig = {}): string | null {
  const explicit = config.url;
  if (explicit !== undefined) return DISABLED.has(explicit.trim().toLowerCase()) ? null : explicit;
  const fromEnv = (process.env.BILIFIT_DEM_URL ?? '').trim();
  if (DISABLED.has(fromEnv.toLowerCase())) return null;
  return fromEnv || null;
}

/** 'none' = el proveedor está desactivado (entonces no se intenta ninguna llamada). */
export function elevationProviderEnabled(config: ElevationProviderConfig = {}): boolean {
  return resolveElevationProviderUrl(config) !== null;
}

/**
 * Rellena la altitud de una actividad a partir del modelo digital del terreno.
 * Best-effort por diseño: si el servicio falla devuelve 'error' y no toca nada.
 */
export async function reconstructActivityElevation(
  activity: ActivityDetail,
  options: ElevationProviderConfig & { force?: boolean; refresh?: boolean } = {}
): Promise<ElevationUpdateResult> {
  const url = resolveElevationProviderUrl(options);
  if (url === null) {
    return { status: 'skipped', reason: 'proveedor_desactivado' };
  }

  const mapProfileBefore = activity.extras?.elevationSource === 'map';
  // Un perfil previo puesto por nosotros sin sesgo corregible no contenía altitud real
  // del reloj: al refrescar se parte de cero, que si no la interpolación anterior se
  // tomaría como dato del reloj y el cálculo no cambiaría nunca.
  const nothingToDevice = Math.abs(Number(activity.extras?.elevationBiasM ?? 0)) < 0.05;
  const rewriteMapProfile = mapProfileBefore && options.refresh === true && nothingToDevice;
  const points = rewriteMapProfile
    ? (activity.points ?? []).map((p) => (p.ele === undefined ? p : { ...p, ele: undefined }))
    : (activity.points ?? []);
  const need = assessElevationNeed({
    sport: activity.sport,
    points,
    elevationGain: activity.elevationGain,
    elevationLoss: activity.elevationLoss,
    // Con `force` se rehace aunque el reloj trajera altitud a medias
    allowPartial: options.force === true,
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
  const result = await reconstructActivityElevation(activity, { ...options, force: true });
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
  for (const id of ids) {
    const activity = getActivityById(id);
    if (!activity) {
      summary.skipped++;
      continue;
    }
    try {
      const res = await reconstructActivityElevation(activity, options);
      if (res.status === 'updated') summary.updated++;
      else if (res.status === 'skipped') summary.skipped++;
      else {
        summary.failed++;
        summary.error = res.error ?? summary.error;
      }
    } catch (err) {
      summary.failed++;
      summary.error = err instanceof Error ? err.message : 'Error consultando el modelo de elevaciones';
    }
    done++;
    options.onProgress?.(done, ids.length);
  }

  if (summary.updated === 0 && summary.failed > 0) summary.status = 'error';
  else if (summary.updated === 0) summary.status = 'skipped';
  return summary;
}
