import { computeSessionExtras, enrichPointsTelemetry } from '@/lib/analytics';
import { calculateNormalizedPower, estimateActivityTSS } from '@/lib/metrics';
import { computeElevationGainLoss, downsamplePoints, encodePolyline, haversineMeters } from '@/lib/polyline';
import type {
  ActivityDetail,
  ActivityExtras,
  ActivityLap,
  ActivityPoint,
  AthleteProfile,
  SportType,
} from '@/types';

export type TrimMode = 'start' | 'end' | 'middle' | 'range';
export type TrimUnit = 'km' | 'sec';

export type TrimSpec =
  | { mode: 'start'; cutSec: number }
  | { mode: 'end'; cutSec: number }
  | { mode: 'middle'; cutStartSec: number; cutEndSec: number }
  | { mode: 'range'; startSec: number; endSec: number };

export interface TrimInputSpec {
  mode: TrimMode;
  unit?: TrimUnit;
  fromKm?: number;
  toKm?: number;
  fromSec?: number;
  toSec?: number;
  cutSec?: number;
  cutStartSec?: number;
  cutEndSec?: number;
  startSec?: number;
  endSec?: number;
}

export interface TrimPreviewResult {
  valid: boolean;
  error?: string;
  keptCount: number;
  removedCount: number;
  newDistanceMeters: number;
  removedDistanceMeters: number;
  newDurationSec: number;
  removedDurationSec: number;
  newMovingTimeSec: number;
  newElevationGain: number;
  newElevationLoss: number;
  newAvgSpeedMs: number | null;
  keepPolyline: string | null;
  removedPolyline: string | null;
  removedPolylines: string[];
  boundaryPoint: ActivityPoint | null;
}

export function distanceToPointTimeSec(points: ActivityPoint[], distMeters: number): number {
  if (!points || points.length === 0) return 0;
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const target = Math.max(0, distMeters);
  for (let i = 0; i < sorted.length; i++) {
    const d = sorted[i].dist;
    if (typeof d === 'number' && d >= target) {
      if (i === 0) return sorted[0].t;
      const prevD = sorted[i - 1].dist ?? 0;
      const span = d - prevD;
      if (span <= 0) return sorted[i].t;
      const ratio = (target - prevD) / span;
      return Math.round(sorted[i - 1].t + ratio * (sorted[i].t - sorted[i - 1].t));
    }
  }
  return sorted[sorted.length - 1].t;
}

export function resolveTrimSpecFromInput(points: ActivityPoint[], input: TrimInputSpec): TrimSpec {
  const useKm = input.unit === 'km';
  const toSecFromBoundary = (kmVal: number | undefined, secVal: number | undefined, fallback = 0): number => {
    if (useKm && typeof kmVal === 'number' && Number.isFinite(kmVal)) {
      return distanceToPointTimeSec(points, kmVal * 1000);
    }
    if (typeof secVal === 'number' && Number.isFinite(secVal)) {
      return Math.round(secVal);
    }
    return fallback;
  };

  if (input.mode === 'start') {
    const cutSec =
      typeof input.cutSec === 'number'
        ? Math.round(input.cutSec)
        : toSecFromBoundary(input.fromKm, input.fromSec, 0);
    return { mode: 'start', cutSec };
  }
  if (input.mode === 'end') {
    const cutSec =
      typeof input.cutSec === 'number'
        ? Math.round(input.cutSec)
        : toSecFromBoundary(input.toKm, input.toSec, points[points.length - 1]?.t ?? 0);
    return { mode: 'end', cutSec };
  }
  if (input.mode === 'middle') {
    const cutStartSec =
      typeof input.cutStartSec === 'number'
        ? Math.round(input.cutStartSec)
        : toSecFromBoundary(input.fromKm, input.fromSec, 0);
    const cutEndSec =
      typeof input.cutEndSec === 'number'
        ? Math.round(input.cutEndSec)
        : toSecFromBoundary(input.toKm, input.toSec, points[points.length - 1]?.t ?? 0);
    return { mode: 'middle', cutStartSec, cutEndSec };
  }
  const startSec =
    typeof input.startSec === 'number'
      ? Math.round(input.startSec)
      : toSecFromBoundary(input.fromKm, input.fromSec, 0);
  const endSec =
    typeof input.endSec === 'number'
      ? Math.round(input.endSec)
      : toSecFromBoundary(input.toKm, input.toSec, points[points.length - 1]?.t ?? 0);
  return { mode: 'range', startSec, endSec };
}

