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

/** Localiza los descansos mediante vueltas consecutivas o cruces de distancia inequívocos. */
export function retainedRestChunks(
  points: import('@/types').ActivityPoint[], laps: ActivityLap[], keys: string[], durationSec: number
): import('@/types').ActivityPoint[][] | null {
  if (!keys.length) return [points];
  if (points.length < 2 || !laps.length || !Number.isFinite(durationSec) || durationSec <= 0) return null;
  if (points.some((p, i) => !Number.isFinite(p.t) || (i > 0 && p.t < points[i - 1].t))) return null;
  if (points[0].t > 3 || Math.abs(points[points.length - 1].t - durationSec) > Math.max(3, durationSec * 0.01)) return null;
  const wanted = new Set(keys);
  if (wanted.size !== keys.length) return null;
  const selected = laps.flatMap((lap, i) => wanted.has(restLapKey(lap, i)) ? [lap] : []);
  if (selected.length !== keys.length) return null;
  const valid = (lap: ActivityLap) => Number.isFinite(lap.durationSec) && lap.durationSec > 0 &&
    Number.isFinite(lap.startDistM) && Number.isFinite(lap.endDistM) && Number.isFinite(lap.distanceMeters) &&
    lap.distanceMeters >= 0 && lap.endDistM >= lap.startDistM &&
    Math.abs(lap.endDistM - lap.startDistM - lap.distanceMeters) <= 5;
  if (selected.some(lap => !valid(lap))) return null;
  const atTime = (t: number): number | null => {
    let i = points.findIndex(p => p.t >= t);
    if (i < 0) i = points.length - 1;
    const b = points[i], a = points[Math.max(0, i - 1)];
    if (typeof a.dist !== 'number' || !Number.isFinite(a.dist) || typeof b.dist !== 'number' || !Number.isFinite(b.dist)) return null;
    return b.t > a.t ? a.dist + (b.dist - a.dist) * Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : b.dist;
  };
  type Interval = { start: number; end: number; distance: number };
  let intervals: Interval[] = [];
  let time = 0, distance = 0, sequential = true;
  for (let i = 0; i < laps.length; i++) {
    const lap = laps[i];
    if (!valid(lap) || Math.abs(lap.startDistM - distance) > 5) { sequential = false; break; }
    const start = atTime(time), end = atTime(time + lap.durationSec);
    if (start === null || end === null || Math.abs(start - lap.startDistM) > Math.max(20, lap.distanceMeters * 0.05) || Math.abs(end - lap.endDistM) > Math.max(20, lap.distanceMeters * 0.05)) { sequential = false; break; }
    if (wanted.has(restLapKey(lap, i))) intervals.push({ start: time, end: time + lap.durationSec, distance: lap.distanceMeters });
    time += lap.durationSec;
    distance = lap.endDistM;
  }
  sequential = sequential && Math.abs(time - durationSec) <= Math.max(3, durationSec * 0.01);
  if (!sequential) {
    // Los segmentos parciales pueden localizarse por distancia únicamente si la
    // traza es monótona y el cruce no coincide con una meseta de distancia.
    const crossing = (target: number): number | null => {
      let result: number | null = null;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        if (typeof a.dist !== 'number' || !Number.isFinite(a.dist) || typeof b.dist !== 'number' || !Number.isFinite(b.dist) || b.dist < a.dist || b.t <= a.t) return null;
        if (a.dist === b.dist && Math.abs(target - a.dist) < 0.01) return null;
        if (a.dist <= target && target <= b.dist && b.dist > a.dist) {
          const t = a.t + (b.t - a.t) * (target - a.dist) / (b.dist - a.dist);
          if (result !== null && Math.abs(result - t) > 0.01) return null;
          result = t;
        }
      }
      return result;
    };
    intervals = [];
    for (const lap of selected) {
      // Una pausa de distancia cero no tiene una posición temporal única.
      if (lap.distanceMeters <= 0) return null;
      const start = crossing(lap.startDistM), end = crossing(lap.endDistM);
      if (start === null || end === null || end <= start || Math.abs(end - start - lap.durationSec) > Math.max(3, lap.durationSec * 0.03)) return null;
      intervals.push({ start, end, distance: lap.distanceMeters });
    }
  }
  intervals.sort((a, b) => a.start - b.start);
  if (intervals.some((r, i) => i > 0 && r.start < intervals[i - 1].end - 0.001)) return null;
  const chunks: import('@/types').ActivityPoint[][] = [];
  const ranges: Array<{ start: number; end: number; shiftTime: number; shiftDistance: number }> = [];
  let cursor = 0, shiftTime = 0, shiftDistance = 0;
  for (const interval of intervals) {
    if (interval.start > cursor) ranges.push({ start: cursor, end: interval.start, shiftTime, shiftDistance });
    cursor = interval.end;
    shiftTime += interval.end - interval.start;
    shiftDistance += interval.distance;
  }
  if (cursor < durationSec) ranges.push({ start: cursor, end: durationSec, shiftTime, shiftDistance });
  // Interpolar únicamente geometría y distancia; los valores de sensores del
  // límite se toman del lado conservado, nunca del interior del descanso.
  const boundary = (t: number, side: 'after' | 'before'): import('@/types').ActivityPoint | null => {
    const right = points.findIndex(p => p.t >= t);
    if (right < 0) return null;
    const b = points[right], a = points[Math.max(0, right - 1)];
    if (a.t > t || b.t < t || b.t - a.t > 120) return null;
    const sensorIndex = side === 'after' || (t === durationSec && b.t === t) ? right : right - 1;
    const safeSensorIndex = Math.max(0, Math.min(points.length - 1, sensorIndex));
    const ratio = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
    const p = { ...points[safeSensorIndex], t };
    for (const field of ['dist', 'lat', 'lon'] as const) {
      const x = a[field], y = b[field];
      if (typeof x === 'number' && typeof y === 'number') p[field] = x + (y - x) * ratio;
      else delete p[field];
    }
    return p;
  };
  for (const range of ranges) {
    const kept = points.filter(p => p.t >= range.start && p.t <= range.end);
    const first = boundary(range.start, 'after');
    const last = boundary(range.end, 'before');
    if (!first || !last) return null;
    const interior = kept.filter(p => p.t > range.start && p.t < range.end);
    const chunk = [first, ...interior, last].map(p => ({
      ...p,
      t: Math.max(0, p.t - range.shiftTime),
      dist: typeof p.dist === 'number' ? Math.max(0, p.dist - range.shiftDistance) : undefined,
    }));
    if (chunk.length >= 2) chunks.push(chunk);
  }
  return chunks;
}
