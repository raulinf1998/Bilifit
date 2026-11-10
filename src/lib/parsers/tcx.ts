import { XMLParser } from 'fast-xml-parser';
import { computeSessionExtras, enrichPointsTelemetry } from '@/lib/analytics';
import { calculateNormalizedPower } from '@/lib/metrics';
import { computeElevationGainLoss, downsamplePoints, encodePolyline, haversineMeters } from '@/lib/polyline';
import { inferSportFromText, type ParsedActivityData } from '@/lib/parsers/gpx';
import type { ActivityLap, ActivityPoint } from '@/types';

function asArray<T>(val: T | T[] | undefined | null): T[] {
  if (val == null) return [];
  return Array.isArray(val) ? val : [val];
}

function toNum(val: unknown): number | undefined {
  if (val === undefined || val === null || val === '') return undefined;
  const n = Number(val);
  return Number.isFinite(n) ? n : undefined;
}

export function parseTcxString(xmlText: string, fileName = 'actividad.tcx'): ParsedActivityData {
  const cleanXml = xmlText.replace(/^\uFEFF/, '');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    parseTagValue: true,
  });

  const parsed = parser.parse(cleanXml);
  const db = parsed?.TrainingCenterDatabase;
  const activities = asArray(db?.Activities?.Activity);
  const act = activities[0];
  if (!act) {
    throw new Error(`El archivo TCX ${fileName} no contiene actividades.`);
  }

  const rawSport = String(act['@_Sport'] ?? '');
  const title = String(act.Notes ?? fileName.replace(/\.tcx$/i, ''));
  const deviceName = act.Creator?.Name ? String(act.Creator.Name) : undefined;
  const rawLaps = asArray(act.Lap);

  const points: ActivityPoint[] = [];
  const parsedLaps: ActivityLap[] = [];
  let startMs: number | null = act.Id ? Date.parse(String(act.Id)) : null;
  if (startMs !== null && !Number.isFinite(startMs)) startMs = null;

  let prevLat: number | undefined;
  let prevLon: number | undefined;
  let prevTimeMs: number | undefined;
  let cumDist = 0;
  let movingTimeSec = 0;
  let lapCaloriesTotal = 0;

  let hrSum = 0;
  let hrCount = 0;
  let maxHr = 0;
  let wattsSum = 0;
  let wattsCount = 0;
  let maxWatts = 0;
  let cadSum = 0;
  let cadCount = 0;
  let maxSpeedMs = 0;

  rawLaps.forEach((lap, lapIndex) => {
    const lapCalories = toNum(lap.Calories) ?? 0;
    lapCaloriesTotal += lapCalories;
    const lapStartPointIdx = points.length;
    const lapStartDist = cumDist;

    let lapPtsRaw: Record<string, unknown>[] = [];
    for (const track of asArray(lap.Track)) {
      lapPtsRaw = lapPtsRaw.concat(asArray(track.Trackpoint));
    }

    for (const pt of lapPtsRaw) {
      const pos = (pt.Position ?? {}) as Record<string, unknown>;
      const lat = toNum(pos.LatitudeDegrees);
      const lon = toNum(pos.LongitudeDegrees);
      const ele = toNum(pt.AltitudeMeters);
      const distTag = toNum(pt.DistanceMeters);
      const tMs = pt.Time ? Date.parse(String(pt.Time)) : NaN;

      if (startMs === null && Number.isFinite(tMs)) startMs = tMs;
      const elapsedSec =
        startMs !== null && Number.isFinite(tMs)
          ? Math.max(0, Math.round((tMs - startMs) / 1000))
          : points.length * 2;

      if (distTag !== undefined) {
        cumDist = distTag;
      } else if (lat !== undefined && lon !== undefined && prevLat !== undefined && prevLon !== undefined) {
        const step = haversineMeters(prevLat, prevLon, lat, lon);
        if (step < 1500) cumDist += step;
      }

      const tpx = ((pt.Extensions as Record<string, unknown> | undefined)?.TPX ?? {}) as Record<string, unknown>;
      const hr = toNum((pt.HeartRateBpm as Record<string, unknown> | undefined)?.Value);
      const cad = toNum(pt.Cadence ?? tpx.RunCadence);
      const watts = toNum(tpx.Watts ?? tpx.Power);
      let speedMs = toNum(tpx.Speed);

      if (prevTimeMs !== undefined && Number.isFinite(tMs)) {
        const dt = (tMs - prevTimeMs) / 1000;
        if (dt > 0 && dt <= 60) {
          if (speedMs === undefined && lat !== undefined && lon !== undefined && prevLat !== undefined && prevLon !== undefined) {
            speedMs = haversineMeters(prevLat, prevLon, lat, lon) / dt;
          }
          if ((speedMs && speedMs > 0.35) || (watts && watts > 15)) {
            movingTimeSec += dt;
          }
        }
      }
      if (speedMs !== undefined && speedMs > maxSpeedMs && speedMs < 35) maxSpeedMs = speedMs;

      if (hr !== undefined && hr > 25 && hr < 240) {
        hrSum += hr;
        hrCount++;
        if (hr > maxHr) maxHr = hr;
      }
      if (watts !== undefined && watts >= 0 && watts < 2500) {
        wattsSum += watts;
        wattsCount++;
        if (watts > maxWatts) maxWatts = watts;
      }
      if (cad !== undefined && cad >= 0 && cad < 250) {
        cadSum += cad;
        cadCount++;
      }

      points.push({
        t: elapsedSec,
        lat,
        lon,
        ele: ele !== undefined ? Math.round(ele * 10) / 10 : undefined,
        hr: hr !== undefined ? Math.round(hr) : undefined,
        watts: watts !== undefined ? Math.round(watts) : undefined,
        cad: cad !== undefined ? Math.round(cad) : undefined,
        speed: speedMs !== undefined ? Math.round(speedMs * 100) / 100 : undefined,
        dist: Math.round(cumDist),
      });

      if (lat !== undefined && lon !== undefined) {
        prevLat = lat;
        prevLon = lon;
      }
      if (Number.isFinite(tMs)) prevTimeMs = tMs;
    }

    const lapSlice = points.slice(lapStartPointIdx);
    const lapEle = computeElevationGainLoss(lapSlice, 1.5);
    const lapDur = Math.round(toNum(lap.TotalTimeSeconds) ?? (lapSlice.length > 1 ? lapSlice[lapSlice.length - 1].t - lapSlice[0].t : 0));
    const lapDist = Math.round(toNum(lap.DistanceMeters) ?? Math.max(0, cumDist - lapStartDist));
    const lapAvgHr = toNum((lap.AverageHeartRateBpm as Record<string, unknown> | undefined)?.Value);
    const lapMaxHr = toNum((lap.MaximumHeartRateBpm as Record<string, unknown> | undefined)?.Value);
    const lapCad = toNum(lap.Cadence);

    if (lapDur > 0 || lapDist > 0) {
      parsedLaps.push({
        lapNumber: lapIndex + 1,
        name: `Vuelta ${lapIndex + 1}`,
        startDistM: Math.round(lapStartDist),
        endDistM: Math.round(lapStartDist + lapDist),
        distanceMeters: lapDist,
        durationSec: lapDur,
        movingTimeSec: lapDur,
        avgSpeedMs: lapDur > 0 && lapDist > 0 ? Math.round((lapDist / lapDur) * 100) / 100 : null,
        maxSpeedMs: toNum(lap.MaximumSpeed) ?? null,
        elevationGain: lapEle.gain,
        elevationLoss: lapEle.loss,
        avgHr: lapAvgHr ? Math.round(lapAvgHr) : null,
        maxHr: lapMaxHr ? Math.round(lapMaxHr) : null,
        avgCadence: lapCad ? Math.round(lapCad) : null,
        calories: lapCalories > 0 ? Math.round(lapCalories) : null,
        trigger: lap.TriggerMethod ? String(lap.TriggerMethod) : null,
      });
    }
  });

  const durationSec = points[points.length - 1]?.t || rawLaps.reduce((acc, l) => acc + (toNum(l.TotalTimeSeconds) ?? 0), 0) || 0;
  const distanceMeters = Math.round(cumDist || rawLaps.reduce((acc, l) => acc + (toNum(l.DistanceMeters) ?? 0), 0));
  const { gain, loss } = computeElevationGainLoss(points);

  const coordsForPoly: Array<[number, number]> = points
    .filter((p): p is ActivityPoint & { lat: number; lon: number } => typeof p.lat === 'number' && typeof p.lon === 'number')
    .map((p) => [p.lat, p.lon]);

  const hasPower = wattsCount > 5;
  const inferred = inferSportFromText(rawSport, title, deviceName ?? '', gain, distanceMeters, hasPower, coordsForPoly);
  const enrichedPoints = enrichPointsTelemetry(points, inferred.sport);

  const downsampledForPoly =
    coordsForPoly.length > 220
      ? coordsForPoly.filter((_, idx) => idx % Math.ceil(coordsForPoly.length / 220) === 0 || idx === coordsForPoly.length - 1)
      : coordsForPoly;

  const effectiveMoving = movingTimeSec > 0 ? Math.round(movingTimeSec) : Math.round(durationSec);
  const avgSpeedMs = effectiveMoving > 0 && distanceMeters > 0 ? Math.round((distanceMeters / effectiveMoving) * 100) / 100 : undefined;
  const avgWatts = wattsCount > 0 ? Math.round(wattsSum / wattsCount) : undefined;
  const avgHr = hrCount > 0 ? Math.round(hrSum / hrCount) : undefined;
  const np = hasPower ? calculateNormalizedPower(enrichedPoints) ?? undefined : undefined;
  const rawAvgCad = cadCount > 0 ? Math.round(cadSum / cadCount) : undefined;
  const avgCadence =
    rawAvgCad !== undefined && (inferred.sport === 'running' || inferred.sport === 'mountain') && rawAvgCad < 115
      ? rawAvgCad * 2
      : rawAvgCad;

  const extras = computeSessionExtras(
    {
      sport: inferred.sport,
      durationSec: Math.round(durationSec),
      movingTimeSec: effectiveMoving,
      distanceMeters,
      elevationGain: gain,
      avgSpeedMs: avgSpeedMs ?? null,
      avgHr: avgHr ?? null,
      avgWatts: avgWatts ?? null,
      normalizedPower: np ?? null,
      extras: deviceName ? { deviceName } : null,
    },
    enrichedPoints
  );

  return {
    source: 'tcx',
    sport: inferred.sport,
    subSport: inferred.subSport,
    title: title || 'Actividad importada (TCX)',
    startedAt: startMs !== null ? new Date(startMs).toISOString() : new Date().toISOString(),
    durationSec: Math.round(durationSec),
    movingTimeSec: effectiveMoving,
    distanceMeters,
    elevationGain: gain,
    elevationLoss: loss,
    avgSpeedMs,
    maxSpeedMs: maxSpeedMs > 0 ? Math.round(maxSpeedMs * 100) / 100 : undefined,
    avgHr,
    maxHr: maxHr > 0 ? Math.round(maxHr) : undefined,
    avgWatts,
    normalizedPower: np,
    maxWatts: maxWatts > 0 ? Math.round(maxWatts) : undefined,
    avgCadence,
    calories: lapCaloriesTotal > 0 ? Math.round(lapCaloriesTotal) : undefined,
    worldName: inferred.worldName,
    polyline: downsampledForPoly.length > 1 ? encodePolyline(downsampledForPoly) : undefined,
    startLat: coordsForPoly[0]?.[0],
    startLon: coordsForPoly[0]?.[1],
    points: downsamplePoints(enrichedPoints, 1800),
    laps: parsedLaps,
    extras,
  };
}