function medianPositiveStep(points: ActivityPoint[]): number {
  const diffs: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const dt = points[i].t - points[i - 1].t;
    if (dt > 0 && dt <= 120) diffs.push(dt);
  }
  if (diffs.length === 0) return 1;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)] || 1;
}

function computeMovingTimeSlice(points: ActivityPoint[]): number {
  if (points.length < 2) return 0;
  let moving = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const dt = cur.t - prev.t;
    if (dt <= 0) continue;

    let stepDist = 0;
    if (typeof prev.dist === 'number' && typeof cur.dist === 'number' && cur.dist >= prev.dist) {
      stepDist = cur.dist - prev.dist;
    } else if (
      typeof prev.lat === 'number' &&
      typeof prev.lon === 'number' &&
      typeof cur.lat === 'number' &&
      typeof cur.lon === 'number'
    ) {
      stepDist = haversineMeters(prev.lat, prev.lon, cur.lat, cur.lon);
    }

    const avgStepSpeed = dt > 0 ? stepDist / dt : 0;
    const pointSpeed = typeof cur.speed === 'number' ? cur.speed : avgStepSpeed;
    const hasIndoorEffort = (cur.watts ?? 0) > 10 || (cur.cad ?? 0) > 5;
    const isPauseGap = dt > 30 && stepDist < dt * 0.3 && !hasIndoorEffort;
    if (isPauseGap) continue;
    if (pointSpeed >= 0.25 || avgStepSpeed >= 0.25 || hasIndoorEffort) {
      moving += dt;
    }
  }
  return Math.round(moving);
}

interface IndexedOrigPoint {
  orig: ActivityPoint;
  origIndex: number;
  keptT: number;
  keptDist: number;
}

interface SlicedTrackComputation {
  valid: boolean;
  error?: string;
  keptPoints: ActivityPoint[];
  indexedKept: IndexedOrigPoint[];
  removedSegments: ActivityPoint[][];
  origMaxT: number;
  tStartShift: number;
  durationSec: number;
  movingTimeSec: number;
  distanceMeters: number;
  elevationGain: number;
  elevationLoss: number;
  boundaryPoint: ActivityPoint | null;
}

