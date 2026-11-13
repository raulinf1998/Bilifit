import FitParser from 'fit-file-parser';
import { hasConcreteActivityName, resolveActivityTitle } from '@/lib/activity-naming';
import { computeSessionExtras, enrichPointsTelemetry } from '@/lib/analytics';
import { calculateNormalizedPower } from '@/lib/metrics';
import { isMyWhooshContext, resolveMyWhooshWorldForActivity } from '@/lib/mywhoosh-maps';
import { detectMyWhooshWorld, type ParsedActivityData } from '@/lib/parsers/gpx';
import { computeElevationGainLoss, downsamplePoints, encodePolyline } from '@/lib/polyline';
import type { ActivityExtras, ActivityLap, ActivityPoint, SportType } from '@/types';

function computeMovingTimeFromPoints(points: ActivityPoint[], sport: SportType): number {
  if (points.length < 2) return 0;
  let moving = 0;
  const minSpeed = sport === 'walking' || sport === 'mountain' || sport === 'trail' ? 0.3 : 0.45;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const dt = cur.t - prev.t;
    if (dt <= 0) continue;
    const dDist = typeof cur.dist === 'number' && typeof prev.dist === 'number' ? Math.max(0, cur.dist - prev.dist) : null;
    const instSpeed =
      typeof cur.speed === 'number' && Number.isFinite(cur.speed)
        ? cur.speed
        : dDist !== null
          ? dDist / dt
          : null;
    const hasPowerOrCadence =
      (typeof cur.watts === 'number' && cur.watts > 10) ||
      ((sport === 'cycling' || sport === 'mywhoosh') && typeof cur.cad === 'number' && cur.cad > 15);

    if (dt > 20) {
      if (dDist !== null && dDist / dt >= minSpeed && dt <= 120) {
        moving += dt;
      } else if (hasPowerOrCadence && dt <= 60) {
        moving += dt;
      }
    } else if (hasPowerOrCadence || instSpeed === null || instSpeed >= minSpeed) {
      moving += dt;
    }
  }
  return Math.round(moving);
}

function shouldDoubleFitCadence(rawCad: number, sport: SportType): boolean {
  return (
    ((sport === 'running' || sport === 'trail' || sport === 'mountain') && rawCad < 115) ||
    (sport === 'walking' && rawCad < 80)
  );
}

function normalizeFitCadence(rawCad: unknown, sport: SportType): number | null {
  if (typeof rawCad !== 'number' || !Number.isFinite(rawCad) || rawCad <= 0) return null;
  return shouldDoubleFitCadence(rawCad, sport) ? Math.round(rawCad * 2) : Math.round(rawCad);
}

function resolveFitLapLabel(raw: Record<string, unknown>, idx: number, stepNames: Map<number, string>): string {
  const explicit = raw.name ?? raw.wkt_step_name ?? raw.segment_name;
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  const stepIdx = typeof raw.wkt_step_index === 'number' ? raw.wkt_step_index : undefined;
  if (stepIdx !== undefined && stepNames.has(stepIdx)) {
    return stepNames.get(stepIdx)!;
  }
  const intensity = typeof raw.intensity === 'string' ? raw.intensity.toLowerCase() : '';
  if (intensity === 'warmup') return 'Calentamiento';
  if (intensity === 'cooldown') return 'Enfriamiento';
  if (intensity === 'rest' || intensity === 'recovery') return 'Recuperación';
  const trigger = typeof raw.lap_trigger === 'string' ? raw.lap_trigger.toLowerCase() : '';
  if (trigger === 'manual') return `Segmento ${idx + 1}`;
  if (trigger === 'position_start' || trigger === 'position_lap' || trigger === 'position_marked') {
    return `Segmento ${idx + 1}`;
  }
  return `Vuelta ${idx + 1}`;
}

function translateSplitType(rawType: unknown, idx: number): string {
  const key = typeof rawType === 'string' ? rawType.toLowerCase() : '';
  if (key.includes('run')) return `Tramo corriendo ${idx + 1}`;
  if (key.includes('walk')) return `Tramo caminando ${idx + 1}`;
  if (key.includes('stand') || key.includes('idle')) return `Pausa ${idx + 1}`;
  if (key.includes('interval_active') || key === 'active') return `Intervalo ${idx + 1}`;
  if (key.includes('interval_rest') || key === 'rest' || key === 'recovery') return `Recuperación ${idx + 1}`;
  if (key.includes('warmup')) return 'Calentamiento';
  if (key.includes('cooldown')) return 'Enfriamiento';
  if (key.includes('ascent')) return `Subida ${idx + 1}`;
  if (key.includes('descent')) return `Bajada ${idx + 1}`;
  return `Segmento ${idx + 1}`;
}

