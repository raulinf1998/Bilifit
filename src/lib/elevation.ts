/**
 * Altitud estimada desde el GPS (modelo digital del terreno).
 *
 * Por qué: los relojes sin barómetro (p. ej. muchos Huawei) no graban altitud, así
 * que el desnivel sale 0 y el perfil de elevación queda vacío. Strava resuelve igual
 * el problema: cuando el archivo no trae altitud, muestrea la trayectoria GPS contra
 * un modelo digital del terreno (SRTM/Copernicus, ~30 m) y reconstruye el perfil.
 *
 * Este módulo hace esa reconstrucción:
 *   1. `assessElevationNeed` decide si una actividad necesita el dato: sólo exterior,
 *      con GPS y, sobre todo, SIN ni un punto de altitud medido por el reloj. Es una
 *      regla dura a propósito: lo que el dispositivo midió no se reescribe nunca, ni
 *      aunque el desnivel registrado sea 0 (una salida llana lo es, y punto).
 *   2. `pickElevationSamples` elige puntos separados por distancia (no por índice),
 *      para que una salida larga y un paseo corto tengan el mismo detalle vertical.
 *   3. `fetchElevations` consulta el DEM por lotes (Open-Meteo, sin clave).
 *   4. `buildMapElevation` interpola sobre TODOS los puntos, corrige el sesgo con la
 *      altitud que sí traía el reloj, suaviza el escalón de 30 m del DEM y recalcula
 *      desnivel + cotas con una histéresis mayor que la del barómetro.
 */

import { computeElevationGainLoss, haversineMeters } from '@/lib/polyline';
import type { ActivityPoint, SportType } from '@/types';

/** Deportes de exterior donde reconstruir el perfil tiene sentido. */
export const MAP_ELEVATION_SPORTS: SportType[] = ['running', 'trail', 'mountain', 'walking', 'cycling'];
/** Máximo de puntos consultados por actividad (2 peticiones de 100). */
export const MAX_ELEVATION_SAMPLES = 80;
/** Separación mínima entre muestras: por debajo de esto el DEM sólo añade ruido. */
export const MIN_SAMPLE_SPACING_M = 100;
/** Ventana de suavizado del perfil, en metros de distancia. */
export const ELEVATION_SMOOTH_WINDOW_M = 180;
/**
 * Banda muerta para sumar desnivel. El barómetro usa 2,5 m; una rejilla de 30 m
 * necesita más para que los escalones del mapa no se cuenten como repechos.
 */
export const DEM_HYSTERESIS_M = 6;
/** Puntos con GPS mínimos para intentarlo. */
export const MIN_GPS_POINTS = 3;

export const OPEN_METEO_ELEVATION_URL = 'https://api.open-meteo.com/v1/elevation';
export const ELEVATION_CHUNK_SIZE = 100;
export const ELEVATION_TIMEOUT_MS = 12_000;
export const ELEVATION_CHUNK_DELAY_MS = 120;

export type ElevationNeedReason = 'necesaria' | 'sin_gps' | 'corta' | 'altimetro' | 'desnivel' | 'interior';