function slicePointsForTrim(
  rawPoints: ActivityPoint[],
  sport: SportType,
  fallbackMovingRatio: number,
  spec: TrimSpec
): SlicedTrackComputation {
  if (!rawPoints || rawPoints.length < 3) {
    return {
      valid: false,
      error: 'La actividad necesita al menos 3 puntos de telemetría para poder recortarse.',
      keptPoints: [],
      indexedKept: [],
      removedSegments: [],
      origMaxT: 0,
      tStartShift: 0,
      durationSec: 0,
      movingTimeSec: 0,
      distanceMeters: 0,
      elevationGain: 0,
      elevationLoss: 0,
      boundaryPoint: null,
    };
  }

  const sorted = [...rawPoints].sort((a, b) => a.t - b.t);
  const origPoints = enrichPointsTelemetry(sorted, sport);
  const origMinT = origPoints[0].t;
  const origMaxT = origPoints[origPoints.length - 1].t;
  const medDt = medianPositiveStep(origPoints);

  let segments: Array<{ pts: Array<{ pt: ActivityPoint; idx: number }> }> = [];
  const removedSegments: ActivityPoint[][] = [];
  let boundaryPoint: ActivityPoint | null = null;

  if (spec.mode === 'start') {
    const cutSec = Math.max(origMinT, Math.min(origMaxT, spec.cutSec));
    const removed = origPoints.filter((p) => p.t < cutSec);
    const kept = origPoints.map((pt, idx) => ({ pt, idx })).filter((item) => item.pt.t >= cutSec);
    if (removed.length === 0) {
      return invalidTrim('Selecciona un punto posterior al inicio para recortar por delante.', origMaxT);
    }
    if (kept.length < 2) {
      return invalidTrim('El recorte dejaría menos de 2 puntos en la actividad.', origMaxT);
    }
    segments = [{ pts: kept }];
    removedSegments.push(removed);
    boundaryPoint = kept[0].pt;
  } else if (spec.mode === 'end') {
    const cutSec = Math.max(origMinT, Math.min(origMaxT, spec.cutSec));
    const kept = origPoints.map((pt, idx) => ({ pt, idx })).filter((item) => item.pt.t <= cutSec);
    const removed = origPoints.filter((p) => p.t > cutSec);
    if (removed.length === 0) {
      return invalidTrim('Selecciona un punto anterior al final para recortar por detrás.', origMaxT);
    }
    if (kept.length < 2) {
      return invalidTrim('El recorte dejaría menos de 2 puntos en la actividad.', origMaxT);
    }
    segments = [{ pts: kept }];
    removedSegments.push(removed);
    boundaryPoint = kept[kept.length - 1].pt;
  } else if (spec.mode === 'range') {
    const startSec = Math.max(origMinT, Math.min(origMaxT, spec.startSec));
    const endSec = Math.max(origMinT, Math.min(origMaxT, spec.endSec));
    if (startSec >= endSec) {
      return invalidTrim('El inicio debe ser menor que el final.', origMaxT);
    }
    const removedHead = origPoints.filter((p) => p.t < startSec);
    const removedTail = origPoints.filter((p) => p.t > endSec);
    const kept = origPoints
      .map((pt, idx) => ({ pt, idx }))
      .filter((item) => item.pt.t >= startSec && item.pt.t <= endSec);
    if (removedHead.length === 0 && removedTail.length === 0) {
      return invalidTrim('El rango seleccionado coincide con toda la actividad.', origMaxT);
    }
    if (kept.length < 2) {
      return invalidTrim('El recorte dejaría menos de 2 puntos en la actividad.', origMaxT);
    }
    segments = [{ pts: kept }];
    if (removedHead.length > 0) removedSegments.push(removedHead);
    if (removedTail.length > 0) removedSegments.push(removedTail);
    boundaryPoint = kept[0].pt;
  } else {
    const cutStart = Math.max(origMinT, Math.min(origMaxT, spec.cutStartSec));
    const cutEnd = Math.max(origMinT, Math.min(origMaxT, spec.cutEndSec));
    if (cutStart >= cutEnd) {
      return invalidTrim('El inicio del segmento a eliminar debe ser anterior al final.', origMaxT);
    }
    const before = origPoints.map((pt, idx) => ({ pt, idx })).filter((item) => item.pt.t <= cutStart);
    const middle = origPoints.filter((p) => p.t > cutStart && p.t < cutEnd);
    const after = origPoints.map((pt, idx) => ({ pt, idx })).filter((item) => item.pt.t >= cutEnd);

    if (before.length === 0 && after.length >= 2) {
      segments = [{ pts: after }];
      removedSegments.push(origPoints.filter((p) => p.t < cutEnd));
      boundaryPoint = after[0].pt;
    } else if (after.length === 0 && before.length >= 2) {
      segments = [{ pts: before }];
      removedSegments.push(origPoints.filter((p) => p.t > cutStart));
      boundaryPoint = before[before.length - 1].pt;
    } else {
      if (before.length === 0 || after.length === 0 || before.length + after.length < 2) {
        return invalidTrim('El recorte del segmento medio dejaría la actividad vacía.', origMaxT);
      }
      const gap = after[0].pt.t - before[before.length - 1].pt.t;
      const hasGapToCut = middle.length > 0 || gap > Math.max(10, medDt * 2);
      if (!hasGapToCut) {
        return invalidTrim('El tramo medio seleccionado no contiene puntos ni pausas para recortar.', origMaxT);
      }
      segments = [{ pts: before }, { pts: after }];
      const seamPreview = [
        before[before.length - 1].pt,
        ...middle,
        after[0].pt,
      ];
      removedSegments.push(seamPreview);
      boundaryPoint = before[before.length - 1].pt;
    }
  }

  const keptPoints: ActivityPoint[] = [];
  const indexedKept: IndexedOrigPoint[] = [];
  let elevationGain = 0;
  let elevationLoss = 0;
  let movingTimeSec = 0;

  let curTimeBase = 0;
  let curDistBase = 0;
  const firstOrigT = segments[0].pts[0].pt.t;
  const tStartShift = Math.max(0, Math.round(firstOrigT - origMinT));

  for (let sIdx = 0; sIdx < segments.length; sIdx++) {
    const segPts = segments[sIdx].pts;
    const segFirstT = segPts[0].pt.t;
    const segFirstDist = segPts[0].pt.dist ?? 0;

    if (sIdx > 0) {
      const prevKept = keptPoints[keptPoints.length - 1];
      const stitchStep = Math.max(1, Math.min(medDt, Math.round(segFirstT - segments[sIdx - 1].pts[segments[sIdx - 1].pts.length - 1].pt.t)));
      curTimeBase = prevKept.t + stitchStep;
      curDistBase = prevKept.dist ?? 0;
    }

    const sliceNorm: ActivityPoint[] = [];
    for (const { pt, idx } of segPts) {
      const nextT = Math.round(curTimeBase + (pt.t - segFirstT));
      const nextDist = Math.round(curDistBase + Math.max(0, (pt.dist ?? 0) - segFirstDist));
      const nextPt: ActivityPoint = {
        ...pt,
        t: nextT,
        dist: nextDist,
      };
      sliceNorm.push(nextPt);
      keptPoints.push(nextPt);
      indexedKept.push({
        orig: pt,
        origIndex: idx,
        keptT: nextT,
        keptDist: nextDist,
      });
    }

    const ele = computeElevationGainLoss(sliceNorm, 2.5);
    elevationGain += ele.gain;
    elevationLoss += ele.loss;
    movingTimeSec += computeMovingTimeSlice(sliceNorm);
  }

  const durationSec = Math.max(1, Math.round(keptPoints[keptPoints.length - 1].t - keptPoints[0].t));
  const distanceMeters = Math.max(0, Math.round(keptPoints[keptPoints.length - 1].dist ?? 0));
  if (movingTimeSec <= 0) {
    movingTimeSec = Math.round(durationSec * fallbackMovingRatio);
  }
  movingTimeSec = Math.max(1, Math.min(durationSec, Math.round(movingTimeSec)));

  return {
    valid: true,
    keptPoints,
    indexedKept,
    removedSegments,
    origMaxT,
    tStartShift,
    durationSec,
    movingTimeSec,
    distanceMeters,
    elevationGain,
    elevationLoss,
    boundaryPoint,
  };
}

