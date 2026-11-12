import { computeElevationGainLoss, haversineMeters } from '@/lib/polyline';
import { calculateNormalizedPower } from '@/lib/metrics';
import type {
  Activity,
  ActivityExtras,
  ActivityLap,
  ActivityPoint,
  AthleteProfile,
  BestEffortItem,
  SportType,
  TerrainSplit,
  ZoneBucket,
} from '@/types';

/**
 * Ecuación metabólica de Minetti (2002) para el factor de coste energético en pendiente
 * al correr (GAP - Grade Adjusted Pace).
 */
export function calculateMinettiGapFactor(gradePercent: number): number {
  const g = Math.max(-0.35, Math.min(0.4, gradePercent / 100));
  const cost =
    155.4 * Math.pow(g, 5) -
    30.4 * Math.pow(g, 4) -
    43.3 * Math.pow(g, 3) +
    46.3 * Math.pow(g, 2) +
    19.5 * g +
    3.6;
  return Math.max(0.55, Math.min(3.5, cost / 3.6));
}

/**
 * Rellena distancias, velocidades suavizadas, pendientes (%) y normaliza cadencia/huecos
 * de sensores para que cualquier GPX/TCX/FIT tenga telemetría completa.
 */
export function enrichPointsTelemetry(points: ActivityPoint[], sport: SportType): ActivityPoint[] {
  if (points.length === 0) return [];

  const cloned: ActivityPoint[] = points.map((p) => ({ ...p }));

  // 1. Distancia acumulada y velocidad bruta si faltan
  let cumDist = cloned[0].dist ?? 0;
  let lastHr: number | undefined;
  let lastTemp: number | undefined;

  for (let i = 0; i < cloned.length; i++) {
    const p = cloned[i];
    if (i > 0) {
      const prev = cloned[i - 1];
      if (typeof p.dist === 'number' && p.dist >= cumDist) {
        cumDist = p.dist;
      } else if (
        typeof p.lat === 'number' &&
        typeof p.lon === 'number' &&
        typeof prev.lat === 'number' &&
        typeof prev.lon === 'number'
      ) {
        const step = haversineMeters(prev.lat, prev.lon, p.lat, p.lon);
        if (step < 1500) cumDist += step;
        p.dist = Math.round(cumDist);
      } else if (typeof p.speed === 'number' && p.t > prev.t) {
        cumDist += p.speed * (p.t - prev.t);
        p.dist = Math.round(cumDist);
      } else {
        p.dist = Math.round(cumDist);
      }

      if (p.speed === undefined || p.speed === null) {
        const dt = p.t - prev.t;
        const dd = (p.dist ?? 0) - (prev.dist ?? 0);
        if (dt > 0 && dd >= 0) {
          const rawSpeed = dd / dt;
          if (rawSpeed < 35) p.speed = Math.round(rawSpeed * 100) / 100;
        }
      }
    } else if (p.dist === undefined) {
      p.dist = 0;
    }

    // Normalizar cadencia de carrera/caminata cuando viene por ciclo simple (ej. 85 -> 170 spm)
    if (
      ((sport === 'running' || sport === 'mountain') && typeof p.cad === 'number' && p.cad > 20 && p.cad < 115) ||
      (sport === 'walking' && typeof p.cad === 'number' && p.cad > 20 && p.cad < 80)
    ) {
      p.cad = Math.round(p.cad * 2);
    }

    // Gap-fill ligero para pulso y temperatura
    if (typeof p.hr === 'number') lastHr = p.hr;
    else if (lastHr !== undefined) p.hr = lastHr;

    if (typeof p.temp === 'number') lastTemp = p.temp;
    else if (lastTemp !== undefined) p.temp = lastTemp;
  }

  // 2. Suavizado ligero de velocidad (ventana de 5 muestras) para evitar picos de GPS al calcular ritmo
  const rawSpeeds = cloned.map((p) => p.speed);
  for (let i = 0; i < cloned.length; i++) {
    let sum = 0;
    let cnt = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(cloned.length - 1, i + 2); j++) {
      const s = rawSpeeds[j];
      if (typeof s === 'number' && Number.isFinite(s) && s >= 0 && s < 35) {
        sum += s;
        cnt++;
      }
    }
    if (cnt > 0) {
      cloned[i].speed = Math.round((sum / cnt) * 100) / 100;
    }
  }

  // 3. Cálculo suave de pendiente (%) usando ventana de al menos 25 m
  for (let i = 0; i < cloned.length; i++) {
    if (typeof cloned[i].grade === 'number') continue;
    if (typeof cloned[i].ele !== 'number' || typeof cloned[i].dist !== 'number') continue;

    let left = i;
    while (left > 0 && (cloned[i].dist! - (cloned[left].dist ?? 0)) < 25) left--;
    let right = i;
    while (right < cloned.length - 1 && ((cloned[right].dist ?? 0) - cloned[i].dist!) < 25) right++;

    const dd = (cloned[right].dist ?? 0) - (cloned[left].dist ?? 0);
    const de = (cloned[right].ele ?? cloned[i].ele!) - (cloned[left].ele ?? cloned[i].ele!);
    if (dd >= 10 && typeof cloned[right].ele === 'number' && typeof cloned[left].ele === 'number') {
      const pct = (de / dd) * 100;
      cloned[i].grade = Math.round(Math.max(-45, Math.min(45, pct)) * 10) / 10;
    }
  }

  return cloned;
}

