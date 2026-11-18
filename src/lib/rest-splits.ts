import { calculateMinettiGapFactor } from '@/lib/analytics';
import { computeElevationGainLoss } from '@/lib/polyline';
import type { ActivityLap, ActivityPoint } from '@/types';

/** Parciales de 1 km en distancia acumulada, sin inventar movimiento entre tramos. */
export function computeRetainedKmSplits(chunks: ActivityPoint[][]): ActivityLap[] {
  type Bucket = { distance: number; duration: number; paths: ActivityPoint[][]; hr: number; hrTime: number; maxHr: number; watts: number; wattsTime: number; cad: number; cadTime: number; gap: number; gapTime: number; maxSpeed: number };
  const buckets = new Map<number, Bucket>();
  const bucketFor = (idx: number) => {
    let bucket = buckets.get(idx);
    if (!bucket) { bucket = { distance: 0, duration: 0, paths: [], hr: 0, hrTime: 0, maxHr: 0, watts: 0, wattsTime: 0, cad: 0, cadTime: 0, gap: 0, gapTime: 0, maxSpeed: 0 }; buckets.set(idx, bucket); }
    return bucket;
  };
  const interpolate = (a: ActivityPoint, b: ActivityPoint, ratio: number): ActivityPoint => {
    const p: ActivityPoint = { t: a.t + (b.t - a.t) * ratio };
    for (const key of ['dist', 'lat', 'lon', 'ele', 'hr', 'watts', 'cad', 'speed', 'grade'] as const) {
      const x = a[key], y = b[key];
      if (typeof x === 'number' && typeof y === 'number') p[key] = x + (y - x) * ratio;
      else if (typeof y === 'number') p[key] = y;
      else if (typeof x === 'number') p[key] = x;
    }
    return p;
  };
  for (const chunk of chunks) {
    let lastBucket = -1;
    for (let i = 1; i < chunk.length; i++) {
      const a = chunk[i - 1], b = chunk[i], start = a.dist, end = b.dist;
      if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end) || end < start || b.t <= a.t) { lastBucket = -1; continue; }
      let fraction = 0;
      do {
        const currentDist = start + (end - start) * fraction;
        const idx = Math.max(0, Math.floor((currentDist + 1e-7) / 1000));
        const nextFraction = end > start ? Math.min(1, ((idx + 1) * 1000 - start) / (end - start)) : 1;
        if (nextFraction <= fraction) break;
        const p = interpolate(a, b, fraction), q = interpolate(a, b, nextFraction);
        const dt = q.t - p.t, dd = (q.dist ?? 0) - (p.dist ?? 0);
        const bucket = bucketFor(idx);
        bucket.duration += dt; bucket.distance += dd;
        if (lastBucket !== idx) bucket.paths.push([p]);
        bucket.paths[bucket.paths.length - 1].push(q);
        lastBucket = idx;
        if (typeof q.hr === 'number' && q.hr > 25) { bucket.hr += q.hr * dt; bucket.hrTime += dt; bucket.maxHr = Math.max(bucket.maxHr, q.hr); }
        if (typeof q.watts === 'number' && q.watts >= 0) { bucket.watts += q.watts * dt; bucket.wattsTime += dt; }
        if (typeof q.cad === 'number' && q.cad > 0) { bucket.cad += q.cad * dt; bucket.cadTime += dt; }
        if (typeof q.speed === 'number' && q.speed >= 0 && q.speed < 35) {
          bucket.maxSpeed = Math.max(bucket.maxSpeed, q.speed);
          bucket.gap += q.speed * calculateMinettiGapFactor(q.grade ?? 0) * dt; bucket.gapTime += dt;
        }
        fraction = nextFraction;
      } while (fraction < 1);
    }
  }
  return [...buckets.entries()].sort((a,b) => a[0] - b[0]).filter(([, b]) => b.duration > 0 && b.distance > 0).map(([idx, b]) => {
    const elevation = b.paths.map(p => computeElevationGainLoss(p, 1.5));
    const gain = elevation.reduce((s, e) => s + e.gain, 0), loss = elevation.reduce((s, e) => s + e.loss, 0);
    return { lapNumber: idx + 1, name: `Km ${idx + 1}`, startDistM: idx * 1000, endDistM: idx * 1000 + Math.round(b.distance), distanceMeters: Math.round(b.distance), durationSec: Math.round(b.duration), movingTimeSec: Math.round(b.duration), avgSpeedMs: Math.round(b.distance / b.duration * 100) / 100, maxSpeedMs: b.maxSpeed || null, gapSpeedMs: b.gapTime ? Math.round(b.gap / b.gapTime * 100) / 100 : null, elevationGain: gain, elevationLoss: loss, avgGradePct: b.distance ? Math.round((gain - loss) / b.distance * 1000) / 10 : null, avgHr: b.hrTime ? Math.round(b.hr / b.hrTime) : null, maxHr: b.maxHr ? Math.round(b.maxHr) : null, avgWatts: b.wattsTime ? Math.round(b.watts / b.wattsTime) : null, avgCadence: b.cadTime ? Math.round(b.cad / b.cadTime) : null };
  });
}