function invalidTrim(error: string, origMaxT: number): SlicedTrackComputation {
  return {
    valid: false,
    error,
    keptPoints: [],
    indexedKept: [],
    removedSegments: [],
    origMaxT,
    tStartShift: 0,
    durationSec: 0,
    movingTimeSec: 0,
    distanceMeters: 0,
    elevationGain: 0,
    elevationLoss: 0,
    boundaryPoint: null,
  };
}

export function previewActivityTrim(
  points: ActivityPoint[],
  sport: SportType,
  spec: TrimSpec,
  fallbackMovingRatio = 1
): TrimPreviewResult {
  const res = slicePointsForTrim(points, sport, fallbackMovingRatio, spec);
  if (!res.valid) {
    return {
      valid: false,
      error: res.error,
      keptCount: 0,
      removedCount: 0,
      newDistanceMeters: 0,
      removedDistanceMeters: 0,
      newDurationSec: 0,
      removedDurationSec: 0,
      newMovingTimeSec: 0,
      newElevationGain: 0,
      newElevationLoss: 0,
      newAvgSpeedMs: null,
      keepPolyline: null,
      removedPolyline: null,
      removedPolylines: [],
      boundaryPoint: null,
    };
  }

  const origDist = Math.max(0, Math.round(points[points.length - 1]?.dist ?? 0));
  const origDur = Math.max(0, Math.round((points[points.length - 1]?.t ?? 0) - (points[0]?.t ?? 0)));

  const keptGps = res.keptPoints
    .filter((p): p is ActivityPoint & { lat: number; lon: number } => typeof p.lat === 'number' && typeof p.lon === 'number')
    .map((p): [number, number] => [p.lat, p.lon]);

  const removedPolylines = res.removedSegments
    .map((seg) =>
      seg
        .filter((p): p is ActivityPoint & { lat: number; lon: number } => typeof p.lat === 'number' && typeof p.lon === 'number')
        .map((p): [number, number] => [p.lat, p.lon])
    )
    .filter((coords) => coords.length >= 2)
    .map((coords) => encodePolyline(coords));

  const removedGps = res.removedSegments
    .flat()
    .filter((p): p is ActivityPoint & { lat: number; lon: number } => typeof p.lat === 'number' && typeof p.lon === 'number')
    .map((p): [number, number] => [p.lat, p.lon]);

  const avgSpeedMs =
    res.distanceMeters > 0 && res.movingTimeSec > 0
      ? Math.round((res.distanceMeters / res.movingTimeSec) * 100) / 100
      : null;

  return {
    valid: true,
    keptCount: res.keptPoints.length,
    removedCount: Math.max(0, points.length - res.keptPoints.length),
    newDistanceMeters: res.distanceMeters,
    removedDistanceMeters: Math.max(0, origDist - res.distanceMeters),
    newDurationSec: res.durationSec,
    removedDurationSec: Math.max(0, origDur - res.durationSec),
    newMovingTimeSec: res.movingTimeSec,
    newElevationGain: res.elevationGain,
    newElevationLoss: res.elevationLoss,
    newAvgSpeedMs: avgSpeedMs,
    keepPolyline: keptGps.length >= 2 ? encodePolyline(keptGps) : null,
    removedPolyline: removedPolylines[0] ?? (removedGps.length >= 2 ? encodePolyline(removedGps) : null),
    removedPolylines,
    boundaryPoint: res.boundaryPoint,
  };
}

