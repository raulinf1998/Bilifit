import crypto from 'node:crypto';
import { computeElevationGainLoss, encodePolyline, haversineMeters } from '@/lib/polyline';
import type { Activity, ActivityPoint, Segment, SegmentEffort } from '@/types';

/**
 * Construye un Segmento a partir de un rango de distancia [startDistM, endDistM] de una actividad.
 */
export function buildSegmentFromRange(params: {
  activity: Pick<Activity, 'id' | 'sport' | 'worldName'>;
  points: ActivityPoint[];
  startDistM: number;
  endDistM: number;
  name: string;
  category?: Segment['category'];
}): Segment | null {
  const { activity, points, startDistM, endDistM, name, category } = params;
  const sliced = points.filter(
    (p) =>
      typeof p.lat === 'number' &&
      typeof p.lon === 'number' &&
      (p.dist ?? 0) >= startDistM &&
      (p.dist ?? 0) <= endDistM
  );
  if (sliced.length < 3) return null;

  const first = sliced[0];
  const last = sliced[sliced.length - 1];
  const distanceMeters = Math.max(10, Math.round((last.dist ?? endDistM) - (first.dist ?? startDistM)));
  const { gain } = computeElevationGainLoss(sliced, 1.5);
  const netGain =
    typeof first.ele === 'number' && typeof last.ele === 'number' ? last.ele - first.ele : gain;
  const effectiveGain = Math.max(gain, Math.round(Math.max(0, netGain)));
  const avgGradePct =
    distanceMeters > 0 && typeof first.ele === 'number' && typeof last.ele === 'number'
      ? Math.round((netGain / distanceMeters) * 1000) / 10
      : distanceMeters > 0
        ? Math.round((gain / distanceMeters) * 1000) / 10
        : 0;
  const grades = sliced.map((p) => p.grade ?? 0);
  const maxGradePct = grades.length > 0 ? Math.round(Math.max(avgGradePct, ...grades) * 10) / 10 : avgGradePct;

  const coords: Array<[number, number]> = sliced.map((p) => [p.lat!, p.lon!]);
  const sampleStep = Math.max(1, Math.floor(sliced.length / 80));
  const compactPoints = sliced
    .filter((_, idx) => idx % sampleStep === 0 || idx === sliced.length - 1)
    .map((p) => ({
      lat: p.lat!,
      lon: p.lon!,
      ele: p.ele,
      dist: Math.round((p.dist ?? 0) - (first.dist ?? 0)),
    }));

  const autoCategory: Segment['category'] =
    category ?? (avgGradePct >= 3 && effectiveGain >= 35 ? 'climb' : distanceMeters <= 1200 ? 'sprint' : 'flat');

  return {
    id: `seg_${crypto.randomUUID().slice(0, 10)}`,
    name: name.trim(),
    sport: activity.sport,
    category: autoCategory,
    distanceMeters,
    elevationGain: effectiveGain,
    avgGradePct,
    maxGradePct,
    startLat: first.lat!,
    startLon: first.lon!,
    endLat: last.lat!,
    endLon: last.lon!,
    polyline: encodePolyline(coords),
    points: compactPoints,
    sourceActivityId: activity.id,
    worldName: activity.worldName ?? null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Detecta automáticamente subidas/puertos relevantes en una ruta GPS.
 */
export function detectClimbCandidates(
  points: ActivityPoint[],
  minGainM = 45,
  minDistM = 350,
  minAvgGrade = 3.0
): Array<{ startDistM: number; endDistM: number; distanceMeters: number; elevationGain: number; avgGradePct: number }> {
  const withGeo = points.filter(
    (p) => typeof p.lat === 'number' && typeof p.lon === 'number' && typeof p.ele === 'number'
  );
  if (withGeo.length < 6) return [];

  const climbs: Array<{ startDistM: number; endDistM: number; distanceMeters: number; elevationGain: number; avgGradePct: number }> = [];
  let inClimb = false;
  let startIdx = 0;
  let peakIdx = 0;

  for (let i = 1; i < withGeo.length; i++) {
    const prev = withGeo[i - 1];
    const ele = withGeo[i].ele!;
    const dd = (withGeo[i].dist ?? 0) - (prev.dist ?? 0);
    const grade =
      typeof withGeo[i].grade === 'number'
        ? withGeo[i].grade!
        : dd > 5
          ? ((ele - prev.ele!) / dd) * 100
          : 0;

    if (!inClimb) {
      if (grade >= 2.2) {
        inClimb = true;
        startIdx = Math.max(0, i - 1);
        peakIdx = i;
      }
    } else {
      if (ele >= withGeo[peakIdx].ele!) {
        peakIdx = i;
      }
      const dropFromPeak = withGeo[peakIdx].ele! - ele;
      const isLast = i === withGeo.length - 1;
      if (dropFromPeak >= 18 || (grade < -1.5 && i - peakIdx >= 3) || isLast) {
        const sd = withGeo[startIdx].dist ?? 0;
        const ed = withGeo[peakIdx].dist ?? 0;
        const dist = ed - sd;
        const gain = withGeo[peakIdx].ele! - withGeo[startIdx].ele!;
        const avgGrade = dist > 0 ? (gain / dist) * 100 : 0;

        if (gain >= minGainM && dist >= minDistM && avgGrade >= minAvgGrade) {
          climbs.push({
            startDistM: Math.round(sd),
            endDistM: Math.round(ed),
            distanceMeters: Math.round(dist),
            elevationGain: Math.round(gain),
            avgGradePct: Math.round(avgGrade * 10) / 10,
          });
        }
        inClimb = false;
      }
    }
  }

  return climbs;
}

/**
 * Comprueba si la traza GPS de una actividad recorre un segmento dado y extrae el mejor paso.
 */
export function matchPointsToSegment(
  activity: Pick<Activity, 'id' | 'title' | 'startedAt' | 'sport' | 'worldName'>,
  points: ActivityPoint[],
  segment: Segment
): SegmentEffort | null {
  if (points.length < 4) return null;
  if (segment.worldName && activity.worldName && segment.worldName !== activity.worldName) {
    return null;
  }

  const geoPoints = points.filter((p) => typeof p.lat === 'number' && typeof p.lon === 'number');
  if (geoPoints.length < 4) return null;

  // Tolerancia adaptativa según densidad de muestreo (mínimo 55/75m para GPX de 1Hz, hasta ~180m en trazas dispersas)
  let totalStep = 0;
  let stepCount = 0;
  const sampleLimit = Math.min(geoPoints.length - 1, 40);
  for (let i = 1; i <= sampleLimit; i++) {
    totalStep += haversineMeters(geoPoints[i - 1].lat!, geoPoints[i - 1].lon!, geoPoints[i].lat!, geoPoints[i].lon!);
    stepCount++;
  }
  const avgStep = stepCount > 0 ? totalStep / stepCount : 25;
  const baseTol = activity.sport === 'mywhoosh' || activity.sport === 'cycling' ? 75 : 55;
  const startTol = Math.max(baseTol, Math.min(180, Math.round(avgStep * 0.95)));
  const midPt = segment.points[Math.floor(segment.points.length / 2)];
  let bestMatch: { startIdx: number; endIdx: number; dur: number } | null = null;

  for (let i = 0; i < geoPoints.length - 2; i++) {
    const dStart = haversineMeters(geoPoints[i].lat!, geoPoints[i].lon!, segment.startLat, segment.startLon);
    if (dStart > startTol) continue;

    // Avanzar al punto más cercano al inicio dentro de un grupo contiguo de entrada
    let bestEntry = i;
    let bestEntryDist = dStart;
    let j = i + 1;
    while (j < geoPoints.length - 1) {
      const dj = haversineMeters(geoPoints[j].lat!, geoPoints[j].lon!, segment.startLat, segment.startLon);
      if (dj <= bestEntryDist) {
        bestEntry = j;
        bestEntryDist = dj;
        j++;
      } else if (dj > startTol) {
        break;
      } else {
        j++;
      }
    }

    const entryDistM = geoPoints[bestEntry].dist ?? 0;
    let passedMid = !midPt;
    let minEndDist = Infinity;
    let bestEndIdx = -1;

    for (let k = bestEntry + 1; k < geoPoints.length; k++) {
      const traveled = (geoPoints[k].dist ?? 0) - entryDistM;
      if (traveled > segment.distanceMeters * 1.4 + 250) break;

      if (!passedMid && midPt) {
        const dMid = haversineMeters(geoPoints[k].lat!, geoPoints[k].lon!, midPt.lat, midPt.lon);
        if (dMid <= startTol * 1.6) passedMid = true;
      }

      if (traveled >= segment.distanceMeters * 0.72) {
        const dEnd = haversineMeters(geoPoints[k].lat!, geoPoints[k].lon!, segment.endLat, segment.endLon);
        if (dEnd <= startTol && dEnd < minEndDist) {
          minEndDist = dEnd;
          bestEndIdx = k;
        }
      }
    }

    if (passedMid && bestEndIdx > bestEntry) {
      const dur = Math.max(1, geoPoints[bestEndIdx].t - geoPoints[bestEntry].t);
      if (!bestMatch || dur < bestMatch.dur) {
        bestMatch = { startIdx: bestEntry, endIdx: bestEndIdx, dur };
      }
      i = bestEndIdx; // saltar hasta el final del paso actual para poder detectar vueltas posteriores
    }
  }

  if (!bestMatch) return null;

  const slice = geoPoints.slice(bestMatch.startIdx, bestMatch.endIdx + 1);
  const hrs = slice.map((p) => p.hr).filter((v): v is number => typeof v === 'number');
  const watts = slice.map((p) => p.watts).filter((v): v is number => typeof v === 'number');
  const cads = slice.map((p) => p.cad).filter((v): v is number => typeof v === 'number');
  const avgSpeedMs = Math.round((segment.distanceMeters / bestMatch.dur) * 100) / 100;
  const vamMh =
    segment.elevationGain >= 20 && bestMatch.dur >= 20
      ? Math.round((segment.elevationGain / bestMatch.dur) * 3600)
      : null;

  return {
    id: `eff_${segment.id}_${activity.id}`,
    segmentId: segment.id,
    segmentName: segment.name,
    segmentDistanceMeters: segment.distanceMeters,
    segmentElevationGain: segment.elevationGain,
    segmentAvgGradePct: segment.avgGradePct,
    activityId: activity.id,
    activityTitle: activity.title,
    startedAt: activity.startedAt,
    sport: activity.sport,
    durationSec: bestMatch.dur,
    avgSpeedMs,
    avgHr: hrs.length > 0 ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
    maxHr: hrs.length > 0 ? Math.max(...hrs) : null,
    avgWatts: watts.length > 0 ? Math.round(watts.reduce((a, b) => a + b, 0) / watts.length) : null,
    avgCadence: cads.length > 0 ? Math.round(cads.reduce((a, b) => a + b, 0) / cads.length) : null,
    vamMh,
  };
}