/**
 * Calcula parciales automáticos cada 1.000 metros (incluyendo GAP, desnivel, FC, potencia y cadencia).
 */
export function computeKmSplits(points: ActivityPoint[], sport: SportType): ActivityLap[] {
  if (points.length < 2) return [];
  const totalDist = points[points.length - 1]?.dist ?? 0;
  if (totalDist < 150) return [];

  const splits: ActivityLap[] = [];
  let splitIdx = 1;
  let splitStartIdx = 0;

  const buildLap = (startIdx: number, endIdx: number, lapNum: number): ActivityLap | null => {
    const startPt = points[startIdx];
    const endPt = points[endIdx];
    const startDist = startPt.dist ?? 0;
    const endDist = endPt.dist ?? 0;
    const dist = Math.max(0, Math.round(endDist - startDist));
    const dur = Math.max(1, Math.round(endPt.t - startPt.t));
    if (dist < 80) return null;

    const slice = points.slice(startIdx, endIdx + 1);
    const eleStats = computeElevationGainLoss(slice, 1.5);
    let hrSum = 0;
    let hrCnt = 0;
    let maxHr = 0;
    let wSum = 0;
    let wCnt = 0;
    let cadSum = 0;
    let cadCnt = 0;
    let maxSpeed = 0;
    let movingSec = 0;
    let gapWeightedSum = 0;
    let gapDurSum = 0;

    for (let k = 0; k < slice.length; k++) {
      const pt = slice[k];
      const dt = k > 0 ? Math.max(0, pt.t - slice[k - 1].t) : 0;
      if (typeof pt.speed === 'number') {
        if (pt.speed > maxSpeed && pt.speed < 35) maxSpeed = pt.speed;
        if (pt.speed > 0.35 || (pt.watts ?? 0) > 15) movingSec += dt;
        if (pt.speed > 0.4 && (sport === 'running' || sport === 'mountain' || sport === 'walking')) {
          const factor = calculateMinettiGapFactor(pt.grade ?? 0);
          const gapSpd = pt.speed * factor;
          gapWeightedSum += gapSpd * Math.max(1, dt);
          gapDurSum += Math.max(1, dt);
        }
      }
      if (typeof pt.hr === 'number' && pt.hr > 25) {
        hrSum += pt.hr;
        hrCnt++;
        if (pt.hr > maxHr) maxHr = pt.hr;
      }
      if (typeof pt.watts === 'number' && pt.watts >= 0) {
        wSum += pt.watts;
        wCnt++;
      }
      if (typeof pt.cad === 'number' && pt.cad > 0) {
        cadSum += pt.cad;
        cadCnt++;
      }
    }

    const effMove = movingSec > 0 ? Math.round(movingSec) : dur;
    const avgSpeedMs = Math.round((dist / effMove) * 100) / 100;
    const avgGradePct =
      typeof startPt.ele === 'number' && typeof endPt.ele === 'number' && dist > 0
        ? Math.round(((endPt.ele - startPt.ele) / dist) * 1000) / 10
        : null;

    return {
      lapNumber: lapNum,
      name: `Km ${lapNum}`,
      startDistM: Math.round(startDist),
      endDistM: Math.round(endDist),
      distanceMeters: dist,
      durationSec: dur,
      movingTimeSec: effMove,
      avgSpeedMs,
      maxSpeedMs: maxSpeed > 0 ? Math.round(maxSpeed * 100) / 100 : null,
      gapSpeedMs: gapDurSum > 0 ? Math.round((gapWeightedSum / gapDurSum) * 100) / 100 : null,
      elevationGain: eleStats.gain,
      elevationLoss: eleStats.loss,
      avgGradePct,
      avgHr: hrCnt > 0 ? Math.round(hrSum / hrCnt) : null,
      maxHr: maxHr > 0 ? Math.round(maxHr) : null,
      avgWatts: wCnt > 0 ? Math.round(wSum / wCnt) : null,
      normalizedPower: wCnt >= 6 ? calculateNormalizedPower(slice) : null,
      avgCadence: cadCnt > 0 ? Math.round(cadSum / cadCnt) : null,
    };
  };

  for (let i = 1; i < points.length; i++) {
    const d = points[i].dist ?? 0;
    if (d >= splitIdx * 1000) {
      const lap = buildLap(splitStartIdx, i, splitIdx);
      if (lap) splits.push(lap);
      splitStartIdx = i;
      splitIdx++;
    }
  }

  if (splitStartIdx < points.length - 1) {
    const lastLap = buildLap(splitStartIdx, points.length - 1, splitIdx);
    if (lastLap) splits.push(lastLap);
  }

  return splits;
}