function sliceLapsForTrim(
  existingLaps: ActivityLap[] | undefined,
  indexedKept: IndexedOrigPoint[],
  sport: SportType
): ActivityLap[] {
  if (!existingLaps || existingLaps.length === 0 || indexedKept.length < 2) return [];

  const out: ActivityLap[] = [];
  let cursorT = 0;

  for (const lap of existingLaps) {
    const lapOrigStartT = cursorT;
    const lapOrigEndT = cursorT + Math.max(0, lap.durationSec);
    cursorT = lapOrigEndT;

    const hasDistBounds =
      typeof lap.startDistM === 'number' &&
      typeof lap.endDistM === 'number' &&
      lap.endDistM > lap.startDistM;

    const matching = indexedKept.filter((item) => {
      if (hasDistBounds) {
        const d = item.orig.dist ?? -1;
        return d >= lap.startDistM! && d <= lap.endDistM!;
      }
      return item.orig.t >= lapOrigStartT && item.orig.t <= lapOrigEndT;
    });

    if (matching.length < 2) continue;

    const slicePts = matching.map((m) => ({
      ...m.orig,
      t: m.keptT,
      dist: m.keptDist,
    }));

    const startDistM = slicePts[0].dist ?? 0;
    const endDistM = slicePts[slicePts.length - 1].dist ?? startDistM;
    const dist = Math.max(0, Math.round(endDistM - startDistM));
    const dur = Math.max(1, Math.round(slicePts[slicePts.length - 1].t - slicePts[0].t));
    const mov = Math.max(1, Math.min(dur, computeMovingTimeSlice(slicePts) || dur));
    const ele = computeElevationGainLoss(slicePts, 2.0);
    const hrs = slicePts.map((p) => p.hr).filter((v): v is number => typeof v === 'number');
    const watts = slicePts.map((p) => p.watts).filter((v): v is number => typeof v === 'number');
    const cads = slicePts.map((p) => p.cad).filter((v): v is number => typeof v === 'number' && v > 0);
    const speeds = slicePts.map((p) => p.speed).filter((v): v is number => typeof v === 'number' && v >= 0 && v < 35);

    out.push({
      ...lap,
      lapNumber: out.length + 1,
      startDistM,
      endDistM,
      distanceMeters: dist,
      durationSec: dur,
      movingTimeSec: mov,
      avgSpeedMs: dist > 0 && mov > 0 ? Math.round((dist / mov) * 100) / 100 : lap.avgSpeedMs ?? null,
      maxSpeedMs: speeds.length > 0 ? Math.round(Math.max(...speeds) * 100) / 100 : lap.maxSpeedMs ?? null,
      elevationGain: ele.gain,
      elevationLoss: ele.loss,
      avgHr: hrs.length > 0 ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : lap.avgHr ?? null,
      maxHr: hrs.length > 0 ? Math.max(...hrs) : lap.maxHr ?? null,
      avgWatts: watts.length > 0 ? Math.round(watts.reduce((a, b) => a + b, 0) / watts.length) : lap.avgWatts ?? null,
      normalizedPower: watts.length > 10 ? calculateNormalizedPower(slicePts) ?? lap.normalizedPower ?? null : lap.normalizedPower ?? null,
      avgCadence: cads.length > 0 ? Math.round(cads.reduce((a, b) => a + b, 0) / cads.length) : lap.avgCadence ?? null,
    });
  }

  void sport;
  return out;
}