function buildLapSliceFromPoints(
  slice: ActivityPoint[],
  lapNumber: number,
  name: string,
  trigger: string | null,
  sport: SportType
): ActivityLap | null {
  if (slice.length < 2) return null;
  const first = slice[0];
  const last = slice[slice.length - 1];
  const startDistM = Math.round(first.dist ?? 0);
  const endDistM = Math.round(last.dist ?? startDistM);
  const distanceMeters = Math.max(0, endDistM - startDistM);
  const durationSec = Math.max(1, Math.round(last.t - first.t));
  const mov = Math.min(durationSec, Math.max(1, computeMovingTimeFromPoints(slice, sport)));
  const ele = computeElevationGainLoss(slice, 1.8);
  const hrs = slice.map((p) => p.hr).filter((v): v is number => typeof v === 'number');
  const watts = slice.map((p) => p.watts).filter((v): v is number => typeof v === 'number');
  const cads = slice.map((p) => p.cad).filter((v): v is number => typeof v === 'number' && v > 0);
  const speeds = slice.map((p) => p.speed).filter((v): v is number => typeof v === 'number' && v > 0 && v < 40);

  return {
    lapNumber,
    name,
    startDistM,
    endDistM,
    distanceMeters,
    durationSec,
    movingTimeSec: mov,
    avgSpeedMs: distanceMeters > 0 && mov > 0 ? Math.round((distanceMeters / mov) * 100) / 100 : null,
    maxSpeedMs: speeds.length > 0 ? Math.round(Math.max(...speeds) * 100) / 100 : null,
    elevationGain: ele.gain,
    elevationLoss: ele.loss,
    avgGradePct:
      distanceMeters >= 20 && typeof first.ele === 'number' && typeof last.ele === 'number'
        ? Math.round(((last.ele - first.ele) / distanceMeters) * 1000) / 10
        : null,
    avgHr: hrs.length > 0 ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
    maxHr: hrs.length > 0 ? Math.max(...hrs) : null,
    avgWatts: watts.length > 0 ? Math.round(watts.reduce((a, b) => a + b, 0) / watts.length) : null,
    normalizedPower: watts.length > 10 ? calculateNormalizedPower(slice) : null,
    avgCadence: cads.length > 0 ? Math.round(cads.reduce((a, b) => a + b, 0) / cads.length) : null,
    calories: null,
    trigger,
  };
}