/**
 * Calcula mejores esfuerzos por distancia (400m, 1km, Milla, 5km, 10km, 20km, 21.1km, 40km).
 */
export function computeBestEfforts(points: ActivityPoint[], sport: SportType): BestEffortItem[] {
  if (points.length < 4) return [];
  const totalDist = points[points.length - 1]?.dist ?? 0;
  if (totalDist < 400) return [];

  const targets =
    sport === 'cycling' || sport === 'mywhoosh'
      ? [
          { label: '1 km', dist: 1000 },
          { label: '5 km', dist: 5000 },
          { label: '10 km', dist: 10000 },
          { label: '20 km', dist: 20000 },
          { label: '40 km', dist: 40000 },
        ]
      : [
          { label: '400 m', dist: 400 },
          { label: '1 km', dist: 1000 },
          { label: '1 Milla', dist: 1609 },
          { label: '5 km', dist: 5000 },
          { label: '10 km', dist: 10000 },
          { label: 'Media Maratón', dist: 21097 },
        ];

  const out: BestEffortItem[] = [];

  for (const target of targets) {
    if (totalDist < target.dist * 0.98) continue;

    let bestTime = Infinity;
    let bestStartIdx = 0;
    let bestEndIdx = 0;
    let start = 0;

    for (let end = 1; end < points.length; end++) {
      while (start < end - 1 && (points[end].dist ?? 0) - (points[start + 1].dist ?? 0) >= target.dist) {
        start++;
      }
      const spanDist = (points[end].dist ?? 0) - (points[start].dist ?? 0);
      if (spanDist >= target.dist) {
        const spanTime = points[end].t - points[start].t;
        if (spanTime > 0) {
          // Interpolar exactamente al objetivo para no penalizar muestreo grueso
          const scaledTime = spanTime * (target.dist / spanDist);
          if (scaledTime < bestTime) {
            bestTime = scaledTime;
            bestStartIdx = start;
            bestEndIdx = end;
          }
        }
      }
    }

    if (Number.isFinite(bestTime) && bestTime > 5) {
      const slice = points.slice(bestStartIdx, bestEndIdx + 1);
      const hrs = slice.map((p) => p.hr).filter((v): v is number => typeof v === 'number');
      const watts = slice.map((p) => p.watts).filter((v): v is number => typeof v === 'number');
      const dur = Math.round(bestTime);

      out.push({
        label: target.label,
        distanceMeters: target.dist,
        durationSec: dur,
        avgSpeedMs: Math.round((target.dist / dur) * 100) / 100,
        avgHr: hrs.length > 0 ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
        avgWatts: watts.length > 0 ? Math.round(watts.reduce((a, b) => a + b, 0) / watts.length) : null,
        startDistM: Math.round(points[bestStartIdx].dist ?? 0),
        endDistM: Math.round((points[bestStartIdx].dist ?? 0) + target.dist),
      });
    }
  }

  return out;
}

/**
 * Zonas de Frecuencia Cardíaca (Z1–Z5) en segundos y %.
 */