export type ElevationNeed = {
  needed: boolean;
  reason: ElevationNeedReason;
  gpsPoints: number;
  knownEle: number;
  coverage: number;
  totalDistanceM: number;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * ¿Cuenta este valor como altitud medida por el reloj? Un cero no. Muchos Huawei
 * graban `ele: 0` en todos los puntos cuando no tienen sensor, y eso no es una
 * medición: es la constancia de que no había nada que medir.
 */
export function isDeviceEle(value: unknown): boolean {
  return isFiniteNumber(value) && value !== 0;
}

/**
 * Reparto de altitudes del reloj sobre los puntos con GPS: `withEle` son las que hay
 * escritas (incluidos los ceros de relleno) y `usableEle` las que son una medida real.
 */
export function deviceElevationStats(points: ActivityPoint[]): {
  gps: number;
  withEle: number;
  usableEle: number;
} {
  let gps = 0;
  let withEle = 0;
  let usableEle = 0;
  for (const p of points) {
    if (!isFiniteNumber(p.lat) || !isFiniteNumber(p.lon)) continue;
    gps++;
    if (isFiniteNumber(p.ele)) {
      withEle++;
      if (isDeviceEle(p.ele)) usableEle++;
    }
  }
  return { gps, withEle, usableEle };
}

/** Quita las altitudes escritas para que el mapa las rellene desde cero. */
export function stripPointElevation(points: ActivityPoint[]): ActivityPoint[] {
  return points.map((p) => (p.ele === undefined ? p : { ...p, ele: undefined }));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Distancia acumulada de la trayectoria, en metros. Se apoya en el GPS (que es lo
 * que luego se consulta contra el mapa) y, si un punto no tiene coordenadas,
 * conserva la distancia anterior en vez de inventar un salto.
 */
export function cumulativeDistances(points: ActivityPoint[]): number[] {
  const out: number[] = new Array(points.length).fill(0);
  let acc = 0;
  let lastGps: { lat: number; lon: number } | null = null;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (isFiniteNumber(p.lat) && isFiniteNumber(p.lon)) {
      const lat = p.lat;
      const lon = p.lon;
      if (lastGps) {
        const step = haversineMeters(lastGps.lat, lastGps.lon, lat, lon);
        // Un fix perdido no debe sumar kilómetros de la noche a la mañana
        if (step < 2000) acc += step;
      }
      lastGps = { lat, lon };
    }
    out[i] = acc;
  }
  return out;
}

/**
 * Decide si la altitud hay que reconstruirla desde el mapa.
 *
 * La condición de fondo es una sola y no tiene excepciones: **si el reloj midió
 * altitud en algún punto, no se toca nada**. El barómetro puede ser mediocre y el
 * desnivel puede salir corto, pero sigue siendo lo que midió el reloj; cambiarlo por
 * el DEM significaría reescribir el pasado cada vez que alguien pulse un botón. Las
 * salidas llanas con desnivel 0 están en el mismo saco: son llanas, no incompletas.
 *
 * Sí se reconstruye cuando las altitudes presentes son todas 0 (el relleno típico de
 * un reloj sin sensor) — la capa de arriba las quita antes de preguntar aquí.
 */
export function assessElevationNeed(input: {
  sport: SportType;
  points: ActivityPoint[];
  elevationGain?: number;
  elevationLoss?: number;
}): ElevationNeed {
  const points = input.points ?? [];
  const stats = deviceElevationStats(points);
  const distances = cumulativeDistances(points);
  const totalDistanceM = distances.length > 0 ? distances[distances.length - 1] : 0;

  const base = {
    gpsPoints: stats.gps,
    knownEle: stats.usableEle,
    coverage: stats.gps > 0 ? stats.usableEle / stats.gps : 0,
    totalDistanceM,
  };

  if (!MAP_ELEVATION_SPORTS.includes(input.sport)) {
    return { needed: false, reason: 'interior', ...base };
  }
  if (stats.gps < MIN_GPS_POINTS) {
    return { needed: false, reason: 'sin_gps', ...base };
  }
  if (totalDistanceM < MIN_SAMPLE_SPACING_M) {
    return { needed: false, reason: 'corta', ...base };
  }
  if (stats.usableEle > 0) {
    return { needed: false, reason: 'altimetro', ...base };
  }
  // Y tampoco si el resumen del archivo ya trae desnivel, aunque luego no venga en los
  // punto: ese número lo midió algo (barómetro omitido en el track, o el cálculo del
  // propio servicio), y sustituirlo por el del mapa sería cambiar el pasado.
  const flat = Math.max(0, Number(input.elevationGain ?? 0)) === 0 && Math.max(0, Number(input.elevationLoss ?? 0)) === 0;
  if (!flat) {
    return { needed: false, reason: 'desnivel', ...base };
  }
  return { needed: true, reason: 'necesaria', ...base };
}

export type ElevationSample = { index: number; distanceM: number; lat: number; lon: number };

/** Muestras repartidas a lo largo de la distancia recorrida. */
export function pickElevationSamples(
  points: ActivityPoint[],
  options: { maxSamples?: number; minSpacingM?: number; distances?: number[] } = {}
): ElevationSample[] {
  const maxSamples = Math.max(2, Math.min(MAX_ELEVATION_SAMPLES, options.maxSamples ?? MAX_ELEVATION_SAMPLES));
  const minSpacingM = Math.max(10, options.minSpacingM ?? MIN_SAMPLE_SPACING_M);
  const distances = options.distances ?? cumulativeDistances(points);
  const total = distances.length > 0 ? distances[distances.length - 1] : 0;
  if (total <= 0) return [];

  const wanted = Math.max(2, Math.min(maxSamples, Math.floor(total / minSpacingM) + 1));
  const stride = total / (wanted - 1);

  // Índice del punto con GPS más cercano a cada distancia objetivo
  const gpsOrder: Array<{ index: number; distanceM: number; lat: number; lon: number }> = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (isFiniteNumber(p.lat) && isFiniteNumber(p.lon)) {
      gpsOrder.push({ index: i, distanceM: distances[i], lat: p.lat, lon: p.lon });
    }
  }
  if (gpsOrder.length < 2) return [];

  const samples: ElevationSample[] = [];
  let cursor = 0;
  for (let k = 0; k < wanted; k++) {
    const target = k === wanted - 1 ? total : k * stride;
    while (cursor < gpsOrder.length - 1 && gpsOrder[cursor].distanceM < target - stride / 2 && gpsOrder[cursor + 1].distanceM <= target) {
      cursor++;
    }
    let best = gpsOrder[cursor];
    let bestGap = Math.abs(best.distanceM - target);
    for (let j = Math.max(0, cursor - 1); j < Math.min(gpsOrder.length, cursor + 4); j++) {
      const gap = Math.abs(gpsOrder[j].distanceM - target);
      if (gap < bestGap) {
        best = gpsOrder[j];
        bestGap = gap;
      }
    }
    const last = samples[samples.length - 1];
    if (last && last.index === best.index) continue;
    samples.push({ ...best });
    cursor = Math.min(gpsOrder.length - 1, cursor);
  }
  return samples;
}

