import FitParser from 'fit-file-parser';
import { computeElevationGainLoss, downsamplePoints, encodePolyline } from '@/lib/polyline';
import { calculateNormalizedPower } from '@/lib/metrics';
import { detectMyWhooshWorld, type ParsedActivityData } from '@/lib/parsers/gpx';
import type { ActivityPoint, SportType } from '@/types';

function mapFitSport(
  sportRaw: string,
  subSportRaw: string,
  fileName: string,
  elevationGain: number,
  distanceMeters: number
): { sport: SportType; subSport?: string; worldName?: string } {
  const sport = sportRaw.toLowerCase();
  const sub = subSportRaw.toLowerCase();
  const fn = fileName.toLowerCase();
  const worldName = detectMyWhooshWorld(fileName);

  if (
    sub.includes('virtual') ||
    sub.includes('indoor_cycling') ||
    sub.includes('spin') ||
    fn.includes('mywhoosh') ||
    fn.includes('whoosh') ||
    fn.includes('zwift') ||
    Boolean(worldName)
  ) {
    return { sport: 'mywhoosh', subSport: 'MyWhoosh Indoor', worldName };
  }

  if (sport.includes('hiking') || sub.includes('trail') || sub.includes('mountain')) {
    return { sport: 'mountain', subSport: sub.includes('trail') ? 'Trail Running' : 'Montaña / Senderismo' };
  }

  if (sport.includes('running') || sport === 'run') {
    const km = distanceMeters / 1000;
    if (km >= 4 && elevationGain / km > 35 && elevationGain >= 300) {
      return { sport: 'mountain', subSport: 'Trail Running' };
    }
    return { sport: 'running', subSport: sub.includes('treadmill') ? 'Cinta' : 'Asfalto' };
  }

  if (sport.includes('cycling') || sport.includes('biking')) {
    return { sport: 'cycling', subSport: sub.includes('gravel') ? 'Gravel' : sub.includes('mountain') ? 'MTB' : 'Carretera' };
  }

  if (sport.includes('training') || sub.includes('strength')) {
    return { sport: 'strength', subSport: 'Fuerza' };
  }

  return { sport: 'running', subSport: sportRaw || 'Actividad FIT' };
}

