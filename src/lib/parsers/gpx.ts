import { XMLParser } from 'fast-xml-parser';
import { resolveActivityTitle } from '@/lib/activity-naming';
import { computeSessionExtras, enrichPointsTelemetry } from '@/lib/analytics';
import { calculateNormalizedPower } from '@/lib/metrics';
import { isMyWhooshContext, MYWHOOSH_WORLDS, resolveMyWhooshWorldForActivity } from '@/lib/mywhoosh-maps';
import { computeElevationGainLoss, downsamplePoints, encodePolyline, haversineMeters } from '@/lib/polyline';
import type { ActivityExtras, ActivityLap, ActivityPoint, SportType } from '@/types';

export interface ParsedActivityData {
  externalId?: string;
  source: 'gpx' | 'tcx' | 'fit';
  sport: SportType;
  subSport?: string;
  title: string;
  description?: string;
  startedAt: string;
  durationSec: number;
  movingTimeSec: number;
  distanceMeters: number;
  elevationGain: number;
  elevationLoss: number;
  avgSpeedMs?: number;
  maxSpeedMs?: number;
  avgHr?: number;
  maxHr?: number;
  avgWatts?: number;
  normalizedPower?: number;
  maxWatts?: number;
  avgCadence?: number;
  calories?: number;
  worldName?: string;
  polyline?: string;
  startLat?: number;
  startLon?: number;
  points: ActivityPoint[];
  laps?: ActivityLap[];
  extras?: ActivityExtras;
}

function asArray<T>(val: T | T[] | undefined | null): T[] {
  if (val == null) return [];
  return Array.isArray(val) ? val : [val];
}

function toNum(val: unknown): number | undefined {
  if (val === undefined || val === null || val === '') return undefined;
  const n = Number(val);
  return Number.isFinite(n) ? n : undefined;
}

export function detectMyWhooshWorld(text: string): string | undefined {
  const lower = text.toLowerCase();
  const matched = MYWHOOSH_WORLDS.find((w) => {
    const wl = w.name.toLowerCase();
    if (wl.length <= 5) {
      return new RegExp(`\\b${wl}\\b`, 'i').test(lower);
    }
    return lower.includes(wl);
  });
  return matched?.name;
}

export function inferSportFromText(
  rawType: string,
  title: string,
  creator: string,
  elevationGain: number,
  distanceMeters: number,
  hasPower: boolean,
  coords: Array<[number, number]> = []
): { sport: SportType; subSport?: string; worldName?: string } {
  const combined = `${rawType} ${title} ${creator}`.toLowerCase();
  const hasExplicitVirtualMarker =
    combined.includes('mywhoosh') ||
    combined.includes('virtualride') ||
    combined.includes('virtual_activity') ||
    combined.includes('virtual ride') ||
    combined.includes('indoor_cycling') ||
    combined.includes('rodillo') ||
    combined.includes('zwift') ||
    isMyWhooshContext({ title: combined, deviceName: creator });

  const resolvedWorld = resolveMyWhooshWorldForActivity({
    worldName: hasExplicitVirtualMarker ? detectMyWhooshWorld(combined) : undefined,
    title: combined,
    subSport: hasExplicitVirtualMarker ? 'virtual_activity' : rawType,
    deviceName: creator,
    coords,
  });

  if (
    hasExplicitVirtualMarker ||
    (resolvedWorld && (hasPower || combined.includes('ride') || combined.includes('cycl')))
  ) {
    return { sport: 'mywhoosh', subSport: 'MyWhoosh Indoor', worldName: resolvedWorld?.world.name };
  }

  if (combined.includes('trail')) {
    return { sport: 'trail', subSport: 'Trail Running' };
  }

  if (
    combined.includes('hik') ||
    combined.includes('senderismo') ||
    combined.includes('trek') ||
    combined.includes('monta') ||
    combined.includes('alpin') ||
    combined.includes('picos')
  ) {
    return { sport: 'mountain', subSport: 'Senderismo' };
  }

  if (combined.includes('walk') || combined.includes('caminat') || combined.includes('caminar') || combined.includes('paseo')) {
    return { sport: 'walking', subSport: 'Caminar' };
  }

  if (combined.includes('strength') || combined.includes('fuerza') || combined.includes('weight') || combined.includes('gym')) {
    return { sport: 'strength', subSport: 'Fuerza' };
  }

  if (combined.includes('run') || combined.includes('correr') || combined.includes('carrera')) {
    const km = distanceMeters / 1000;
    if (km >= 4 && elevationGain / km > 35 && elevationGain >= 300) {
      return { sport: 'trail', subSport: 'Trail Running' };
    }
    return { sport: 'running', subSport: 'Correr' };
  }

  if (combined.includes('cycl') || combined.includes('bike') || combined.includes('bici') || combined.includes('ride') || combined.includes('mtb') || combined.includes('gravel')) {
    return { sport: 'cycling', subSport: combined.includes('mtb') ? 'MTB' : combined.includes('gravel') ? 'Gravel' : 'Carretera' };
  }

  if (hasPower) {
    return { sport: 'cycling', subSport: 'Ciclismo' };
  }
  if (distanceMeters > 0 && elevationGain >= 400 && elevationGain / Math.max(1, distanceMeters / 1000) > 35) {
    return { sport: 'mountain', subSport: 'Senderismo' };
  }
  return { sport: 'running', subSport: 'Actividad GPS' };
}