/**
 * Interpola las altitudes muestreadas sobre todos los puntos, en función de la
 * distancia (así una parada larga no inventa pendiente).
 */
export function interpolateElevation(
  points: ActivityPoint[],
  samples: Array<{ index: number; distanceM: number; ele: number }>,
  distances?: number[]
): number[] {
  const dist = distances ?? cumulativeDistances(points);
  const values = new Array<number>(points.length).fill(samples[0]?.ele ?? 0);
  if (samples.length === 0) return values;
  if (samples.length === 1) return values.map(() => samples[0].ele);

  let seg = 0;
  for (let i = 0; i < points.length; i++) {
    const d = dist[i];
    while (seg < samples.length - 2 && samples[seg + 1].distanceM < d) seg++;
    const a = samples[seg];
    const b = samples[seg + 1];
    if (d <= a.distanceM) {
      values[i] = a.ele;
      continue;
    }
    if (!b || d >= b.distanceM) {
      values[i] = b ? b.ele : a.ele;
      continue;
    }
    const span = b.distanceM - a.distanceM;
    const t = span > 0 ? (d - a.distanceM) / span : 0;
    values[i] = a.ele + (b.ele - a.ele) * t;
  }
  return values;
}

/** Media móvil sobre una ventana de distancia: aplana el escalón de la rejilla del DEM. */
export function smoothElevationSeries(values: number[], distances: number[], windowM = ELEVATION_SMOOTH_WINDOW_M): number[] {
  const n = values.length;
  if (n < 3 || windowM <= 0) return [...values];
  const half = Math.max(1, windowM / 2);
  const out = new Array<number>(n);
  let lo = 0;
  let hi = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    while (hi + 1 < n && distances[hi + 1] - distances[i] <= half) hi++;
    while (lo < i && distances[i] - distances[lo] > half) lo++;
    if (hi < lo) hi = lo;
    sum = 0;
    for (let j = lo; j <= hi; j++) sum += values[j];
    out[i] = sum / (hi - lo + 1);
  }
  return out;
}

/** Redondea a 0,1 m y quita los picos aislados (un punto no debería mover 20 m). */
export function clampSpikes(values: number[], maxStepM = 12): number[] {
  const out = [...values];
  for (let i = 1; i < out.length; i++) {
    const step = out[i] - out[i - 1];
    if (Math.abs(step) > maxStepM) out[i] = out[i - 1] + Math.sign(step) * maxStepM;
  }
  return out;
}

export type MapElevationResult = {
  points: ActivityPoint[];
  gain: number;
  loss: number;
  maxEle: number;
  minEle: number;
  samples: number;
  /** Desplazamiento aplicado al DEM para casar con la altitud del reloj. */
  biasM: number;
};

/**
 * Construye el perfil de altitud de la actividad a partir de las altitudes del mapa.
 * `sampleEle`i-ésima altitud corresponde a `samples[i]`.
 */