export async function parseFitBuffer(buffer: Buffer, fileName = 'actividad.fit'): Promise<ParsedActivityData> {
  const fitParser = new FitParser({
    force: true,
    speedUnit: 'm/s',
    lengthUnit: 'm',
    temperatureUnit: 'celsius',
    elapsedRecordField: true,
    mode: 'list',
  });

  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  const parsed = await fitParser.parseAsync(arrayBuffer);

  const session = parsed.sessions?.[0];
  const records = parsed.records ?? [];
  const sportMsg = parsed.sports?.[0];

  const startDate = session?.start_time ?? records[0]?.timestamp ?? parsed.activity?.timestamp ?? new Date();
  const startMs = startDate instanceof Date ? startDate.getTime() : Date.parse(String(startDate));

  const points: ActivityPoint[] = [];
  let hrSum = 0;
  let hrCount = 0;
  let maxHr = 0;
  let wattsSum = 0;
  let wattsCount = 0;
  let maxWatts = 0;
  let cadSum = 0;
  let cadCount = 0;
  let maxSpeedMs = 0;

  for (const rec of records) {
    const recAny = rec as unknown as Record<string, unknown>;
    const rawLat = typeof rec.position_lat === 'number' ? rec.position_lat : undefined;
    const rawLon = typeof rec.position_long === 'number' ? rec.position_long : undefined;
    const lat = rawLat !== undefined && Math.abs(rawLat) <= 90 ? rawLat : undefined;
    const lon = rawLon !== undefined && Math.abs(rawLon) <= 180 ? rawLon : undefined;

    const eleRaw = typeof recAny.enhanced_altitude === 'number' ? recAny.enhanced_altitude : rec.altitude;
    const speedRaw = typeof recAny.enhanced_speed === 'number' ? recAny.enhanced_speed : rec.speed;

    const ts = rec.timestamp instanceof Date ? rec.timestamp.getTime() : NaN;
    const t =
      typeof recAny.elapsed_time === 'number'
        ? Math.round(recAny.elapsed_time)
        : Number.isFinite(ts) && Number.isFinite(startMs)
          ? Math.max(0, Math.round((ts - startMs) / 1000))
          : points.length;

    const hr = typeof rec.heart_rate === 'number' ? rec.heart_rate : undefined;
    const watts = typeof rec.power === 'number' ? rec.power : undefined;
    const cad = typeof rec.cadence === 'number' ? rec.cadence : undefined;

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
    if (typeof speedRaw === 'number' && speedRaw > maxSpeedMs && speedRaw < 35) {
      maxSpeedMs = speedRaw;
    }

    points.push({
      t,
      lat,
      lon,
      ele: typeof eleRaw === 'number' ? Math.round(eleRaw * 10) / 10 : undefined,
      hr: hr !== undefined ? Math.round(hr) : undefined,
      watts: watts !== undefined ? Math.round(watts) : undefined,
      cad: cad !== undefined ? Math.round(cad) : undefined,
      speed: typeof speedRaw === 'number' ? Math.round(speedRaw * 100) / 100 : undefined,
      dist: typeof rec.distance === 'number' ? Math.round(rec.distance) : undefined,
    });
  }

  const eleStats = computeElevationGainLoss(points);
  const distanceMeters = Math.round(
    session?.total_distance ?? points[points.length - 1]?.dist ?? 0
  );
  const elevationGain = Math.round(session?.total_ascent ?? eleStats.gain);
  const elevationLoss = Math.round(session?.total_descent ?? eleStats.loss);
  const durationSec = Math.round(session?.total_elapsed_time ?? points[points.length - 1]?.t ?? 0);
  const movingTimeSec = Math.round(session?.total_timer_time ?? durationSec);

  const sportRaw = String(session?.sport ?? sportMsg?.sport ?? 'running');
  const subSportRaw = String(session?.sub_sport ?? sportMsg?.sub_sport ?? '');
  const mapped = mapFitSport(sportRaw, subSportRaw, fileName, elevationGain, distanceMeters);

  const coordsForPoly: Array<[number, number]> = points
    .filter((p): p is ActivityPoint & { lat: number; lon: number } => typeof p.lat === 'number' && typeof p.lon === 'number')
    .map((p) => [p.lat, p.lon]);

  const downsampledForPoly =
    coordsForPoly.length > 200
      ? coordsForPoly.filter((_, idx) => idx % Math.ceil(coordsForPoly.length / 200) === 0 || idx === coordsForPoly.length - 1)
      : coordsForPoly;

  const avgWatts = session?.avg_power ?? (wattsCount > 0 ? Math.round(wattsSum / wattsCount) : undefined);
  const normalizedPower =
    session?.normalized_power ?? (wattsCount > 10 ? calculateNormalizedPower(points) ?? undefined : undefined);

  const cleanTitle = fileName.replace(/\.(fit|gz)$/gi, '').replace(/[_-]+/g, ' ').trim();

  return {
    source: 'fit',
    sport: mapped.sport,
    subSport: mapped.subSport,
    title: cleanTitle || `Sesión ${mapped.subSport ?? 'FIT'}`,
    startedAt: Number.isFinite(startMs) ? new Date(startMs).toISOString() : new Date().toISOString(),
    durationSec,
    movingTimeSec,
    distanceMeters,
    elevationGain,
    elevationLoss,
    avgSpeedMs: session?.avg_speed ?? (movingTimeSec > 0 && distanceMeters > 0 ? Math.round((distanceMeters / movingTimeSec) * 100) / 100 : undefined),
    maxSpeedMs: session?.max_speed ?? (maxSpeedMs > 0 ? Math.round(maxSpeedMs * 100) / 100 : undefined),
    avgHr: session?.avg_heart_rate ?? (hrCount > 0 ? Math.round(hrSum / hrCount) : undefined),
    maxHr: session?.max_heart_rate ?? (maxHr > 0 ? Math.round(maxHr) : undefined),
    avgWatts: avgWatts !== undefined ? Math.round(avgWatts) : undefined,
    normalizedPower: normalizedPower !== undefined ? Math.round(normalizedPower) : undefined,
    maxWatts: session?.max_power ?? (maxWatts > 0 ? Math.round(maxWatts) : undefined),
    avgCadence: session?.avg_cadence ?? (cadCount > 0 ? Math.round(cadSum / cadCount) : undefined),
    calories: session?.total_calories !== undefined ? Math.round(session.total_calories) : undefined,
    worldName: mapped.worldName,
    polyline: downsampledForPoly.length > 1 ? encodePolyline(downsampledForPoly) : undefined,
    startLat: coordsForPoly[0]?.[0],
    startLon: coordsForPoly[0]?.[1],
    points: downsamplePoints(points, 600),
  };
}