function mapRawFitLapList(
  rawList: Array<Record<string, unknown>>,
  points: ActivityPoint[],
  startMs: number,
  sport: SportType,
  stepNames: Map<number, string>,
  forceSegmentTrigger = false
): ActivityLap[] {
  let lapCumDist = 0;
  return rawList
    .filter((l) => (Number(l.total_elapsed_time) || 0) > 0 || (Number(l.total_distance) || 0) > 0)
    .map((lap, idx) => {
      const dist = Math.round(Number(lap.total_distance ?? 0));
      const lapStartRaw = lap.start_time;
      const lapStartMs =
        lapStartRaw instanceof Date ? lapStartRaw.getTime() : lapStartRaw ? Date.parse(String(lapStartRaw)) : NaN;
      let startDistM = Math.round(lapCumDist);
      if (forceSegmentTrigger && Number.isFinite(lapStartMs) && Number.isFinite(startMs) && points.length > 0) {
        const relT = Math.max(0, Math.round((lapStartMs - startMs) / 1000));
        const matchPt = points.find((p) => p.t >= relT && typeof p.dist === 'number');
        if (matchPt && typeof matchPt.dist === 'number') {
          startDistM = Math.round(matchPt.dist);
        }
      }
      const endDistM = Math.round(startDistM + dist);
      lapCumDist = endDistM;

      const dur = Math.round(Number(lap.total_elapsed_time ?? lap.total_timer_time ?? 0));
      const mov = Math.round(Number(lap.total_moving_time ?? lap.total_timer_time ?? dur));
      const lapCad = normalizeFitCadence(lap.avg_cadence, sport);
      const rawAvgSpd =
        typeof lap.enhanced_avg_speed === 'number'
          ? lap.enhanced_avg_speed
          : typeof lap.avg_speed === 'number'
            ? lap.avg_speed
            : mov > 0 && dist > 0
              ? dist / mov
              : null;
      const rawMaxSpd =
        typeof lap.enhanced_max_speed === 'number'
          ? lap.enhanced_max_speed
          : typeof lap.max_speed === 'number'
            ? lap.max_speed
            : null;

      let eleGain = Math.round(Number(lap.total_ascent ?? 0));
      let eleLoss = Math.round(Number(lap.total_descent ?? 0));
      let slice: ActivityPoint[] = [];
      if (points.length >= 2) {
        if (Number.isFinite(lapStartMs) && Number.isFinite(startMs) && dur > 0) {
          const relStart = Math.max(0, Math.round((lapStartMs - startMs) / 1000));
          const relEnd = relStart + dur;
          slice = points.filter((p) => p.t >= relStart - 1 && p.t <= relEnd + 1);
        }
        if (slice.length < 2 && endDistM > startDistM) {
          slice = points.filter((p) => (p.dist ?? -1) >= startDistM && (p.dist ?? -1) <= endDistM);
          if (slice.length < 2) {
            const firstIdx = Math.max(
              0,
              points.findIndex((p) => (p.dist ?? 0) >= startDistM) - (startDistM > 0 ? 1 : 0)
            );
            let lastIdx = points.findIndex((p) => (p.dist ?? 0) >= endDistM);
            if (lastIdx < 0) lastIdx = points.length - 1;
            if (lastIdx > firstIdx) slice = points.slice(firstIdx, lastIdx + 1);
          }
        }
      }
      if (eleGain === 0 && eleLoss === 0 && slice.length >= 2) {
        const ele = computeElevationGainLoss(slice, 1.8);
        eleGain = ele.gain;
        eleLoss = ele.loss;
      }

      const trigger = forceSegmentTrigger
        ? 'segment'
        : lap.lap_trigger
          ? String(lap.lap_trigger)
          : null;

      return {
        lapNumber: idx + 1,
        name: forceSegmentTrigger
          ? (typeof lap.name === 'string' && lap.name.trim() ? lap.name.trim() : `Segmento ${idx + 1}`)
          : resolveFitLapLabel(lap, idx, stepNames),
        startDistM,
        endDistM,
        distanceMeters: dist,
        durationSec: dur,
        movingTimeSec: mov,
        avgSpeedMs: rawAvgSpd !== null ? Math.round(rawAvgSpd * 100) / 100 : null,
        maxSpeedMs: rawMaxSpd !== null ? Math.round(rawMaxSpd * 100) / 100 : null,
        elevationGain: eleGain,
        elevationLoss: eleLoss,
        avgGradePct: typeof lap.avg_grade === 'number' ? Math.round(lap.avg_grade * 10) / 10 : null,
        avgHr: typeof lap.avg_heart_rate === 'number' && lap.avg_heart_rate > 0 ? Math.round(lap.avg_heart_rate) : null,
        maxHr: typeof lap.max_heart_rate === 'number' && lap.max_heart_rate > 0 ? Math.round(lap.max_heart_rate) : null,
        avgWatts: typeof lap.avg_power === 'number' && lap.avg_power > 0 ? Math.round(lap.avg_power) : null,
        normalizedPower:
          typeof lap.normalized_power === 'number' && lap.normalized_power > 0
            ? Math.round(lap.normalized_power)
            : null,
        avgCadence: lapCad,
        calories: typeof lap.total_calories === 'number' && lap.total_calories > 0 ? Math.round(lap.total_calories) : null,
        trigger,
      };
    });
}