export interface ComputedTrimPayload {
  startedAt: string;
  durationSec: number;
  movingTimeSec: number;
  distanceMeters: number;
  elevationGain: number;
  elevationLoss: number;
  avgSpeedMs: number | null;
  maxSpeedMs: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgWatts: number | null;
  normalizedPower: number | null;
  maxWatts: number | null;
  avgCadence: number | null;
  calories: number | null;
  tss: number;
  polyline: string | null;
  startLat: number | null;
  startLon: number | null;
  points: ActivityPoint[];
  laps: ActivityLap[];
  extras: ActivityExtras | null;
}

export function computeTrimmedActivityData(
  existing: ActivityDetail,
  spec: TrimSpec,
  profile: AthleteProfile
): ComputedTrimPayload {
  const fallbackRatio =
    existing.durationSec > 0 && existing.movingTimeSec > 0
      ? Math.min(1, existing.movingTimeSec / existing.durationSec)
      : 1;

  const sliced = slicePointsForTrim(existing.points, existing.sport, fallbackRatio, spec);
  if (!sliced.valid) {
    throw new Error(sliced.error || 'No se pudo recortar la actividad con los límites indicados.');
  }

  const kept = sliced.keptPoints;
  const startedMs = Date.parse(existing.startedAt);
  const startedAt =
    sliced.tStartShift > 0 && Number.isFinite(startedMs)
      ? new Date(startedMs + sliced.tStartShift * 1000).toISOString()
      : existing.startedAt;

  // Escalar distancia solo si la actividad original no tenía distancia por puntos (ej. bici estática sin distancia)
  let distanceMeters = sliced.distanceMeters;
  if (distanceMeters === 0 && existing.distanceMeters > 0 && existing.durationSec > 0) {
    distanceMeters = Math.round(existing.distanceMeters * (sliced.durationSec / existing.durationSec));
  }

  const hrs = kept.map((p) => p.hr).filter((v): v is number => typeof v === 'number');
  const watts = kept.map((p) => p.watts).filter((v): v is number => typeof v === 'number');
  const cads = kept.map((p) => p.cad).filter((v): v is number => typeof v === 'number' && v > 0);
  const speeds = kept.map((p) => p.speed).filter((v): v is number => typeof v === 'number' && v >= 0 && v < 35);

  const avgHr = hrs.length > 0 ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : existing.avgHr ?? null;
  const maxHr = hrs.length > 0 ? Math.max(...hrs) : existing.maxHr ?? null;
  const avgWatts = watts.length > 0 ? Math.round(watts.reduce((a, b) => a + b, 0) / watts.length) : existing.avgWatts ?? null;
  const maxWatts = watts.length > 0 ? Math.max(...watts) : existing.maxWatts ?? null;
  const normalizedPower =
    watts.length > 10 ? calculateNormalizedPower(kept) ?? avgWatts : avgWatts ?? existing.normalizedPower ?? null;
  const avgCadence =
    cads.length > 0 ? Math.round(cads.reduce((a, b) => a + b, 0) / cads.length) : existing.avgCadence ?? null;

  const speedDenom = existing.excludePausedTime ? sliced.movingTimeSec : sliced.movingTimeSec || sliced.durationSec;
  const avgSpeedMs =
    distanceMeters > 0 && speedDenom > 0
      ? Math.round((distanceMeters / speedDenom) * 100) / 100
      : existing.avgSpeedMs ?? null;
  const maxSpeedMs =
    speeds.length > 0 ? Math.round(Math.max(...speeds) * 100) / 100 : existing.maxSpeedMs ?? null;

  const oldMoving = Math.max(1, existing.movingTimeSec || existing.durationSec || 1);
  const calRatio = Math.max(0.05, Math.min(1, sliced.movingTimeSec / oldMoving));
  const calories =
    typeof existing.calories === 'number' && existing.calories > 0
      ? Math.max(1, Math.round(existing.calories * calRatio))
      : existing.calories ?? null;

  const tss = estimateActivityTSS(
    {
      sport: existing.sport,
      durationSec: sliced.durationSec,
      movingTimeSec: sliced.movingTimeSec,
      avgWatts,
      normalizedPower,
      avgHr,
      rpe: existing.rpe ?? null,
      elevationGain: sliced.elevationGain,
    },
    profile
  );

  const gpsCoords = kept
    .filter((p): p is ActivityPoint & { lat: number; lon: number } => typeof p.lat === 'number' && typeof p.lon === 'number')
    .map((p): [number, number] => [p.lat, p.lon]);

  const polyStep = Math.max(1, Math.ceil(gpsCoords.length / 220));
  const polyCoords =
    gpsCoords.length > 220
      ? gpsCoords.filter((_, idx) => idx % polyStep === 0 || idx === gpsCoords.length - 1)
      : gpsCoords;

  const polyline = polyCoords.length >= 2 ? encodePolyline(polyCoords) : null;
  const startLat = gpsCoords[0]?.[0] ?? null;
  const startLon = gpsCoords[0]?.[1] ?? null;

  const stepsScaled =
    typeof existing.extras?.steps === 'number' && existing.extras.steps > 0
      ? Math.round(existing.extras.steps * calRatio)
      : existing.extras?.steps ?? null;

  const preservedExtras: ActivityExtras = {
    ...(existing.extras ?? {}),
    steps: stepsScaled,
  };

  const extras = computeSessionExtras(
    {
      sport: existing.sport,
      durationSec: sliced.durationSec,
      movingTimeSec: sliced.movingTimeSec,
      distanceMeters,
      elevationGain: sliced.elevationGain,
      avgSpeedMs,
      avgHr,
      avgWatts,
      normalizedPower,
      extras: preservedExtras,
    },
    kept
  );

  const laps = sliceLapsForTrim(existing.laps, sliced.indexedKept, existing.sport);

  return {
    startedAt,
    durationSec: sliced.durationSec,
    movingTimeSec: sliced.movingTimeSec,
    distanceMeters,
    elevationGain: sliced.elevationGain,
    elevationLoss: sliced.elevationLoss,
    avgSpeedMs,
    maxSpeedMs,
    avgHr,
    maxHr,
    avgWatts,
    normalizedPower,
    maxWatts,
    avgCadence,
    calories,
    tss,
    polyline,
    startLat,
    startLon,
    points: downsamplePoints(kept, 1800),
    laps,
    extras,
  };
}