export function buildMapElevation(input: {
  points: ActivityPoint[];
  samples: ElevationSample[];
  sampleEle: Array<number | null>;
  smoothWindowM?: number;
  hysteresisM?: number;
}): MapElevationResult | null {
  const anchors = input.samples
    .map((s, i) => ({ ...s, ele: input.sampleEle[i] }))
    .filter((s): s is ElevationSample & { ele: number } => isFiniteNumber(s.ele));
  if (anchors.length < 2) return null;

  const distances = cumulativeDistances(input.points);
  const dem = interpolateElevation(input.points, anchors, distances);
  const smooth = clampSpikes(smoothElevationSeries(dem, distances, input.smoothWindowM ?? ELEVATION_SMOOTH_WINDOW_M));

  // Sesgo: si el reloj traía altitud en parte del recorrido, el mapa se desplaza para
  // que los huecos encajen con lo medido y no aparezca un escalón falso.
  const diffs: number[] = [];
  for (let i = 0; i < input.points.length; i++) {
    const known = input.points[i]?.ele;
    if (isFiniteNumber(known)) diffs.push(known - smooth[i]);
  }
  const biasM = median(diffs) ?? 0;

  const points = input.points.map((p, i) => {
    const ele = isFiniteNumber(p.ele) ? p.ele : Math.round((smooth[i] + biasM) * 10) / 10;
    return { ...p, ele };
  });

  const { gain, loss, maxEle, minEle } = computeElevationGainLoss(points, input.hysteresisM ?? DEM_HYSTERESIS_M);
  return { points, gain, loss, maxEle, minEle, samples: anchors.length, biasM: Math.round(biasM * 10) / 10 };
}

/** Clave de caché: ~11 m de resolución, que es la del propio DEM. */
export function elevationCacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

export function elevationCacheKeysFor(samples: ElevationSample[]): string[] {
  return samples.map((s) => elevationCacheKey(s.lat, s.lon));
}

export class ElevationProviderError extends Error {
  readonly retriable: boolean;

  constructor(message: string, retriable = false) {
    super(message);
    this.name = 'ElevationProviderError';
    this.retriable = retriable;
  }
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

export type ElevationFetchOptions = {
  fetchImpl?: typeof fetch;
  url?: string;
  chunkSize?: number;
  timeoutMs?: number;
  retries?: number;
  chunkDelayMs?: number;
  /** Para avisar del progreso desde la capa de abajo (backfill masivo). */
  onProgress?: (info: { done: number; total: number }) => void;
};

/**
 * Pide las altitudes al proveedor DEM por lotes. Devuelve un array paralelo a
 * `coords`, con `null` donde no haya dato (mar abierto, proveedor caído, ...).
 */
export async function fetchElevations(
  coords: Array<[number, number]>,
  options: ElevationFetchOptions = {}
): Promise<Array<number | null>> {
  const out: Array<number | null> = new Array(coords.length).fill(null);
  if (coords.length === 0) return out;

  const doFetch = options.fetchImpl ?? fetch;
  if (!options.fetchImpl && typeof fetch !== 'function') {
    throw new ElevationProviderError('Este entorno no puede consultar el modelo de elevaciones');
  }
  const url = options.url ?? OPEN_METEO_ELEVATION_URL;
  const chunkSize = Math.max(1, Math.min(ELEVATION_CHUNK_SIZE, options.chunkSize ?? ELEVATION_CHUNK_SIZE));
  const timeoutMs = options.timeoutMs ?? ELEVATION_TIMEOUT_MS;
  const retries = Math.max(0, options.retries ?? 1);

  for (let start = 0; start < coords.length; start += chunkSize) {
    const chunk = coords.slice(start, start + chunkSize);
    const latQuery = chunk.map(([lat]) => lat.toFixed(4)).join(',');
    const lonQuery = chunk.map(([, lon]) => lon.toFixed(4)).join(',');
    const endpoint = `${url}?latitude=${latQuery}&longitude=${lonQuery}`;

    let lastError: unknown = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await doFetch(endpoint, {
          method: 'GET',
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
          cache: 'no-store',
        });
        if (!res.ok) {
          throw new ElevationProviderError(`El servicio de elevaciones respondió ${res.status}`, res.status === 429 || res.status >= 500);
        }
        const data = (await res.json()) as { elevation?: unknown };
        const list = Array.isArray(data?.elevation) ? data.elevation : null;
        if (!list) {
          throw new ElevationProviderError('Respuesta del servicio de elevaciones sin el listado "elevation"');
        }
        for (let i = 0; i < chunk.length; i++) {
          const value = Number(list[i]);
          out[start + i] = Number.isFinite(value) && value > -600 && value < 9000 ? Math.round(value * 10) / 10 : null;
        }
        break;
      } catch (err) {
        lastError = err;
        const retriable = err instanceof ElevationProviderError ? err.retriable : true;
        if (!retriable || attempt === retries) break;
        await sleep(400 * (attempt + 1));
      }
    }
    if (chunk.every((_, i) => out[start + i] === null) && lastError) {
      throw lastError instanceof Error ? lastError : new ElevationProviderError('No se pudo consultar el servicio de elevaciones');
    }
    if (start + chunkSize < coords.length) await sleep(options.chunkDelayMs ?? ELEVATION_CHUNK_DELAY_MS);
    options.onProgress?.({ done: Math.min(coords.length, start + chunk.length), total: coords.length });
  }

  return out;
}