function extractFitLapsAndSegments(
  parsed: unknown,
  enrichedPoints: ActivityPoint[],
  startMs: number,
  durationSec: number,
  sport: SportType
): ActivityLap[] {
  const p = parsed as Record<string, unknown>;
  const messages = (p.messages ?? {}) as Record<string, unknown[]>;

  const stepNames = new Map<number, string>();
  const rawSteps = Array.isArray(messages.workout_step) ? messages.workout_step : [];
  for (let i = 0; i < rawSteps.length; i++) {
    const step = rawSteps[i] as Record<string, unknown>;
    const idx = typeof step?.message_index === 'number' ? step.message_index : i;
    const label = step?.wkt_step_name;
    if (typeof label === 'string' && label.trim()) {
      stepNames.set(idx, label.trim());
    }
  }

  const rawSegmentLaps = (
    Array.isArray(messages.segment_lap) ? messages.segment_lap : []
  ) as Array<Record<string, unknown>>;
  const segmentLaps = mapRawFitLapList(rawSegmentLaps, enrichedPoints, startMs, sport, stepNames, true);

  const rawLaps = (
    Array.isArray(p.laps) ? p.laps : Array.isArray(messages.lap) ? messages.lap : []
  ) as Array<Record<string, unknown>>;
  const mappedLaps = mapRawFitLapList(rawLaps, enrichedPoints, startMs, sport, stepNames, false);

  if (segmentLaps.length > 0 && mappedLaps.length <= 1) {
    return segmentLaps;
  }
  if (segmentLaps.length > 0 && mappedLaps.length > 1) {
    return [...segmentLaps, ...mappedLaps].map((lap, idx) => ({ ...lap, lapNumber: idx + 1 }));
  }
  if (mappedLaps.length > 1) {
    return mappedLaps;
  }

  // Intentar splits de FIT (ej. Huawei/Garmin multisport, intervalos, subir/bajar)
  const rawSplits = (
    Array.isArray(p.splits) ? p.splits : Array.isArray(messages.split) ? messages.split : []
  ) as Array<Record<string, unknown>>;
  if (rawSplits.length > 1) {
    let cumDist = 0;
    const mappedSplits: ActivityLap[] = [];
    for (let i = 0; i < rawSplits.length; i++) {
      const sp = rawSplits[i];
      const dur = Math.round(Number(sp.total_elapsed_time ?? sp.total_timer_time ?? 0));
      const mov = Math.round(Number(sp.total_moving_time ?? sp.total_timer_time ?? dur));
      const dist = Math.round(Number(sp.total_distance ?? 0));
      if (dur <= 0 && dist <= 0) continue;
      const splitStartRaw = sp.start_time;
      const splitStartMs =
        splitStartRaw instanceof Date ? splitStartRaw.getTime() : splitStartRaw ? Date.parse(String(splitStartRaw)) : NaN;
      let startDistM = Math.round(cumDist);
      if (Number.isFinite(splitStartMs) && Number.isFinite(startMs) && enrichedPoints.length > 0) {
        const relT = Math.max(0, Math.round((splitStartMs - startMs) / 1000));
        const matchPt = enrichedPoints.find((pt) => pt.t >= relT && typeof pt.dist === 'number');
        if (matchPt && typeof matchPt.dist === 'number') {
          startDistM = Math.round(matchPt.dist);
        }
      }
      const endDistM = Math.round(startDistM + dist);
      cumDist = endDistM;
      const slice = enrichedPoints.filter((pt) => (pt.dist ?? -1) >= startDistM && (pt.dist ?? -1) <= endDistM);
      const ele = slice.length >= 2 ? computeElevationGainLoss(slice, 1.8) : { gain: 0, loss: 0 };
      mappedSplits.push({
        lapNumber: mappedSplits.length + 1,
        name: translateSplitType(sp.split_type, mappedSplits.length),
        startDistM,
        endDistM,
        distanceMeters: dist,
        durationSec: dur,
        movingTimeSec: mov,
        avgSpeedMs:
          typeof sp.avg_speed === 'number'
            ? Math.round(sp.avg_speed * 100) / 100
            : dist > 0 && mov > 0
              ? Math.round((dist / mov) * 100) / 100
              : null,
        maxSpeedMs: typeof sp.max_speed === 'number' ? Math.round(sp.max_speed * 100) / 100 : null,
        elevationGain: Math.round(Number(sp.total_ascent ?? ele.gain)),
        elevationLoss: Math.round(Number(sp.total_descent ?? ele.loss)),
        avgHr: null,
        maxHr: null,
        avgWatts: null,
        normalizedPower: null,
        avgCadence: null,
        calories: typeof sp.total_calories === 'number' && sp.total_calories > 0 ? Math.round(sp.total_calories) : null,
        trigger: 'split',
      });
    }
    if (mappedSplits.length > 1) return mappedSplits;
  }

  // Intentar marcadores de eventos FIT (user_marker / lap) o course_points (segment_start)
  if (enrichedPoints.length >= 2 && Number.isFinite(startMs) && durationSec > 10) {
    const rawEvents = (
      Array.isArray(p.events) ? p.events : Array.isArray(messages.event) ? messages.event : []
    ) as Array<Record<string, unknown>>;
    const boundaryTimes: number[] = [];
    for (const ev of rawEvents) {
      const evName = typeof ev.event === 'string' ? ev.event.toLowerCase() : '';
      if (evName === 'lap' || evName === 'user_marker' || evName === 'marker') {
        const evTs = ev.timestamp instanceof Date ? ev.timestamp.getTime() : ev.timestamp ? Date.parse(String(ev.timestamp)) : NaN;
        if (Number.isFinite(evTs)) {
          const relT = Math.round((evTs - startMs) / 1000);
          if (relT > 3 && relT < durationSec - 3) {
            boundaryTimes.push(relT);
          }
        }
      }
    }

    const rawCoursePoints = (
      Array.isArray(messages.course_point) ? messages.course_point : []
    ) as Array<Record<string, unknown>>;
    for (const cp of rawCoursePoints) {
      const cpType = typeof cp.type === 'string' ? cp.type.toLowerCase() : '';
      if (cpType.includes('segment')) {
        const cpTs = cp.timestamp instanceof Date ? cp.timestamp.getTime() : cp.timestamp ? Date.parse(String(cp.timestamp)) : NaN;
        if (Number.isFinite(cpTs)) {
          const relT = Math.round((cpTs - startMs) / 1000);
          if (relT > 3 && relT < durationSec - 3) {
            boundaryTimes.push(relT);
          }
        }
      }
    }

    const uniqueTimes = [...new Set(boundaryTimes)].sort((a, b) => a - b);
    if (uniqueTimes.length > 0) {
      const bounds = [0, ...uniqueTimes, durationSec];
      const eventLaps: ActivityLap[] = [];
      for (let i = 0; i < bounds.length - 1; i++) {
        const slice = enrichedPoints.filter((pt) => pt.t >= bounds[i] && pt.t <= bounds[i + 1]);
        const lap = buildLapSliceFromPoints(slice, eventLaps.length + 1, `Segmento ${eventLaps.length + 1}`, 'manual', sport);
        if (lap) eventLaps.push(lap);
      }
      if (eventLaps.length > 1) return eventLaps;
    }
  }

  return mappedLaps;
}

