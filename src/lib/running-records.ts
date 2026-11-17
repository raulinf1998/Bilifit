import type { ActivityDetail, ActivityPoint } from '@/types';

export type RunningRecord = { activityId: string; title: string; startedAt: string; value: number };
export type RunningRecords = {
  fastest: Record<'1 km' | '5 km' | '10 km', RunningRecord | null>;
  longestDistance: RunningRecord | null;
  longestContinuous: RunningRecord | null;
  greatestElevationGain: RunningRecord | null;
};

/** Estimación conservadora por intervalos: pausas, huecos y datos insuficientes cortan el tramo. */
export function longestContinuousRun(points: ActivityPoint[], minSpeed = 0.8, maxSpeed = 10): number | null {
  let current = 0;
  let best = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1], point = points[i];
    const dt = point.t - prev.t;
    const dd = typeof prev.dist === 'number' && typeof point.dist === 'number' ? point.dist - prev.dist : null;
    const speed = dd !== null && dt > 0 ? dd / dt : point.speed;
    if (Number.isFinite(dt) && dt > 0 && dt <= 120 && typeof speed === 'number' && Number.isFinite(speed) && speed >= minSpeed && speed <= maxSpeed) {
      current += dt;
      best = Math.max(best, current);
    } else {
      current = 0;
    }
  }
  return best > 0 ? Math.round(best) : null;
}

/** Interpola el cruce exacto de la distancia objetivo, sin escalar todo un tramo desigual. */
export function fastestRunningDistance(points: ActivityPoint[], target: number): number | null {
  let best = Infinity;
  let chunk: Array<{ d: number; t: number }> = [];
  const calculate = () => {
    if (chunk.length < 2 || chunk[chunk.length - 1].d - chunk[0].d < target) return;
    // Para cada extremo, escoger el último inicio posible; y para cada inicio,
    // el primer final posible. Así se manejan también mesetas de distancia (pausas).
    const crossing = (distance: number, latest: boolean): number | null => {
      let low = 0, high = chunk.length;
      while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (chunk[mid].d < distance || (latest && chunk[mid].d === distance)) low = mid + 1;
        else high = mid;
      }
      const i = latest ? low - 1 : low;
      if (i < 0 || i >= chunk.length) return null;
      if (chunk[i].d === distance) return chunk[i].t;
      const left = latest ? i : i - 1, right = left + 1;
      if (left < 0 || right >= chunk.length || chunk[right].d <= chunk[left].d) return null;
      return chunk[left].t + (chunk[right].t - chunk[left].t) * (distance - chunk[left].d) / (chunk[right].d - chunk[left].d);
    };
    for (const point of chunk) {
      const start = crossing(point.d - target, true);
      if (start !== null && point.t > start) best = Math.min(best, point.t - start);
      const end = crossing(point.d + target, false);
      if (end !== null && end > point.t) best = Math.min(best, end - point.t);
    }
  };
  for (const p of points) {
    if (!Number.isFinite(p.t) || typeof p.dist !== 'number' || !Number.isFinite(p.dist)) { calculate(); chunk = []; continue; }
    const previous = chunk[chunk.length - 1];
    if (previous && (p.t <= previous.t || p.t - previous.t > 120 || p.dist < previous.d)) { calculate(); chunk = []; }
    chunk.push({ d: p.dist, t: p.t });
  }
  calculate();
  return Number.isFinite(best) && best > 5 ? Math.round(best) : null;
}

/** El mismo cálculo para correr, bicicleta o montaña, filtrado por deporte. */
export function computeSportRecords(activities: ActivityDetail[], sports: ActivityDetail['sport'][], options: { minSpeed?: number; maxSpeed?: number } = {}): RunningRecords {
  const records: RunningRecords = { fastest: { '1 km': null, '5 km': null, '10 km': null }, longestDistance: null, longestContinuous: null, greatestElevationGain: null };
  for (const activity of activities) {
    if (!sports.includes(activity.sport)) continue;
    const make = (value: number): RunningRecord => ({ activityId: activity.id, title: activity.title, startedAt: activity.startedAt, value });
    if (activity.distanceMeters > 0 && (!records.longestDistance || activity.distanceMeters > records.longestDistance.value)) records.longestDistance = make(activity.distanceMeters);
    if (Number.isFinite(activity.elevationGain) && activity.elevationGain > 0 &&
        (!records.greatestElevationGain || activity.elevationGain > records.greatestElevationGain.value)) {
      records.greatestElevationGain = make(activity.elevationGain);
    }
    const continuous = longestContinuousRun(activity.points, options.minSpeed, options.maxSpeed);
    if (continuous && (!records.longestContinuous || continuous > records.longestContinuous.value)) records.longestContinuous = make(continuous);
    for (const [label, meters] of [['1 km', 1000], ['5 km', 5000], ['10 km', 10000]] as const) {
      const time = fastestRunningDistance(activity.points, meters);
      const current = records.fastest[label];
      if (time && (!current || time < current.value)) records.fastest[label] = make(time);
    }
  }
  return records;
}

/** Sólo carreras de asfalto. */
export function computeRunningRecords(activities: ActivityDetail[]): RunningRecords {
  return computeSportRecords(activities, ['running']);
}