export function computeHeartRateZones(points: ActivityPoint[], profile: AthleteProfile): ZoneBucket[] {
  const maxHr = profile.maxHr || 190;
  const defs = [
    { zone: 'Z1', name: 'Recuperación', min: 0, max: 0.6, color: '#94A3B8' },
    { zone: 'Z2', name: 'Aeróbico Base', min: 0.6, max: 0.72, color: '#3B82F6' },
    { zone: 'Z3', name: 'Tempo', min: 0.72, max: 0.82, color: '#10B981' },
    { zone: 'Z4', name: 'Umbral', min: 0.82, max: 0.91, color: '#F59E0B' },
    { zone: 'Z5', name: 'VO2 Max', min: 0.91, max: 1.5, color: '#EF4444' },
  ];

  const buckets = defs.map((d) => ({
    zone: d.zone,
    name: d.name,
    range: `${Math.round(maxHr * d.min)}-${d.max > 1 ? maxHr : Math.round(maxHr * d.max)} ppm`,
    seconds: 0,
    percent: 0,
    color: d.color,
    min: d.min,
    max: d.max,
  }));

  let totalSec = 0;
  for (let i = 1; i < points.length; i++) {
    const hr = points[i].hr;
    if (typeof hr !== 'number' || hr < 30) continue;
    const dt = Math.max(1, Math.min(30, points[i].t - points[i - 1].t));
    const pct = hr / maxHr;
    const b = buckets.find((x) => pct >= x.min && pct < x.max) ?? buckets[buckets.length - 1];
    b.seconds += dt;
    totalSec += dt;
  }

  if (totalSec === 0) return [];
  return buckets.map(({ zone, name, range, seconds, color }) => ({
    zone,
    name,
    range,
    seconds,
    percent: Math.round((seconds / totalSec) * 100),
    color,
  }));
}

/**
 * Zonas de Ritmo para correr y montaña.
 */
export function computePaceZones(points: ActivityPoint[], sport: SportType): ZoneBucket[] {
  if (sport !== 'running' && sport !== 'mountain' && sport !== 'walking') return [];
  // Umbrales en s/km
  const defs =
    sport === 'walking'
      ? [
          { zone: 'Z1', name: 'Paseo suave', range: '> 13:00 /km', minSec: 780, maxSec: 3600, color: '#94A3B8' },
          { zone: 'Z2', name: 'Caminata moderada', range: '11:00 - 13:00 /km', minSec: 660, maxSec: 780, color: '#3B82F6' },
          { zone: 'Z3', name: 'Paso ligero', range: '9:30 - 11:00 /km', minSec: 570, maxSec: 660, color: '#10B981' },
          { zone: 'Z4', name: 'Marcha rápida', range: '8:15 - 9:30 /km', minSec: 495, maxSec: 570, color: '#F59E0B' },
          { zone: 'Z5', name: 'Marcha intensa', range: '< 8:15 /km', minSec: 180, maxSec: 495, color: '#FC4C02' },
        ]
      : [
          { zone: 'Z1', name: 'Suave / Caminando', range: '> 6:15 /km', minSec: 375, maxSec: 3600, color: '#94A3B8' },
          { zone: 'Z2', name: 'Aeróbico / Rodaje', range: '5:20 - 6:15 /km', minSec: 320, maxSec: 375, color: '#3B82F6' },
          { zone: 'Z3', name: 'Tempo', range: '4:40 - 5:20 /km', minSec: 280, maxSec: 320, color: '#10B981' },
          { zone: 'Z4', name: 'Umbral', range: '4:05 - 4:40 /km', minSec: 245, maxSec: 280, color: '#F59E0B' },
          { zone: 'Z5', name: 'Series / VO2', range: '< 4:05 /km', minSec: 90, maxSec: 245, color: '#FC4C02' },
        ];

  const secondsArr = [0, 0, 0, 0, 0];
  let totalSec = 0;

  for (let i = 1; i < points.length; i++) {
    const spd = points[i].speed;
    if (typeof spd !== 'number' || spd < 0.5) continue;
    const paceSecKm = 1000 / spd;
    const dt = Math.max(1, Math.min(30, points[i].t - points[i - 1].t));
    const idx = defs.findIndex((d) => paceSecKm >= d.minSec && paceSecKm < d.maxSec);
    if (idx >= 0) {
      secondsArr[idx] += dt;
      totalSec += dt;
    }
  }

  if (totalSec === 0) return [];
  return defs.map((d, idx) => ({
    zone: d.zone,
    name: d.name,
    range: d.range,
    seconds: secondsArr[idx],
    percent: Math.round((secondsArr[idx] / totalSec) * 100),
    color: d.color,
  }));
}