function mapFitSport(
  sportRaw: string,
  subSportRaw: string,
  fileName: string,
  elevationGain: number,
  distanceMeters: number,
  coords: Array<[number, number]>,
  hasPower: boolean,
  deviceName?: string
): { sport: SportType; subSport?: string; worldName?: string } {
  const sport = sportRaw.toLowerCase();
  const sub = subSportRaw.toLowerCase();
  const fn = fileName.toLowerCase();
  const devLower = (deviceName ?? '').toLowerCase();
  const hasVirtualHint =
    sub.includes('virtual') ||
    sub.includes('indoor_cycling') ||
    sub.includes('spin') ||
    fn.includes('mywhoosh') ||
    fn.includes('whoosh') ||
    fn.includes('zwift') ||
    devLower.includes('mywhoosh') ||
    devLower.includes('zwift') ||
    isMyWhooshContext({ title: fileName, subSport: subSportRaw, deviceName });

  const resolvedWorld = resolveMyWhooshWorldForActivity({
    worldName: hasVirtualHint ? detectMyWhooshWorld(fileName) : undefined,
    title: fileName,
    sport: sport.includes('cycling') || sport.includes('biking') ? 'cycling' : undefined,
    subSport: subSportRaw,
    deviceName,
    coords,
  });

  if (hasVirtualHint || (resolvedWorld && (hasPower || sport.includes('cycling')))) {
    return {
      sport: 'mywhoosh',
      subSport: 'MyWhoosh Indoor',
      worldName: resolvedWorld?.world.name,
    };
  }

  if (sub.includes('trail') || fn.includes('trail')) {
    return { sport: 'trail', subSport: 'Trail Running' };
  }

  if (sport.includes('hiking') || sub.includes('mountain') || sport.includes('mountaineering')) {
    return { sport: 'mountain', subSport: 'Senderismo' };
  }

  if (sport.includes('walking') || sport === 'walk') {
    return { sport: 'walking', subSport: 'Caminar' };
  }

  if (sport.includes('running') || sport === 'run') {
    const km = distanceMeters / 1000;
    if (km >= 4 && elevationGain / km > 35 && elevationGain >= 300) {
      return { sport: 'trail', subSport: 'Trail Running' };
    }
    return { sport: 'running', subSport: sub.includes('treadmill') ? 'Cinta' : 'Correr' };
  }

  if (sport.includes('cycling') || sport.includes('biking')) {
    return { sport: 'cycling', subSport: sub.includes('gravel') ? 'Gravel' : sub.includes('mountain') ? 'MTB' : 'Carretera' };
  }

  if (sport.includes('training') || sub.includes('strength')) {
    return { sport: 'strength', subSport: 'Fuerza' };
  }

  if (fn.includes('walking') || fn.includes('caminar') || fn.includes('caminata')) {
    return { sport: 'walking', subSport: 'Caminar' };
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
  const parsedAny = parsed as unknown as Record<string, unknown>;
  const messagesAny = (parsedAny.messages ?? {}) as Record<string, unknown[]>;
  const records = parsed.records ?? [];
  const sportMsg = parsed.sports?.[0];

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
  const rawMovingTime = Math.round(
    (typeof sessionAny?.total_moving_time === 'number' && sessionAny.total_moving_time > 0
      ? sessionAny.total_moving_time
      : session?.total_timer_time) ?? durationSec
  );

  const coordsForPoly: Array<[number, number]> = points
    .filter((p): p is ActivityPoint & { lat: number; lon: number } => typeof p.lat === 'number' && typeof p.lon === 'number')
    .map((p) => [p.lat, p.lon]);

  const sportRaw = String(session?.sport ?? sportMsg?.sport ?? 'running');
  const subSportRaw = String(session?.sub_sport ?? sportMsg?.sub_sport ?? '');
  const hasPower = wattsCount > 5 || (typeof session?.avg_power === 'number' && session.avg_power > 0);
  const mapped = mapFitSport(sportRaw, subSportRaw, fileName, elevationGain, distanceMeters, coordsForPoly, hasPower, deviceName);

  const pointsMoving = computeMovingTimeFromPoints(points, mapped.sport);
  const movingTimeSec =
    rawMovingTime >= durationSec - 2 && pointsMoving > 0 && pointsMoving < durationSec - 15
      ? pointsMoving
      : Math.min(durationSec > 0 ? durationSec : rawMovingTime, rawMovingTime);

  const enrichedPoints = enrichPointsTelemetry(points, mapped.sport);

  // Construir Laps / Segmentos del FIT (segment_lap, lap, split, events)
  const laps: ActivityLap[] = extractFitLapsAndSegments(
    parsed,
    enrichedPoints,
    startMs,
    durationSec,
    mapped.sport
  );

  const downsampledForPoly =
    coordsForPoly.length > 220
      ? coordsForPoly.filter((_, idx) => idx % Math.ceil(coordsForPoly.length / 220) === 0 || idx === coordsForPoly.length - 1)
      : coordsForPoly;

  const avgWatts = session?.avg_power ?? (wattsCount > 0 ? Math.round(wattsSum / wattsCount) : undefined);
  const normalizedPower =
    session?.normalized_power ?? (wattsCount > 10 ? calculateNormalizedPower(enrichedPoints) ?? undefined : undefined);

  const rawSessionCad = session?.avg_cadence ?? (cadCount > 0 ? Math.round(cadSum / cadCount) : undefined);
  const shouldDoubleSessionCad =
    rawSessionCad !== undefined &&
    (((mapped.sport === 'running' || mapped.sport === 'trail' || mapped.sport === 'mountain') &&
      rawSessionCad < 115) ||
      (mapped.sport === 'walking' && rawSessionCad < 80));
  const avgCadence =
    rawSessionCad !== undefined
      ? shouldDoubleSessionCad
        ? Math.round(rawSessionCad * 2)
        : Math.round(rawSessionCad)
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

  const startedAtIso = Number.isFinite(startMs) ? new Date(startMs).toISOString() : new Date().toISOString();
  const workoutMsg = Array.isArray(messagesAny.workout) ? (messagesAny.workout[0] as Record<string, unknown> | undefined) : undefined;
  const embeddedTitle =
    (typeof workoutMsg?.wkt_name === 'string' && workoutMsg.wkt_name) ||
    (typeof sportMsg?.name === 'string' && sportMsg.name) ||
    null;
  const cleanFileName = fileName.replace(/\.(fit|gz)$/gi, '').replace(/[_-]+/g, ' ').trim();
  const candidateTitle = hasConcreteActivityName(embeddedTitle)
    ? embeddedTitle
    : hasConcreteActivityName(cleanFileName)
      ? cleanFileName
      : null;

  return {
    source: 'fit',
    sport: mapped.sport,
    subSport: mapped.subSport,
    title: resolveActivityTitle(candidateTitle, mapped.sport, startedAtIso),
    startedAt: startedAtIso,
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