export function parseGpxString(xmlText: string, fileName = 'actividad.gpx'): ParsedActivityData {
  const cleanXml = xmlText.replace(/^\uFEFF/, '');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    parseTagValue: true,
  });

  const parsed = parser.parse(cleanXml);
  const gpx = parsed?.gpx;
  if (!gpx) {
    throw new Error(`El archivo ${fileName} no contiene una etiqueta <gpx> válida.`);
  }

  const creator = String(gpx['@_creator'] ?? '');
  const tracks = asArray(gpx.trk);
  const routes = asArray(gpx.rte);

  const firstTrk = tracks[0] ?? routes[0];
  const rawTitle = String(firstTrk?.name ?? gpx.metadata?.name ?? fileName.replace(/\.(gpx|xml)$/i, ''));
  const rawType = String(firstTrk?.type ?? '');
  const description = firstTrk?.desc ? String(firstTrk.desc) : gpx.metadata?.desc ? String(gpx.metadata.desc) : undefined;

  let rawPoints: Record<string, unknown>[] = [];
  const rawSegmentRanges: Array<{ startIdx: number; endIdx: number; name?: string }> = [];
  if (tracks.length > 0) {
    for (const trk of tracks) {
      const trkName = typeof trk.name === 'string' && trk.name.trim() ? trk.name.trim() : undefined;
      for (const seg of asArray(trk.trkseg)) {
        const segPts = asArray(seg.trkpt);
        if (segPts.length === 0) continue;
        const startIdx = rawPoints.length;
        rawPoints = rawPoints.concat(segPts);
        const segObj = seg as Record<string, unknown>;
        const segName =
          (typeof segObj.name === 'string' && segObj.name.trim() ? segObj.name.trim() : undefined) ??
          (tracks.length > 1 ? trkName : undefined);
        rawSegmentRanges.push({ startIdx, endIdx: rawPoints.length - 1, name: segName });
      }
    }
  } else if (routes.length > 0) {
    for (const rte of routes) {
      rawPoints = rawPoints.concat(asArray(rte.rtept));
    }
  }

  if (rawPoints.length === 0) {
    throw new Error(`El archivo GPX ${fileName} no contiene puntos GPS.`);
  }

  const points: ActivityPoint[] = [];
  let startMs: number | null = null;
  let prevLat: number | undefined;
  let prevLon: number | undefined;
  let prevTimeMs: number | undefined;
  let cumDist = 0;
  let movingTimeSec = 0;

  let hrSum = 0;
  let hrCount = 0;
  let maxHr = 0;

  let wattsSum = 0;
  let wattsCount = 0;
  let maxWatts = 0;

  let cadSum = 0;
  let cadCount = 0;

  let maxSpeedMs = 0;

  for (const pt of rawPoints) {
    const lat = toNum(pt['@_lat']);
    const lon = toNum(pt['@_lon']);
    const ele = toNum(pt.ele);
    const timeStr = pt.time ? String(pt.time) : undefined;
    const tMs = timeStr ? Date.parse(timeStr) : NaN;

    if (startMs === null && Number.isFinite(tMs)) {
      startMs = tMs;
    }

    const elapsedSec =
      startMs !== null && Number.isFinite(tMs)
        ? Math.max(0, Math.round((tMs - startMs) / 1000))
        : points.length * 2;

    let stepDist = 0;
    if (lat !== undefined && lon !== undefined && prevLat !== undefined && prevLon !== undefined) {
      stepDist = haversineMeters(prevLat, prevLon, lat, lon);
      if (stepDist < 1500) {
        cumDist += stepDist;
      }
    }

    const ext = (pt.extensions ?? {}) as Record<string, unknown>;
    const tpe = (ext.TrackPointExtension ?? ext.trackpointextension ?? {}) as Record<string, unknown>;

    let speedMs = toNum(tpe.speed ?? ext.speed ?? pt.speed);
    if (speedMs === undefined && prevTimeMs !== undefined && Number.isFinite(tMs)) {
      const dt = (tMs - prevTimeMs) / 1000;
      if (dt > 0 && dt <= 60) {
        speedMs = stepDist / dt;
      }
    }
    if (speedMs !== undefined && prevTimeMs !== undefined && Number.isFinite(tMs)) {
      const dt = (tMs - prevTimeMs) / 1000;
      if (dt > 0 && dt <= 60) {
        if (speedMs > maxSpeedMs && speedMs < 35) maxSpeedMs = speedMs;
        if (speedMs > 0.35) movingTimeSec += dt;
      }
    }

    const hr = toNum(tpe.hr ?? ext.hr ?? ext.heartrate ?? pt.hr);
    const cad = toNum(tpe.cad ?? tpe.cadence ?? ext.cad ?? ext.cadence ?? pt.cad);
    const watts = toNum(ext.power ?? ext.watts ?? tpe.power ?? tpe.watts ?? pt.power ?? pt.watts);
    const temp = toNum(tpe.atemp ?? ext.atemp ?? ext.temp ?? pt.temp);

    if (hr !== undefined && hr > 25 && hr < 240) {
      hrSum += hr;
      hrCount++;
      if (hr > maxHr) maxHr = hr;
    }
    if (watts !== undefined && watts >= 0 && watts < 2500) {
      wattsSum += watts;
      wattsCount++;
      if (watts > maxWatts) maxWatts = watts;
      if ((!speedMs || speedMs <= 0.35) && watts > 15 && prevTimeMs !== undefined && Number.isFinite(tMs)) {
        const dt = (tMs - prevTimeMs) / 1000;
        if (dt > 0 && dt <= 60) movingTimeSec += dt;
      }
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
      temp: temp !== undefined ? Math.round(temp * 10) / 10 : undefined,
    });

    if (lat !== undefined && lon !== undefined) {
      prevLat = lat;
      prevLon = lon;
    }
    if (Number.isFinite(tMs)) {
      prevTimeMs = tMs;
    }
  }

  const durationSec = points[points.length - 1]?.t || points.length * 2;
  const effectiveMoving = movingTimeSec > 0 ? Math.round(movingTimeSec) : durationSec;
  const distanceMeters = Math.round(cumDist);
  const { gain, loss } = computeElevationGainLoss(points);

  const coordsForPoly: Array<[number, number]> = points
    .filter((p): p is ActivityPoint & { lat: number; lon: number } => typeof p.lat === 'number' && typeof p.lon === 'number')
    .map((p) => [p.lat, p.lon]);

  const hasPower = wattsCount > 5;
  const inferred = inferSportFromText(rawType, rawTitle, creator, gain, distanceMeters, hasPower, coordsForPoly);

  const enrichedPoints = enrichPointsTelemetry(points, inferred.sport);

  // Extraer segmentos GPX si existen múltiples <trkseg> o <trk>
  const parsedLaps: ActivityLap[] = [];
  if (rawSegmentRanges.length > 1) {
    for (let i = 0; i < rawSegmentRanges.length; i++) {
      const r = rawSegmentRanges[i];
      const slice = enrichedPoints.slice(r.startIdx, r.endIdx + 1);
      if (slice.length < 2) continue;
      const first = slice[0];
      const last = slice[slice.length - 1];
      const startDistM = Math.round(first.dist ?? 0);
      const endDistM = Math.round(last.dist ?? startDistM);
      const distanceMetersSeg = Math.max(0, endDistM - startDistM);
      const durSeg = Math.max(1, Math.round(last.t - first.t));
      let movSeg = 0;
      for (let j = 1; j < slice.length; j++) {
        const dt = slice[j].t - slice[j - 1].t;
        if (dt > 0 && dt <= 60 && ((slice[j].speed ?? 0) > 0.35 || (slice[j].watts ?? 0) > 15)) {
          movSeg += dt;
        }
      }
      const movingSeg = movSeg > 0 ? Math.min(durSeg, Math.round(movSeg)) : durSeg;
      const eleSeg = computeElevationGainLoss(slice, 1.8);
      const hrs = slice.map((p) => p.hr).filter((v): v is number => typeof v === 'number');
      const watts = slice.map((p) => p.watts).filter((v): v is number => typeof v === 'number');
      const cads = slice.map((p) => p.cad).filter((v): v is number => typeof v === 'number' && v > 0);
      const speeds = slice.map((p) => p.speed).filter((v): v is number => typeof v === 'number' && v > 0 && v < 40);

      parsedLaps.push({
        lapNumber: parsedLaps.length + 1,
        name: r.name || `Segmento ${parsedLaps.length + 1}`,
        startDistM,
        endDistM,
        distanceMeters: distanceMetersSeg,
        durationSec: durSeg,
        movingTimeSec: movingSeg,
        avgSpeedMs:
          distanceMetersSeg > 0 && movingSeg > 0
            ? Math.round((distanceMetersSeg / movingSeg) * 100) / 100
            : null,
        maxSpeedMs: speeds.length > 0 ? Math.round(Math.max(...speeds) * 100) / 100 : null,
        elevationGain: eleSeg.gain,
        elevationLoss: eleSeg.loss,
        avgGradePct:
          distanceMetersSeg >= 20 && typeof first.ele === 'number' && typeof last.ele === 'number'
            ? Math.round(((last.ele - first.ele) / distanceMetersSeg) * 1000) / 10
            : null,
        avgHr: hrs.length > 0 ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
        maxHr: hrs.length > 0 ? Math.max(...hrs) : null,
        avgWatts: watts.length > 0 ? Math.round(watts.reduce((a, b) => a + b, 0) / watts.length) : null,
        normalizedPower: watts.length > 10 ? calculateNormalizedPower(slice) : null,
        avgCadence: cads.length > 0 ? Math.round(cads.reduce((a, b) => a + b, 0) / cads.length) : null,
        calories: null,
        trigger: 'segment',
      });
    }
  }

  const downsampledForPoly =
    coordsForPoly.length > 220
      ? coordsForPoly.filter((_, idx) => idx % Math.ceil(coordsForPoly.length / 220) === 0 || idx === coordsForPoly.length - 1)
      : coordsForPoly;

  const np = hasPower ? calculateNormalizedPower(enrichedPoints) ?? undefined : undefined;
  const startedAt = startMs !== null ? new Date(startMs).toISOString() : new Date().toISOString();
  const avgSpeedMs = effectiveMoving > 0 && distanceMeters > 0 ? Math.round((distanceMeters / effectiveMoving) * 100) / 100 : undefined;
  const rawAvgCad = cadCount > 0 ? Math.round(cadSum / cadCount) : undefined;
  const shouldDoubleCad =
    rawAvgCad !== undefined &&
    (((inferred.sport === 'running' || inferred.sport === 'trail' || inferred.sport === 'mountain') &&
      rawAvgCad < 115) ||
      (inferred.sport === 'walking' && rawAvgCad < 80));
  const avgCadence = shouldDoubleCad ? rawAvgCad! * 2 : rawAvgCad;

  const avgWatts = wattsCount > 0 ? Math.round(wattsSum / wattsCount) : undefined;
  const avgHr = hrCount > 0 ? Math.round(hrSum / hrCount) : undefined;

  const extras = computeSessionExtras(
    {
      sport: inferred.sport,
      durationSec,
      movingTimeSec: effectiveMoving,
      distanceMeters,
      elevationGain: gain,
      avgSpeedMs: avgSpeedMs ?? null,
      avgHr: avgHr ?? null,
      avgWatts: avgWatts ?? null,
      normalizedPower: np ?? null,
      extras: creator ? { deviceName: creator } : null,
    },
    enrichedPoints
  );

  return {
    source: 'gpx',
    sport: inferred.sport,
    subSport: inferred.subSport,
    title: resolveActivityTitle(rawTitle, inferred.sport, startedAt),
    description,
    startedAt,
    durationSec,
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
    worldName: inferred.worldName,
    polyline: downsampledForPoly.length > 1 ? encodePolyline(downsampledForPoly) : undefined,
    startLat: coordsForPoly[0]?.[0],
    startLon: coordsForPoly[0]?.[1],
    points: downsamplePoints(enrichedPoints, 1800),
    laps: parsedLaps.length > 0 ? parsedLaps : undefined,
    extras,
  };
}

export function generateGpxString(title: string, points: ActivityPoint[], sport = 'hiking'): string {
  const safeTitle = title.replace(/[<>&]/g, '');
  const trkpts = points
    .filter((p) => typeof p.lat === 'number' && typeof p.lon === 'number')
    .map((p) => {
      const eleTag = typeof p.ele === 'number' ? `<ele>${p.ele.toFixed(1)}</ele>` : '';
      return `      <trkpt lat="${p.lat!.toFixed(6)}" lon="${p.lon!.toFixed(6)}">${eleTag}</trkpt>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Bilifit" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${safeTitle}</name>
  </metadata>
  <trk>
    <name>${safeTitle}</name>
    <type>${sport}</type>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}
