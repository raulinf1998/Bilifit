import { computeElevationGainLoss } from '@/lib/polyline';
import { restLapKey } from '@/lib/manual-rest';
import { estimateActivityTSS } from '@/lib/metrics';
import type { Activity, ActivityPoint, AthleteProfile, ManualRestSummary } from '@/types';

/** Resumen sólo con datos retenidos; valores sin datos suficientes se dejan sin estimar. */
export function summarizeRetainedChunks(chunks: ActivityPoint[][], activity: Activity, profile: AthleteProfile): ManualRestSummary {
  const points = chunks.flat();
  const values = (field: 'hr' | 'watts' | 'cad' | 'speed' | 'temp') => points.map(p => p[field]).filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && (field === 'temp' || n > 0));
  const mean = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
  const hrs = values('hr'), watts = values('watts'), cadence = values('cad'), temps = values('temp');
  const elevations = points.map(p => p.ele).filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  const eleChunks = chunks.filter(c => c.filter(p => typeof p.ele === 'number' && Number.isFinite(p.ele)).length >= 2);
  const ele = eleChunks.map(c => computeElevationGainLoss(c));
  const elevationGain = eleChunks.length ? ele.reduce((s, v) => s + v.gain, 0) : null;
  const elevationLoss = eleChunks.length ? ele.reduce((s, v) => s + v.loss, 0) : null;
  const avgHr = mean(hrs), avgWatts = mean(watts);
  let steps = 0, cadenceSeconds = 0;
  for (const chunk of chunks) for (let i = 1; i < chunk.length; i++) {
    const dt = chunk[i].t - chunk[i - 1].t, cad = chunk[i - 1].cad;
    if (dt > 0 && dt <= 120 && typeof cad === 'number' && cad >= 40 && cad <= 300) { steps += cad * dt / 60; cadenceSeconds += dt; }
  }
  const effectiveDuration = Math.max(0, activity.durationSec - (activity.manualRestDurationSec ?? 0));
  // El reloj no permite repartir calorías ni pasos totales sin datos por segmento.
  const selected = (activity.laps ?? []).filter((l, i) => activity.excludedLapKeys?.includes(restLapKey(l, i)));
  const calories = typeof activity.calories === 'number' && selected.length > 0 && selected.every(l => typeof l.calories === 'number' && l.calories >= 0)
    ? Math.max(0, Math.round(activity.calories - selected.reduce((sum, l) => sum + (l.calories ?? 0), 0))) : null;
  return {
    elevationGain, elevationLoss,
    minEle: elevations.length ? Math.round(elevations.reduce((min, e) => Math.min(min, e), Infinity)) : null,
    maxEle: elevations.length ? Math.round(elevations.reduce((max, e) => Math.max(max, e), -Infinity)) : null,
    avgHr, maxHr: hrs.length ? hrs.reduce((max, hr) => Math.max(max, hr), 0) : null,
    avgWatts, avgCadence: mean(cadence), avgTemp: temps.length ? Math.round(temps.reduce((a,b) => a+b, 0) / temps.length * 10) / 10 : null,
    steps: cadenceSeconds >= 30 && cadenceSeconds >= effectiveDuration * 0.4 ? Math.round(steps) : null,
    calories,
    tss: effectiveDuration > 0 ? estimateActivityTSS({ sport: activity.sport, durationSec: effectiveDuration, avgHr, rpe: activity.rpe }, profile) : 0,
  };
}