/**
 * Desglose de distancia, tiempo y ritmo en Subida (>+2%), Llano y Bajada (<-2%).
 */
export function computeTerrainBreakdown(points: ActivityPoint[]): TerrainSplit[] {
  if (points.length < 3 || !points.some((p) => typeof p.grade === 'number')) return [];

  const buckets: Record<'subida' | 'llano' | 'bajada', { dist: number; dur: number }> = {
    subida: { dist: 0, dur: 0 },
    llano: { dist: 0, dur: 0 },
    bajada: { dist: 0, dur: 0 },
  };

  for (let i = 1; i < points.length; i++) {
    const dt = Math.max(0, Math.min(30, points[i].t - points[i - 1].t));
    const dd = Math.max(0, (points[i].dist ?? 0) - (points[i - 1].dist ?? 0));
    const g = points[i].grade ?? 0;
    const kind = g >= 2 ? 'subida' : g <= -2 ? 'bajada' : 'llano';
    buckets[kind].dist += dd;
    buckets[kind].dur += dt;
  }

  const labels: Record<'subida' | 'llano' | 'bajada', string> = {
    subida: 'Subida (≥ +2%)',
    llano: 'Llano (-2% a +2%)',
    bajada: 'Bajada (≤ -2%)',
  };

  return (['subida', 'llano', 'bajada'] as const)
    .filter((k) => buckets[k].dur > 0)
    .map((k) => ({
      type: k,
      label: labels[k],
      distanceMeters: Math.round(buckets[k].dist),
      durationSec: Math.round(buckets[k].dur),
      avgSpeedMs: buckets[k].dur > 0 ? Math.round((buckets[k].dist / buckets[k].dur) * 100) / 100 : null,
    }));
}

/**
 * Calcula métricas fisiológicas avanzadas de sesión (GAP, VAM, EF, Desacople Aeróbico, VI, kJ, Temperatura, Dinámica de Carrera).
 */
