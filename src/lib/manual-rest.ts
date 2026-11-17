import type { ActivityLap } from '@/types';

/** La identidad incluye datos estables del segmento para no aplicar una selección a otro al reimportar. */
export function restLapKey(lap: ActivityLap, index: number): string {
  return JSON.stringify([index, lap.lapNumber, lap.startDistM, lap.endDistM, lap.distanceMeters, lap.durationSec]);
}

export function resolveManualRests(laps: ActivityLap[] | undefined, storedKeys: unknown): { keys: string[]; durationSec: number; distanceMeters: number } {
  const wanted = new Set(Array.isArray(storedKeys) ? storedKeys.filter((k): k is string => typeof k === 'string') : []);
  const keys: string[] = [];
  let durationSec = 0;
  let distanceMeters = 0;
  (laps ?? []).forEach((lap, index) => {
    const key = restLapKey(lap, index);
    if (wanted.has(key) && Number.isFinite(lap.durationSec) && lap.durationSec > 0 && Number.isFinite(lap.distanceMeters) && lap.distanceMeters >= 0) {
      keys.push(key);
      durationSec += lap.durationSec;
      distanceMeters += lap.distanceMeters;
    }
  });
  return { keys, durationSec, distanceMeters };
}

/**
 * Reconstruye los tramos conservados sólo cuando las vueltas forman una secuencia
 * completa y sus límites concuerdan con la telemetría. Los archivos antiguos no
 * guardaban marcas temporales por vuelta, por lo que otras situaciones son ambiguas.
 */
export function retainedRestChunks(
  points: import('@/types').ActivityPoint[], laps: ActivityLap[], keys: string[], durationSec: number
): import('@/types').ActivityPoint[][] | null {
  if (!keys.length) return [points];
  if (points.length < 2 || !laps.length || !Number.isFinite(durationSec)) return null;
  let time = 0;
  let distance = 0;
  const intervals: Array<{ start: number; end: number; distance: number }> = [];
  for (let i = 0; i < laps.length; i++) {
    const lap = laps[i];
    if (!Number.isFinite(lap.durationSec) || lap.durationSec <= 0 ||
        !Number.isFinite(lap.startDistM) || !Number.isFinite(lap.endDistM) || !Number.isFinite(lap.distanceMeters) || lap.distanceMeters < 0 ||
        Math.abs(lap.startDistM - distance) > 5 || lap.endDistM < lap.startDistM ||
        Math.abs(lap.endDistM - lap.startDistM - lap.distanceMeters) > 5) return null;
    if (keys.includes(restLapKey(lap, i))) intervals.push({ start: time, end: time + lap.durationSec, distance: lap.distanceMeters });
    time += lap.durationSec;
    distance = lap.endDistM;
  }
  if (intervals.length !== keys.length || Math.abs(time - durationSec) > Math.max(3, durationSec * 0.01)) return null;
  if (points.some((p, i) => !Number.isFinite(p.t) || (i > 0 && p.t < points[i - 1].t))) return null;
  if (points[0].t > 3 || Math.abs(points[points.length - 1].t - durationSec) > Math.max(3, durationSec * 0.01)) return null;
  // Verificar que los límites temporales inferidos también coinciden con la distancia.
  const atTime = (t: number): number | null => {
    let i = points.findIndex(p => p.t >= t);
    if (i < 0) i = points.length - 1;
    const b = points[i], a = points[Math.max(0, i - 1)];
    if (typeof a.dist !== 'number' || !Number.isFinite(a.dist) || typeof b.dist !== 'number' || !Number.isFinite(b.dist)) return null;
    return b.t > a.t ? a.dist + (b.dist - a.dist) * Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : b.dist;
  };
  let elapsed = 0;
  for (const lap of laps) {
    const start = atTime(elapsed), end = atTime(elapsed + lap.durationSec);
    if (start === null || end === null || Math.abs(start - lap.startDistM) > Math.max(20, lap.distanceMeters * 0.05) || Math.abs(end - lap.endDistM) > Math.max(20, lap.distanceMeters * 0.05)) return null;
    elapsed += lap.durationSec;
  }
  const chunks: import('@/types').ActivityPoint[][] = [];
  let chunk: import('@/types').ActivityPoint[] = [];
  for (const point of points) {
    if (intervals.some(r => point.t >= r.start && (point.t < r.end || (r.end >= durationSec && point.t === r.end)))) {
      if (chunk.length) { chunks.push(chunk); chunk = []; }
      continue;
    }
    const before = intervals.filter(r => r.end <= point.t);
    const removedTime = before.reduce((s, r) => s + r.end - r.start, 0);
    const removedDistance = before.reduce((s, r) => s + r.distance, 0);
    chunk.push({ ...point, t: Math.max(0, point.t - removedTime), dist: typeof point.dist === 'number' ? Math.max(0, point.dist - removedDistance) : undefined });
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}
