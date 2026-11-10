import FitParser from 'fit-file-parser';
import { computeSessionExtras, enrichPointsTelemetry } from '@/lib/analytics';
import { calculateNormalizedPower } from '@/lib/metrics';
import { resolveMyWhooshWorldForActivity } from '@/lib/mywhoosh-maps';
import { detectMyWhooshWorld, type ParsedActivityData } from '@/lib/parsers/gpx';
import { computeElevationGainLoss, downsamplePoints, encodePolyline } from '@/lib/polyline';
import type { ActivityExtras, ActivityLap, ActivityPoint, SportType } from '@/types';

function mapFitSport(
  sportRaw: string,
  subSportRaw: string,
  fileName: string,
  elevationGain: number,
  distanceMeters: number,
  coords: Array<[number, number]>,
  hasPower: boolean
): { sport: SportType; subSport?: string; worldName?: string } {
  const sport = sportRaw.toLowerCase();
  const sub = subSportRaw.toLowerCase();
  const fn = fileName.toLowerCase();
  const resolvedWorld = resolveMyWhooshWorldForActivity({
    worldName: detectMyWhooshWorld(fileName),
    title: fileName,
    coords,
  });
  const worldName = resolvedWorld?.world.name ?? detectMyWhooshWorld(fileName);

  if (
    sub.includes('virtual') ||
    sub.includes('indoor_cycling') ||
    sub.includes('spin') ||
    fn.includes('mywhoosh') ||
    fn.includes('whoosh') ||
    fn.includes('zwift') ||
    (resolvedWorld && (hasPower || sport.includes('cycling')))
  ) {
    return { sport: 'mywhoosh', subSport: 'MyWhoosh Indoor', worldName };
  }

  if (sport.includes('hiking') || sub.includes('trail') || sub.includes('mountain')) {
    return { sport: 'mountain', subSport: sub.includes('trail') ? 'Trail Running' : 'Montaña / Senderismo' };
  }

  if (sport.includes('walking') || sport === 'walk') {
    return { sport: 'mountain', subSport: 'Caminata' };
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
  const sessionAny = session as unknown as Record<string, unknown> | undefined;
  const records = parsed.records ?? [];
  const sportMsg = parsed.sports?.[0];
  const rawLaps = parsed.laps ?? [];

  // Detectar nombre del dispositivo / fabricante
  const mainDev = parsed.device_infos?.find((d) => (d.device_index ?? 0) === 0) ?? parsed.device_infos?.[0];
  const fileIdMeta = parsed.file_ids?.[0];
  const devManuf = mainDev?.manufacturer ? String(mainDev.manufacturer) : fileIdMeta?.manufacturer ? String(fileIdMeta.manufacturer) : '';
  const devProd = mainDev?.product_name ? String(mainDev.product_name) : fileIdMeta?.product_name ? String(fileIdMeta.product_name) : '';
  const deviceName = [devManuf, devProd].filter(Boolean).join(' ').trim() || undefined;

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
    const fracCad = typeof rec.fractional_cadence === 'number' ? rec.fractional_cadence : 0;
    const cad = typeof rec.cadence === 'number' ? rec.cadence + fracCad : undefined;
    const temp = typeof rec.temperature === 'number' ? rec.temperature : undefined;
    const grade = typeof rec.grade === 'number' ? rec.grade : undefined;
    const gct = typeof rec.stance_time === 'number' ? rec.stance_time : undefined;
    const vo = typeof rec.vertical_oscillation === 'number' ? rec.vertical_oscillation : undefined;
    const rawStride = typeof rec.step_length === 'number' ? rec.step_length : undefined;
    const stride = rawStride !== undefined ? (rawStride > 20 ? rawStride / 1000 : rawStride) : undefined;

    let lrBalance: number | undefined;
    if (rec.left_right_balance && typeof rec.left_right_balance === 'object') {
      const val = rec.left_right_balance.value;
      if (typeof val === 'number' && val > 0 && val < 100) {
        lrBalance = rec.left_right_balance.right ? Math.round((100 - val) * 10) / 10 : Math.round(val * 10) / 10;
      }
    }

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
      temp: temp !== undefined ? Math.round(temp * 10) / 10 : undefined,
      grade: grade !== undefined ? Math.round(grade * 10) / 10 : undefined,
      gct: gct !== undefined ? Math.round(gct) : undefined,
      vo: vo !== undefined ? Math.round(vo) : undefined,
      stride: stride !== undefined ? Math.round(stride * 100) / 100 : undefined,
      lrBalance,
    });
  }

  const eleStats = computeElevationGainLoss(points);
  const distanceMeters = Math.round(session?.total_distance ?? points[points.length - 1]?.dist ?? 0);
  const elevationGain = Math.round(session?.total_ascent ?? eleStats.gain);
  const elevationLoss = Math.round(session?.total_descent ?? eleStats.loss);
  const durationSec = Math.round(session?.total_elapsed_time ?? points[points.length - 1]?.t ?? 0);
  const movingTimeSec = Math.round(session?.total_timer_time ?? durationSec);

  const coordsForPoly: Array<[number, number]> = points
    .filter((p): p is ActivityPoint & { lat: number; lon: number } => typeof p.lat === 'number' && typeof p.lon === 'number')
    .map((p) => [p.lat, p.lon]);

  const sportRaw = String(session?.sport ?? sportMsg?.sport ?? 'running');
  const subSportRaw = String(session?.sub_sport ?? sportMsg?.sub_sport ?? '');
  const hasPower = wattsCount > 5 || (typeof session?.avg_power === 'number' && session.avg_power > 0);
  const mapped = mapFitSport(sportRaw, subSportRaw, fileName, elevationGain, distanceMeters, coordsForPoly, hasPower);

  const enrichedPoints = enrichPointsTelemetry(points, mapped.sport);

  // Construir Laps del FIT
  let lapCumDist = 0;
  const laps: ActivityLap[] = rawLaps
    .filter((l) => (l.total_elapsed_time ?? 0) > 0 || (l.total_distance ?? 0) > 0)
    .map((lap, idx) => {
      const dist = Math.round(lap.total_distance ?? 0);
      const startDistM = Math.round(lapCumDist);
      lapCumDist += dist;
      const dur = Math.round(lap.total_elapsed_time ?? lap.total_timer_time ?? 0);
      const mov = Math.round(lap.total_timer_time ?? dur);
      const rawLapCad = lap.avg_cadence;
      const lapCad =
        rawLapCad !== undefined && (mapped.sport === 'running' || mapped.sport === 'mountain') && rawLapCad < 115
          ? Math.round(rawLapCad * 2)
          : rawLapCad !== undefined
            ? Math.round(rawLapCad)
            : null;
      const lapSpeed = lap.enhanced_avg_speed ?? lap.avg_speed ?? (mov > 0 && dist > 0 ? dist / mov : null);
      const lapMaxSpeed = lap.enhanced_max_speed ?? lap.max_speed ?? null;

      return {
        lapNumber: idx + 1,
        name: `Vuelta ${idx + 1}`,
        startDistM,
        endDistM: Math.round(lapCumDist),
        distanceMeters: dist,
        durationSec: dur,
        movingTimeSec: mov,
        avgSpeedMs: lapSpeed !== null ? Math.round(lapSpeed * 100) / 100 : null,
        maxSpeedMs: lapMaxSpeed !== null ? Math.round(lapMaxSpeed * 100) / 100 : null,
        elevationGain: Math.round(lap.total_ascent ?? 0),
        elevationLoss: Math.round(lap.total_descent ?? 0),
        avgGradePct: typeof lap.avg_grade === 'number' ? Math.round(lap.avg_grade * 10) / 10 : null,
        avgHr: lap.avg_heart_rate ? Math.round(lap.avg_heart_rate) : null,
        maxHr: lap.max_heart_rate ? Math.round(lap.max_heart_rate) : null,
        avgWatts: lap.avg_power ? Math.round(lap.avg_power) : null,
        normalizedPower: lap.normalized_power ? Math.round(lap.normalized_power) : null,
        avgCadence: lapCad,
        calories: lap.total_calories ? Math.round(lap.total_calories) : null,
        trigger: lap.lap_trigger ? String(lap.lap_trigger) : null,
      };
    });

  const downsampledForPoly =
    coordsForPoly.length > 220
      ? coordsForPoly.filter((_, idx) => idx % Math.ceil(coordsForPoly.length / 220) === 0 || idx === coordsForPoly.length - 1)
      : coordsForPoly;

  const avgWatts = session?.avg_power ?? (wattsCount > 0 ? Math.round(wattsSum / wattsCount) : undefined);
  const normalizedPower =
    session?.normalized_power ?? (wattsCount > 10 ? calculateNormalizedPower(enrichedPoints) ?? undefined : undefined);

  const rawSessionCad = session?.avg_cadence ?? (cadCount > 0 ? Math.round(cadSum / cadCount) : undefined);
  const avgCadence =
    rawSessionCad !== undefined && (mapped.sport === 'running' || mapped.sport === 'mountain') && rawSessionCad < 115
      ? Math.round(rawSessionCad * 2)
      : rawSessionCad !== undefined
        ? Math.round(rawSessionCad)
        : undefined;

  const avgSpeedMs =
    session?.avg_speed ??
    (typeof sessionAny?.enhanced_avg_speed === 'number' ? sessionAny.enhanced_avg_speed : undefined) ??
    (movingTimeSec > 0 && distanceMeters > 0 ? Math.round((distanceMeters / movingTimeSec) * 100) / 100 : undefined);
  const maxSpeedFinal =
    session?.max_speed ??
    (typeof sessionAny?.enhanced_max_speed === 'number' ? sessionAny.enhanced_max_speed : undefined) ??
    (maxSpeedMs > 0 ? Math.round(maxSpeedMs * 100) / 100 : undefined);
  const avgHr = session?.avg_heart_rate ?? (hrCount > 0 ? Math.round(hrSum / hrCount) : undefined);

  const rawExtras: ActivityExtras = {
    deviceName,
    avgTemp: typeof session?.avg_temperature === 'number' ? Math.round(session.avg_temperature * 10) / 10 : null,
    minTemp: typeof session?.min_temperature === 'number' ? Math.round(session.min_temperature * 10) / 10 : null,
    maxTemp: typeof session?.max_temperature === 'number' ? Math.round(session.max_temperature * 10) / 10 : null,
    aerobicTe: typeof session?.total_training_effect === 'number' ? Math.round(session.total_training_effect * 10) / 10 : null,
    anaerobicTe:
      typeof session?.total_anaerobic_training_effect === 'number'
        ? Math.round(session.total_anaerobic_training_effect * 10) / 10
        : null,
    workKj: typeof session?.total_work === 'number' ? Math.round(session.total_work / 1000) : null,
    avgGctMs: typeof session?.avg_stance_time === 'number' ? Math.round(session.avg_stance_time) : null,
    avgVerticalOscMm: typeof session?.avg_vertical_oscillation === 'number' ? Math.round(session.avg_vertical_oscillation) : null,
    avgStrideLenM:
      typeof session?.avg_step_length === 'number'
        ? Math.round((session.avg_step_length > 20 ? session.avg_step_length / 1000 : session.avg_step_length) * 100) / 100
        : null,
  };

  const extras = computeSessionExtras(
    {
      sport: mapped.sport,
      durationSec,
      movingTimeSec,
      distanceMeters,
      elevationGain,
      avgSpeedMs: avgSpeedMs ?? null,
      avgHr: avgHr ?? null,
      avgWatts: avgWatts !== undefined ? Math.round(avgWatts) : null,
      normalizedPower: normalizedPower !== undefined ? Math.round(normalizedPower) : null,
      extras: rawExtras,
    },
    enrichedPoints
  );

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
    avgSpeedMs: avgSpeedMs !== undefined ? Math.round(avgSpeedMs * 100) / 100 : undefined,
    maxSpeedMs: maxSpeedFinal !== undefined ? Math.round(maxSpeedFinal * 100) / 100 : undefined,
    avgHr,
    maxHr: session?.max_heart_rate ?? (maxHr > 0 ? Math.round(maxHr) : undefined),
    avgWatts: avgWatts !== undefined ? Math.round(avgWatts) : undefined,
    normalizedPower: normalizedPower !== undefined ? Math.round(normalizedPower) : undefined,
    maxWatts: session?.max_power ?? (maxWatts > 0 ? Math.round(maxWatts) : undefined),
    avgCadence,
    calories: session?.total_calories !== undefined ? Math.round(session.total_calories) : undefined,
    worldName: mapped.worldName,
    polyline: downsampledForPoly.length > 1 ? encodePolyline(downsampledForPoly) : undefined,
    startLat: coordsForPoly[0]?.[0],
    startLon: coordsForPoly[0]?.[1],
    points: downsamplePoints(enrichedPoints, 1800),
    laps,
    extras,
  };
}