export function computeSessionExtras(
  activity: Pick<Activity, 'sport' | 'durationSec' | 'movingTimeSec' | 'distanceMeters' | 'elevationGain' | 'avgSpeedMs' | 'avgHr' | 'avgWatts' | 'normalizedPower' | 'extras'>,
  points: ActivityPoint[]
): ActivityExtras {
  const base: ActivityExtras = { ...(activity.extras ?? {}) };
  if (points.length === 0) return base;

  const eles = points.map((p) => p.ele).filter((v): v is number => typeof v === 'number');
  if (eles.length > 0) {
    base.minEle = base.minEle ?? Math.round(Math.min(...eles));
    base.maxEle = base.maxEle ?? Math.round(Math.max(...eles));
  }

  const temps = points.map((p) => p.temp).filter((v): v is number => typeof v === 'number');
  if (temps.length > 0) {
    base.avgTemp = base.avgTemp ?? Math.round((temps.reduce((a, b) => a + b, 0) / temps.length) * 10) / 10;
    base.minTemp = base.minTemp ?? Math.round(Math.min(...temps) * 10) / 10;
    base.maxTemp = base.maxTemp ?? Math.round(Math.max(...temps) * 10) / 10;
  }

  // Dinámica de carrera
  const gcts = points.map((p) => p.gct).filter((v): v is number => typeof v === 'number' && v > 100 && v < 600);
  if (gcts.length > 0) base.avgGctMs = base.avgGctMs ?? Math.round(gcts.reduce((a, b) => a + b, 0) / gcts.length);

  const vos = points.map((p) => p.vo).filter((v): v is number => typeof v === 'number' && v > 20 && v < 220);
  if (vos.length > 0) base.avgVerticalOscMm = base.avgVerticalOscMm ?? Math.round(vos.reduce((a, b) => a + b, 0) / vos.length);

  const strides = points.map((p) => p.stride).filter((v): v is number => typeof v === 'number' && v > 0.3 && v < 3);
  if (strides.length > 0) {
    base.avgStrideLenM = base.avgStrideLenM ?? Math.round((strides.reduce((a, b) => a + b, 0) / strides.length) * 100) / 100;
  } else if (
    (activity.sport === 'running' || activity.sport === 'mountain' || activity.sport === 'walking') &&
    activity.avgSpeedMs &&
    points.some((p) => p.cad)
  ) {
    const minCad = activity.sport === 'walking' ? 70 : 100;
    const cads = points.map((p) => p.cad).filter((v): v is number => typeof v === 'number' && v > minCad);
    if (cads.length > 0) {
      const avgCad = cads.reduce((a, b) => a + b, 0) / cads.length;
      base.avgStrideLenM = Math.round(((activity.avgSpeedMs * 60) / avgCad) * 100) / 100;
    }
  }

  // Balance I/D ciclismo
  const lr = points.map((p) => p.lrBalance).filter((v): v is number => typeof v === 'number' && v > 20 && v < 80);
  if (lr.length > 0) {
    const left = Math.round((lr.reduce((a, b) => a + b, 0) / lr.length) * 10) / 10;
    base.leftBalancePct = left;
    base.rightBalancePct = Math.round((100 - left) * 10) / 10;
  }

  // Potencia: trabajo kJ y Variability Index
  const activeSec = activity.movingTimeSec || activity.durationSec || 0;
  if (activity.avgWatts && activeSec > 0) {
    base.workKj = base.workKj ?? Math.round((activity.avgWatts * activeSec) / 1000);
    if (activity.normalizedPower && activity.avgWatts > 0) {
      base.variabilityIndex = Math.round((activity.normalizedPower / activity.avgWatts) * 100) / 100;
    }
  }

  // Factor de Eficiencia (EF) y Desacople Aeróbico (Pw:Hr / Pa:Hr)
  if (activity.avgHr && activity.avgHr > 0) {
    if (activity.normalizedPower) {
      base.efficiencyFactor = Math.round((activity.normalizedPower / activity.avgHr) * 100) / 100;
    } else if (activity.avgSpeedMs) {
      base.efficiencyFactor = Math.round(((activity.avgSpeedMs * 60) / activity.avgHr) * 100) / 100;
    }
  }

  if (points.length >= 20 && activeSec >= 1200) {
    const mid = Math.floor(points.length / 2);
    const first = points.slice(0, mid);
    const second = points.slice(mid);
    const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

    const hr1 = avg(first.map((p) => p.hr).filter((v): v is number => typeof v === 'number'));
    const hr2 = avg(second.map((p) => p.hr).filter((v): v is number => typeof v === 'number'));

    const out1 = activity.avgWatts
      ? avg(first.map((p) => p.watts).filter((v): v is number => typeof v === 'number'))
      : avg(first.map((p) => p.speed).filter((v): v is number => typeof v === 'number'));
    const out2 = activity.avgWatts
      ? avg(second.map((p) => p.watts).filter((v): v is number => typeof v === 'number'))
      : avg(second.map((p) => p.speed).filter((v): v is number => typeof v === 'number'));

    if (hr1 > 60 && hr2 > 60 && out1 > 0 && out2 > 0) {
      const ef1 = out1 / hr1;
      const ef2 = out2 / hr2;
      base.aerobicDecouplingPct = Math.round(((ef1 - ef2) / ef1) * 1000) / 10;
    }
  }

  // GAP medio y VAM en subidas
  if (activity.sport === 'running' || activity.sport === 'mountain' || activity.sport === 'walking') {
    let gapSum = 0;
    let gapDur = 0;
    for (let i = 1; i < points.length; i++) {
      const spd = points[i].speed;
      const dt = Math.max(0, Math.min(30, points[i].t - points[i - 1].t));
      if (typeof spd === 'number' && spd > 0.4 && dt > 0) {
        gapSum += spd * calculateMinettiGapFactor(points[i].grade ?? 0) * dt;
        gapDur += dt;
      }
    }
    if (gapDur > 0) {
      base.gapSpeedMs = Math.round((gapSum / gapDur) * 100) / 100;
    }
  }

  // VAM (m/h) considerando el tiempo acumulado en tramos de subida (pendiente >= 2%)
  let climbGain = 0;
  let climbSec = 0;
  for (let i = 1; i < points.length; i++) {
    const de = (points[i].ele ?? 0) - (points[i - 1].ele ?? 0);
    const dt = Math.max(0, Math.min(30, points[i].t - points[i - 1].t));
    if (de > 0 && (points[i].grade ?? 0) >= 2 && dt > 0) {
      climbGain += de;
      climbSec += dt;
    }
  }
  if (climbSec >= 120 && climbGain >= 30) {
    base.vamMh = Math.round((climbGain / climbSec) * 3600);
  }

  return base;
}
