import type { Activity, ActivityPoint, AthleteProfile, FitnessDayPoint, SportType } from '@/types';

export function formatDuration(totalSeconds: number): string {
  const secs = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) {
    return `${h}h ${String(m).padStart(2, '0')}m`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatDurationClock(totalSeconds: number): string {
  const secs = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatDistanceKm(meters: number, decimals = 2): string {
  return `${(meters / 1000).toFixed(decimals)} km`;
}

export function formatPaceMinKm(speedMs?: number | null): string {
  if (!speedMs || speedMs <= 0.2) return '--:-- /km';
  const secPerKm = 1000 / speedMs;
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  if (sec === 60) {
    return `${min + 1}:00 /km`;
  }
  return `${min}:${String(sec).padStart(2, '0')} /km`;
}

export function formatSpeedKmh(speedMs?: number | null): string {
  if (!speedMs || speedMs <= 0) return '0.0 km/h';
  return `${(speedMs * 3.6).toFixed(1)} km/h`;
}

export function sportLabel(sport: SportType): string {
  switch (sport) {
    case 'running':
      return 'Correr';
    case 'mywhoosh':
      return 'MyWhoosh';
    case 'cycling':
      return 'Ciclismo';
    case 'mountain':
      return 'Montaña';
    case 'walking':
      return 'Caminar';
    case 'strength':
      return 'Fuerza en Casa';
  }
}

export function sportColor(sport: SportType): string {
  switch (sport) {
    case 'running':
      return '#FC4C02';
    case 'mywhoosh':
      return '#06B6D4';
    case 'cycling':
      return '#3B82F6';
    case 'mountain':
      return '#10B981';
    case 'walking':
      return '#F59E0B';
    case 'strength':
      return '#A855F7';
  }
}

/**
 * Calcula la Potencia Normalizada (NP) usando media móvil de 30 segundos.
 */
export function calculateNormalizedPower(points: ActivityPoint[]): number | null {
  const wattsWithTime = points.filter((p) => typeof p.watts === 'number' && (p.watts ?? 0) >= 0);
  if (wattsWithTime.length < 10) return null;

  // Resample or rolling window by elapsed seconds (~30s)
  const rolling4th: number[] = [];
  let startIdx = 0;
  let windowSum = 0;

  for (let i = 0; i < wattsWithTime.length; i++) {
    windowSum += wattsWithTime[i].watts ?? 0;
    while (wattsWithTime[i].t - wattsWithTime[startIdx].t > 30 && startIdx < i) {
      windowSum -= wattsWithTime[startIdx].watts ?? 0;
      startIdx++;
    }
    const count = i - startIdx + 1;
    const avg30 = windowSum / count;
    rolling4th.push(Math.pow(avg30, 4));
  }

  const mean4th = rolling4th.reduce((acc, v) => acc + v, 0) / rolling4th.length;
  return Math.round(Math.pow(mean4th, 0.25));
}

/**
 * TSS basado en Potencia (Coggan): (sec * NP * IF) / (FTP * 3600) * 100
 */
export function calculateCyclingTSS(durationSec: number, npWatts: number, ftpWatts: number): number {
  if (!durationSec || !npWatts || !ftpWatts || ftpWatts <= 0) return 0;
  const intensityFactor = npWatts / ftpWatts;
  const tss = ((durationSec * npWatts * intensityFactor) / (ftpWatts * 3600)) * 100;
  return Math.round(tss);
}

/**
 * TRIMP exponencial de Banister y conversión aproximada a hrTSS.
 */
export function calculateHrTSS(
  durationSec: number,
  avgHr: number,
  restingHr = 52,
  maxHr = 188,
  lthr = 168
): number {
  if (!durationSec || !avgHr || maxHr <= restingHr) return 0;
  const durationMin = durationSec / 60;
  const hrr = Math.min(1, Math.max(0, (avgHr - restingHr) / (maxHr - restingHr)));
  const trimp = durationMin * hrr * 0.64 * Math.exp(1.92 * hrr);
  const lthrHrr = Math.min(1, Math.max(0.2, (lthr - restingHr) / (maxHr - restingHr)));
  const trimpAtThreshold1h = 60 * lthrHrr * 0.64 * Math.exp(1.92 * lthrHrr);
  if (trimpAtThreshold1h <= 0) return Math.round(durationMin);
  return Math.round((trimp / trimpAtThreshold1h) * 100);
}

/**
 * Calcula TSS unificado para cualquier deporte (MyWhoosh/Bici, Running, Montaña, Fuerza).
 */
export function estimateActivityTSS(
  params: {
    sport: SportType;
    durationSec: number;
    movingTimeSec?: number;
    avgWatts?: number | null;
    normalizedPower?: number | null;
    avgHr?: number | null;
    rpe?: number | null;
    elevationGain?: number;
  },
  profile: AthleteProfile
): number {
  const activeSec = params.movingTimeSec && params.movingTimeSec > 0 ? params.movingTimeSec : params.durationSec;
  if (activeSec <= 0) return 0;

  // 1. Potencia (MyWhoosh o ciclismo con potenciómetro)
  const power = params.normalizedPower ?? params.avgWatts;
  if ((params.sport === 'mywhoosh' || params.sport === 'cycling') && power && power > 0) {
    return Math.max(5, calculateCyclingTSS(activeSec, power, profile.ftpWatts || 240));
  }

  // 2. Pulso (Running, Montaña, Ciclismo sin potencia)
  if (params.avgHr && params.avgHr > 0) {
    const baseHrTss = calculateHrTSS(activeSec, params.avgHr, profile.restingHr, profile.maxHr, profile.lthr);
    // Pequeño ajuste mecánico para montaña con mucho desnivel
    const climbBonus = params.sport === 'mountain' && params.elevationGain ? Math.round(params.elevationGain / 120) : 0;
    return Math.max(5, baseHrTss + climbBonus);
  }

  // 3. RPE / duración (especialmente para fuerza en casa o sesiones sin sensor)
  const rpe = params.rpe ?? (params.sport === 'strength' ? 6 : 6.5);
  const hours = activeSec / 3600;
  const rpeFactor = Math.pow(rpe / 10, 1.3) * 85;
  return Math.max(8, Math.round(hours * rpeFactor));
}

/**
 * Calcula la tabla diaria del Performance Management Chart (CTL 42d, ATL 7d, TSB).
 */
export function calculatePMC(activities: Activity[], days = 90): FitnessDayPoint[] {
  const dailyTss = new Map<string, number>();
  for (const act of activities) {
    const day = act.startedAt.slice(0, 10);
    dailyTss.set(day, (dailyTss.get(day) ?? 0) + (act.tss || 0));
  }

  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  // Warm up 120 days before window for realistic CTL/ATL
  const totalDays = days + 60;
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - totalDays + 1);

  const result: FitnessDayPoint[] = [];
  let ctl = 22; // baseline fitness
  let atl = 20;

  for (let i = 0; i < totalDays; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const tss = dailyTss.get(iso) ?? 0;

    const tsb = Math.round((ctl - atl) * 10) / 10;
    ctl = ctl + (tss - ctl) / 42;
    atl = atl + (tss - atl) / 7;

    if (i >= totalDays - days) {
      result.push({
        date: iso,
        tss: Math.round(tss),
        ctl: Math.round(ctl * 10) / 10,
        atl: Math.round(atl * 10) / 10,
        tsb,
      });
    }
  }

  return result;
}

export interface PowerZoneSummary {
  zone: string;
  name: string;
  range: string;
  minPct: number;
  maxPct: number;
  color: string;
  seconds: number;
}

export function getCogganPowerZones(ftpWatts: number, points?: ActivityPoint[]): PowerZoneSummary[] {
  const zones: PowerZoneSummary[] = [
    { zone: 'Z1', name: 'Recuperación', range: `< ${Math.round(ftpWatts * 0.55)} W`, minPct: 0, maxPct: 0.55, color: '#94A3B8', seconds: 0 },
    { zone: 'Z2', name: 'Resistencia', range: `${Math.round(ftpWatts * 0.56)}-${Math.round(ftpWatts * 0.75)} W`, minPct: 0.55, maxPct: 0.75, color: '#3B82F6', seconds: 0 },
    { zone: 'Z3', name: 'Tempo', range: `${Math.round(ftpWatts * 0.76)}-${Math.round(ftpWatts * 0.90)} W`, minPct: 0.75, maxPct: 0.9, color: '#10B981', seconds: 0 },
    { zone: 'Z4', name: 'Umbral FTP', range: `${Math.round(ftpWatts * 0.91)}-${Math.round(ftpWatts * 1.05)} W`, minPct: 0.9, maxPct: 1.05, color: '#F59E0B', seconds: 0 },
    { zone: 'Z5', name: 'VO2 Max', range: `${Math.round(ftpWatts * 1.06)}-${Math.round(ftpWatts * 1.20)} W`, minPct: 1.05, maxPct: 1.2, color: '#FC4C02', seconds: 0 },
    { zone: 'Z6', name: 'Anaeróbico', range: `${Math.round(ftpWatts * 1.21)}-${Math.round(ftpWatts * 1.50)} W`, minPct: 1.2, maxPct: 1.5, color: '#EF4444', seconds: 0 },
    { zone: 'Z7', name: 'Neuromuscular', range: `> ${Math.round(ftpWatts * 1.50)} W`, minPct: 1.5, maxPct: 99, color: '#A855F7', seconds: 0 },
  ];

  if (points && points.length > 1 && ftpWatts > 0) {
    for (let i = 1; i < points.length; i++) {
      const w = points[i].watts;
      if (typeof w !== 'number') continue;
      const dt = Math.max(1, Math.min(30, points[i].t - points[i - 1].t));
      const pct = w / ftpWatts;
      const z = zones.find((item) => pct >= item.minPct && pct < item.maxPct) ?? zones[zones.length - 1];
      z.seconds += dt;
    }
  }

  return zones;
}

export function computePowerCurve(points: ActivityPoint[]): Array<{ durationSec: number; label: string; watts: number }> {
  const durations = [
    { durationSec: 5, label: '5s' },
    { durationSec: 30, label: '30s' },
    { durationSec: 60, label: '1m' },
    { durationSec: 300, label: '5m' },
    { durationSec: 1200, label: '20m' },
    { durationSec: 3600, label: '60m' },
  ];

  const valid = points.filter((p) => typeof p.watts === 'number');
  if (valid.length < 5) return [];

  const totalDur = valid[valid.length - 1].t - valid[0].t;
  const out: Array<{ durationSec: number; label: string; watts: number }> = [];

  for (const d of durations) {
    if (totalDur < d.durationSec * 0.85) continue;
    let bestAvg = 0;
    let start = 0;
    let sum = 0;
    for (let end = 0; end < valid.length; end++) {
      sum += valid[end].watts ?? 0;
      while (valid[end].t - valid[start].t > d.durationSec && start < end) {
        sum -= valid[start].watts ?? 0;
        start++;
      }
      if (valid[end].t - valid[start].t >= d.durationSec * 0.8) {
        const avg = sum / (end - start + 1);
        if (avg > bestAvg) bestAvg = avg;
      }
    }
    if (bestAvg > 0) {
      out.push({ durationSec: d.durationSec, label: d.label, watts: Math.round(bestAvg) });
    }
  }

  return out;
}
