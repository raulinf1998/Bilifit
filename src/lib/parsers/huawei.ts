import { resolveActivityTitle, hasConcreteActivityName } from '@/lib/activity-naming';
import { computeSessionExtras, enrichPointsTelemetry } from '@/lib/analytics';
import { isMyWhooshContext, resolveMyWhooshWorldForActivity } from '@/lib/mywhoosh-maps';
import { computeElevationGainLoss, downsamplePoints, encodePolyline, haversineMeters } from '@/lib/polyline';
import type { ParsedActivityData } from '@/lib/parsers/gpx';
import type { ActivityExtras, ActivityLap, ActivityPoint, SportType } from '@/types';

export interface HealthSyncCsvMetadata {
  originApp: string | null;
  activityType: string | null;
  activityName: string | null;
  dateTimeRaw: string | null;
  elapsedSec: number | null;
  activeSec: number | null;
  distanceMeters: number | null;
  calories: number | null;
  steps: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgSpeedMs: number | null;
  maxSpeedMs: number | null;
}

export interface HealthSyncFileIdentity {
  bundleKey: string;
  ext: string;
  kind: 'fit' | 'tcx' | 'gpx' | 'kml' | 'csv' | 'other';
  sportHint: string;
  dateTimeKey: string;
}

const HUAWEI_SPORT_MAP: Record<number, { sport: SportType; subSport: string; fallbackTitle: string }> = {
  2: { sport: 'mountain', subSport: 'Senderismo', fallbackTitle: 'Ruta de Montaña' },
  3: { sport: 'cycling', subSport: 'Ciclismo', fallbackTitle: 'Salida en Bici' },
  4: { sport: 'running', subSport: 'Correr', fallbackTitle: 'Carrera' },
  5: { sport: 'walking', subSport: 'Caminar', fallbackTitle: 'Caminata' },
  101: { sport: 'running', subSport: 'Cinta / Interior', fallbackTitle: 'Carrera en Cinta' },
  102: { sport: 'running', subSport: 'Natación Piscina', fallbackTitle: 'Natación en Piscina' },
  103: { sport: 'cycling', subSport: 'Bici Indoor', fallbackTitle: 'Bici Indoor' },
  104: { sport: 'running', subSport: 'Aguas Abiertas', fallbackTitle: 'Natación Aguas Abiertas' },
  111: { sport: 'strength', subSport: 'Elíptica / Cardio', fallbackTitle: 'Elíptica' },
  117: { sport: 'strength', subSport: 'Entrenamiento', fallbackTitle: 'Sesión Huawei' },
  118: { sport: 'trail', subSport: 'Trail Running', fallbackTitle: 'Trail Running' },
  145: { sport: 'strength', subSport: 'Fuerza / CrossFit', fallbackTitle: 'Fuerza / CrossFit' },
  282: { sport: 'mountain', subSport: 'Senderismo', fallbackTitle: 'Senderismo' },
};

export function isHiTrackBuffer(text: string): boolean {
  const sample = text.replace(/^\uFEFF/, '').trimStart().slice(0, 2000);
  if (sample.startsWith('{') || sample.startsWith('[')) return false;
  return sample.includes('tp=lbs;') || sample.includes('tp=h-r;') || sample.includes('tp=s-r;');
}

export function isHuaweiMotionPathJson(text: string): boolean {
  const clean = text.replace(/^\uFEFF/, '').trimStart();
  if (!clean.startsWith('[') && !clean.startsWith('{')) return false;
  return clean.includes('HW_EXT_TRACK_') || clean.includes('motionPathData') || (clean.includes('sportType') && clean.includes('startTime'));
}

function convertHiTrackTimestampMs(raw: number, refStartMs?: number, isRelativeSpeed = false): number | null {
  if (!Number.isFinite(raw) || raw < 0) return null;

  if (isRelativeSpeed) {
    if (!refStartMs) return null;
    return refStartMs + Math.round((raw + 5) * 1000);
  }

  // Segundos relativos desde medianoche o inicio del entreno
  if (raw < 604_800) {
    if (!refStartMs) return null;
    const d = new Date(refStartMs);
    const midnightUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return midnightUtc + Math.round(raw * 1000);
  }

  const digits = Math.floor(Math.log10(raw));
  if (digits === 9) return Math.round(raw * 1000);
  if (digits === 12) return Math.round(raw);
  const divisor = digits > 9 ? 10 ** (digits - 9) : 0.1 ** (9 - digits);
  return Math.round((raw / divisor) * 1000);
}

const SEGMENT_HI_TYPES = new Set([
  'seg',
  'segment',
  'lap',
  'split',
  'mark',
  'int',
  'interval',
  'section',
  'stage',
  'p-m',
]);

interface RawHuaweiSegmentSpec {
  name?: string;
  startMs?: number;
  endMs?: number;
  startDistM?: number;
  endDistM?: number;
  distanceMeters?: number;
  durationSec?: number;
  movingTimeSec?: number;
  avgSpeedMs?: number;
  maxSpeedMs?: number;
  elevationGain?: number;
  elevationLoss?: number;
  avgHr?: number;
  maxHr?: number;
  avgCadence?: number;
  calories?: number;
  trigger?: string;
}

function normalizeDurationMaybeMs(raw: unknown, referenceDurationSec?: number): number | undefined {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  if (n > 86_400 || (referenceDurationSec && referenceDurationSec > 0 && n > referenceDurationSec * 15)) {
    return Math.round(n / 1000);
  }
  return Math.round(n);
}

function buildLapFromPointSlice(
  slice: ActivityPoint[],
  lapNumber: number,
  overrides: Partial<ActivityLap> = {}
): ActivityLap | null {
  if (slice.length === 0) return null;
  const first = slice[0];
  const last = slice[slice.length - 1];
  const startDistM = overrides.startDistM ?? Math.round(first.dist ?? 0);
  const endDistM = overrides.endDistM ?? Math.round(last.dist ?? startDistM);
  const distanceMeters = overrides.distanceMeters ?? Math.max(0, Math.round(endDistM - startDistM));
  const durationSec = overrides.durationSec ?? Math.max(1, Math.round(last.t - first.t));
  let mov = 0;
  for (let i = 1; i < slice.length; i++) {
    const dt = slice[i].t - slice[i - 1].t;
    const spd = slice[i].speed ?? 0;
    if (dt > 0 && dt <= 60 && spd > 0.25) mov += dt;
  }
  const movingTimeSec = overrides.movingTimeSec ?? (mov > 0 ? Math.min(durationSec, Math.round(mov)) : durationSec);
  const ele = computeElevationGainLoss(slice, 1.8);
  const hrs = slice.map((p) => p.hr).filter((v): v is number => typeof v === 'number');
  const cads = slice.map((p) => p.cad).filter((v): v is number => typeof v === 'number' && v > 0);
  const speeds = slice.map((p) => p.speed).filter((v): v is number => typeof v === 'number' && v > 0 && v < 35);

  const avgSpeedMs =
    overrides.avgSpeedMs ??
    (distanceMeters > 0 && movingTimeSec > 0 ? Math.round((distanceMeters / movingTimeSec) * 100) / 100 : null);

  return {
    lapNumber,
    name: overrides.name ?? `Segmento ${lapNumber}`,
    startDistM,
    endDistM,
    distanceMeters,
    durationSec,
    movingTimeSec,
    avgSpeedMs,
    maxSpeedMs:
      overrides.maxSpeedMs ??
      (speeds.length > 0 ? Math.round(Math.max(...speeds) * 100) / 100 : null),
    elevationGain: overrides.elevationGain ?? ele.gain,
    elevationLoss: overrides.elevationLoss ?? ele.loss,
    avgGradePct:
      distanceMeters >= 20
        ? Math.round((((last.ele ?? 0) - (first.ele ?? 0)) / distanceMeters) * 1000) / 10
        : null,
    avgHr:
      overrides.avgHr ??
      (hrs.length > 0 ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null),
    maxHr: overrides.maxHr ?? (hrs.length > 0 ? Math.max(...hrs) : null),
    avgWatts: overrides.avgWatts ?? null,
    normalizedPower: overrides.normalizedPower ?? null,
    avgCadence:
      overrides.avgCadence ??
      (cads.length > 0 ? Math.round(cads.reduce((a, b) => a + b, 0) / cads.length) : null),
    calories: overrides.calories ?? null,
    trigger: overrides.trigger ?? 'segment',
  };
}

function buildLapsFromHuaweiSpecs(
  specs: RawHuaweiSegmentSpec[],
  boundaryMarks: Array<{ tsMs: number; name?: string; trigger?: string }>,
  points: ActivityPoint[],
  startMs: number,
  durationSec: number,
  totalDistanceM: number
): ActivityLap[] {
  const out: ActivityLap[] = [];

  if (specs.length > 0) {
    let cursorDist = 0;
    let cursorT = 0;
    for (let i = 0; i < specs.length; i++) {
      const sp = specs[i];
      const idx = out.length + 1;
      const startT =
        typeof sp.startMs === 'number' && Number.isFinite(sp.startMs)
          ? Math.max(0, Math.round((sp.startMs - startMs) / 1000))
          : cursorT;
      const endT =
        typeof sp.endMs === 'number' && Number.isFinite(sp.endMs)
          ? Math.max(startT, Math.round((sp.endMs - startMs) / 1000))
          : typeof sp.durationSec === 'number' && sp.durationSec > 0
            ? startT + sp.durationSec
            : startT;

      let slice: ActivityPoint[] = [];
      if (typeof sp.startDistM === 'number' && typeof sp.endDistM === 'number' && sp.endDistM > sp.startDistM) {
        slice = points.filter((p) => (p.dist ?? -1) >= sp.startDistM! && (p.dist ?? -1) <= sp.endDistM!);
      } else if (endT > startT) {
        slice = points.filter((p) => p.t >= startT && p.t <= endT);
      } else if (typeof sp.distanceMeters === 'number' && sp.distanceMeters > 0) {
        const sD = cursorDist;
        const eD = cursorDist + sp.distanceMeters;
        slice = points.filter((p) => (p.dist ?? -1) >= sD && (p.dist ?? -1) <= eD);
      }

      const distM =
        sp.distanceMeters ??
        (typeof sp.endDistM === 'number' && typeof sp.startDistM === 'number'
          ? Math.max(0, Math.round(sp.endDistM - sp.startDistM))
          : slice.length >= 2
            ? Math.max(0, Math.round((slice[slice.length - 1].dist ?? 0) - (slice[0].dist ?? 0)))
            : 0);
      const startDistM = sp.startDistM ?? (slice.length > 0 ? Math.round(slice[0].dist ?? cursorDist) : Math.round(cursorDist));
      const endDistM = sp.endDistM ?? Math.round(startDistM + distM);
      const dur = sp.durationSec ?? (endT > startT ? endT - startT : 0);

      cursorDist = Math.max(cursorDist, endDistM);
      cursorT = Math.max(cursorT, endT);

      if (dur <= 0 && distM <= 0) continue;

      if (slice.length >= 2) {
        const lap = buildLapFromPointSlice(slice, idx, {
          name: sp.name || `Segmento ${idx}`,
          startDistM,
          endDistM,
          distanceMeters: distM > 0 ? distM : undefined,
          durationSec: dur > 0 ? dur : undefined,
          movingTimeSec: sp.movingTimeSec,
          avgSpeedMs: sp.avgSpeedMs,
          maxSpeedMs: sp.maxSpeedMs,
          elevationGain: sp.elevationGain,
          elevationLoss: sp.elevationLoss,
          avgHr: sp.avgHr,
          maxHr: sp.maxHr,
          avgCadence: sp.avgCadence,
          calories: sp.calories,
          trigger: sp.trigger ?? 'segment',
        });
        if (lap) out.push(lap);
      } else {
        const mov = sp.movingTimeSec ?? dur;
        out.push({
          lapNumber: idx,
          name: sp.name || `Segmento ${idx}`,
          startDistM,
          endDistM,
          distanceMeters: distM,
          durationSec: dur,
          movingTimeSec: mov,
          avgSpeedMs:
            sp.avgSpeedMs ??
            (distM > 0 && mov > 0 ? Math.round((distM / mov) * 100) / 100 : null),
          maxSpeedMs: sp.maxSpeedMs ?? null,
          elevationGain: sp.elevationGain ?? 0,
          elevationLoss: sp.elevationLoss ?? 0,
          avgHr: sp.avgHr ?? null,
          maxHr: sp.maxHr ?? null,
          avgWatts: null,
          normalizedPower: null,
          avgCadence: sp.avgCadence ?? null,
          calories: sp.calories ?? null,
          trigger: sp.trigger ?? 'segment',
        });
      }
    }
    if (out.length > 0) return out;
  }

  if (boundaryMarks.length > 0 && points.length >= 2) {
    const endMs = startMs + Math.max(1, durationSec) * 1000;
    const sortedMarks = boundaryMarks
      .filter((m) => m.tsMs > startMs + 3000 && m.tsMs < endMs - 3000)
      .sort((a, b) => a.tsMs - b.tsMs);

    const deduped: Array<{ tsMs: number; name?: string; trigger?: string }> = [];
    for (const m of sortedMarks) {
      if (deduped.length === 0 || m.tsMs - deduped[deduped.length - 1].tsMs >= 3000) {
        deduped.push(m);
      }
    }

    if (deduped.length > 0) {
      const boundaries = [
        { tsMs: startMs, name: deduped[0]?.name, trigger: deduped[0]?.trigger },
        ...deduped.map((d, idx) => ({ tsMs: d.tsMs, name: deduped[idx + 1]?.name ?? d.name, trigger: d.trigger })),
        { tsMs: endMs, name: undefined, trigger: deduped[deduped.length - 1]?.trigger },
      ];

      for (let i = 0; i < boundaries.length - 1; i++) {
        const sT = Math.max(0, Math.round((boundaries[i].tsMs - startMs) / 1000));
        const eT = Math.max(sT, Math.round((boundaries[i + 1].tsMs - startMs) / 1000));
        const slice = points.filter((p) => p.t >= sT && p.t <= eT);
        const idx = out.length + 1;
        if (slice.length >= 2) {
          const lap = buildLapFromPointSlice(slice, idx, {
            name: boundaries[i].name || `Segmento ${idx}`,
            durationSec: Math.max(1, eT - sT),
            trigger: boundaries[i].trigger ?? 'manual',
          });
          if (lap) out.push(lap);
        }
      }
      if (out.length > 0) return out;
    }
  }

  void totalDistanceM;
  return out;
}

export function parseHiTrackText(
  text: string,
  options: {
    fileName?: string;
    sportTypeCode?: number;
    startTimeMs?: number;
    totalTimeMs?: number;
    totalDistanceM?: number;
    caloriesKcal?: number;
    avgHr?: number;
    maxHr?: number;
    steps?: number;
    deviceName?: string;
    extraSegments?: RawHuaweiSegmentSpec[];
  } = {}
): ParsedActivityData {
  const lines = text.split(/\r?\n/);

  interface RawSample {
    lat?: number;
    lon?: number;
    ele?: number;
    hr?: number;
    cad?: number;
    sr?: number;
    speed?: number;
  }

  const bucket = new Map<number, RawSample>();
  let minTsMs: number | null = options.startTimeMs ?? null;
  let maxTsMs: number | null = null;
  let stepFreqSum = 0;
  let stepFreqCount = 0;
  let stepFreqPositiveMax = 0;
  let hasNegativeStepFreq = false;
  let hasGps = false;
  const hiTrackSegments: RawHuaweiSegmentSpec[] = [];
  const hiTrackBoundaryMarks: Array<{ tsMs: number; name?: string; trigger?: string }> = [];

  // Intentar extraer epoch desde nombre de archivo HiTrack_YYYY... o HiTrack_<10digits>
  if (!minTsMs && options.fileName) {
    const match = options.fileName.match(/HiTrack_(\d{10})/);
    if (match) {
      minTsMs = Number(match[1]) * 1000;
    }
  }

  const upsert = (tsMs: number, patch: Partial<RawSample>) => {
    const secKey = Math.round(tsMs / 1000) * 1000;
    const cur = bucket.get(secKey) ?? {};
    bucket.set(secKey, { ...cur, ...patch });
    if (minTsMs === null || secKey < minTsMs) minTsMs = secKey;
    if (maxTsMs === null || secKey > maxTsMs) maxTsMs = secKey;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith('tp=')) continue;

    const parts = line.split(';');
    const kv: Record<string, string> = {};
    for (const part of parts) {
      const idx = part.indexOf('=');
      if (idx > 0) {
        kv[part.slice(0, idx)] = part.slice(idx + 1);
      }
    }

    const tp = kv.tp;
    if (tp === 'lbs') {
      const lat = Number(kv.lat);
      const lon = Number(kv.lon);
      const alt = kv.alt !== undefined ? Number(kv.alt) : undefined;
      const tVal = Number(kv.t ?? kv.k);
      // Centinelas de pausa o sin GPS en Huawei HiTrack
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if ((lat === 90 && lon === -80) || (lat === 0 && lon === 0)) continue;
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
      const tsMs = convertHiTrackTimestampMs(tVal, minTsMs ?? undefined);
      if (!tsMs) continue;
      hasGps = true;
      const existing = bucket.get(Math.round(tsMs / 1000) * 1000);
      upsert(tsMs, {
        lat,
        lon,
        ele:
          existing?.ele !== undefined
            ? existing.ele
            : alt !== undefined && Number.isFinite(alt) && alt !== 0 && alt > -500 && alt < 9000
              ? alt
              : undefined,
      });
    } else if (tp === 'h-r') {
      const tsMs = convertHiTrackTimestampMs(Number(kv.k), minTsMs ?? undefined);
      const hr = Number(kv.v);
      if (tsMs && Number.isFinite(hr) && hr > 25 && hr < 245) {
        upsert(tsMs, { hr: Math.round(hr) });
      }
    } else if (tp === 'cad') {
      const tsMs = convertHiTrackTimestampMs(Number(kv.k), minTsMs ?? undefined);
      const cad = Number(kv.v);
      if (tsMs && Number.isFinite(cad) && cad >= 0 && cad < 255) {
        upsert(tsMs, { cad: Math.round(cad) });
      }
    } else if (tp === 's-r') {
      const tsMs = convertHiTrackTimestampMs(Number(kv.k), minTsMs ?? undefined);
      const sr = Number(kv.v);
      if (Number.isFinite(sr)) {
        if (sr < 0) hasNegativeStepFreq = true;
        if (sr >= 0 && sr < 255) {
          stepFreqSum += sr;
          stepFreqCount++;
          if (sr > stepFreqPositiveMax) stepFreqPositiveMax = sr;
          if (tsMs) upsert(tsMs, { sr: Math.round(sr) });
        }
      }
    } else if (tp === 'alti' || tp === 'alt') {
      const tsMs = convertHiTrackTimestampMs(Number(kv.k), minTsMs ?? undefined);
      const ele = Number(kv.v);
      if (tsMs && Number.isFinite(ele) && ele > -500 && ele < 9000) {
        upsert(tsMs, { ele: Math.round(ele * 10) / 10 });
      }
    } else if (tp === 'rs') {
      const tsMs = convertHiTrackTimestampMs(Number(kv.k), minTsMs ?? options.startTimeMs ?? undefined, true);
      const decimetersPerSec = Number(kv.v);
      if (tsMs && Number.isFinite(decimetersPerSec) && decimetersPerSec >= 0 && decimetersPerSec < 400) {
        upsert(tsMs, { speed: Math.round((decimetersPerSec / 10) * 100) / 100 });
      }
    } else if (tp && SEGMENT_HI_TYPES.has(tp)) {
      const nameVal = kv.n ?? kv.name ?? kv.label ?? kv.title;
      const startRaw = Number(kv.st ?? kv.startTime ?? kv.start);
      const endRaw = Number(kv.et ?? kv.endTime ?? kv.end);
      const tsRaw = Number(kv.t ?? kv.k);
      const distVal = Number(kv.d ?? kv.dist ?? kv.dis ?? kv.distance);
      const durVal = Number(kv.dur ?? kv.dt ?? kv.time ?? kv.duration);
      const hrVal = Number(kv.hr ?? kv.h ?? kv.avgHr);
      const cadVal = Number(kv.cad ?? kv.c);
      const spdVal = Number(kv.s ?? kv.v ?? kv.speed);
      const triggerVal = kv.type ?? kv.trigger ?? kv.intensity ?? (tp === 'lap' || tp === 'mark' ? 'manual' : 'segment');

      const sMs = Number.isFinite(startRaw) ? convertHiTrackTimestampMs(startRaw, minTsMs ?? options.startTimeMs ?? undefined) : null;
      const eMs = Number.isFinite(endRaw) ? convertHiTrackTimestampMs(endRaw, minTsMs ?? options.startTimeMs ?? undefined) : null;
      const markMs = Number.isFinite(tsRaw) ? convertHiTrackTimestampMs(tsRaw, minTsMs ?? options.startTimeMs ?? undefined) : null;

      if ((sMs && eMs && eMs > sMs) || (Number.isFinite(durVal) && durVal > 0) || (Number.isFinite(distVal) && distVal > 0)) {
        hiTrackSegments.push({
          name: nameVal?.trim() || undefined,
          startMs: sMs ?? markMs ?? undefined,
          endMs: eMs ?? undefined,
          distanceMeters: Number.isFinite(distVal) && distVal > 0 ? Math.round(distVal) : undefined,
          durationSec: Number.isFinite(durVal) && durVal > 0 ? normalizeDurationMaybeMs(durVal) : undefined,
          avgHr: Number.isFinite(hrVal) && hrVal > 25 && hrVal < 245 ? Math.round(hrVal) : undefined,
          avgCadence: Number.isFinite(cadVal) && cadVal > 0 && cadVal < 255 ? Math.round(cadVal) : undefined,
          avgSpeedMs: Number.isFinite(spdVal) && spdVal > 0 && spdVal < 40 ? Math.round(spdVal * 100) / 100 : undefined,
          trigger: triggerVal,
        });
      } else if (markMs) {
        hiTrackBoundaryMarks.push({
          tsMs: markMs,
          name: nameVal?.trim() || undefined,
          trigger: triggerVal,
        });
      }
    }
  }

  const sortedEntries = Array.from(bucket.entries()).sort((a, b) => a[0] - b[0]);
  const startMs = options.startTimeMs ?? sortedEntries[0]?.[0] ?? minTsMs ?? Date.now();

  const points: ActivityPoint[] = [];
  let prevLat: number | undefined;
  let prevLon: number | undefined;
  let prevTimeMs: number | undefined;
  let cumDist = 0;
  let movingTimeSec = 0;

  let hrSum = 0;
  let hrCount = 0;
  let maxHr = 0;
  let cadSum = 0;
  let cadCount = 0;
  let maxSpeedMs = 0;

  for (const [tsMs, s] of sortedEntries) {
    const t = Math.max(0, Math.round((tsMs - startMs) / 1000));
    let stepDist = 0;
    if (s.lat !== undefined && s.lon !== undefined && prevLat !== undefined && prevLon !== undefined) {
      stepDist = haversineMeters(prevLat, prevLon, s.lat, s.lon);
      if (stepDist < 1500) {
        cumDist += stepDist;
      }
    }

    let speedMs = s.speed;
    if (speedMs === undefined && prevTimeMs !== undefined) {
      const dt = (tsMs - prevTimeMs) / 1000;
      if (dt > 0 && dt <= 60 && stepDist > 0) {
        speedMs = Math.round((stepDist / dt) * 100) / 100;
      }
    }
    if (speedMs !== undefined && prevTimeMs !== undefined) {
      const dt = (tsMs - prevTimeMs) / 1000;
      if (dt > 0 && dt <= 60 && speedMs > 0.35) {
        movingTimeSec += dt;
      }
      if (speedMs > maxSpeedMs && speedMs < 35) maxSpeedMs = speedMs;
    }

    const cad = s.cad ?? s.sr;
    if (s.hr !== undefined) {
      hrSum += s.hr;
      hrCount++;
      if (s.hr > maxHr) maxHr = s.hr;
    }
    if (cad !== undefined && cad > 0) {
      cadSum += cad;
      cadCount++;
    }

    points.push({
      t,
      lat: s.lat,
      lon: s.lon,
      ele: s.ele,
      hr: s.hr,
      cad,
      speed: speedMs,
      dist: Math.round(cumDist),
    });

    if (s.lat !== undefined && s.lon !== undefined) {
      prevLat = s.lat;
      prevLon = s.lon;
    }
    prevTimeMs = tsMs;
  }

  const eleStats = computeElevationGainLoss(points);
  const lastT = points[points.length - 1]?.t ?? 0;
  const durationSec = Math.max(
    lastT,
    options.totalTimeMs ? Math.round(options.totalTimeMs / 1000) : 0,
    maxTsMs && startMs ? Math.max(0, Math.round((maxTsMs - startMs) / 1000)) : 0
  );
  const distanceMeters = Math.round(
    options.totalDistanceM && options.totalDistanceM > 0 ? options.totalDistanceM : cumDist
  );

  // Determinar deporte
  let sportInfo = options.sportTypeCode !== undefined ? HUAWEI_SPORT_MAP[options.sportTypeCode] : undefined;
  if (!sportInfo) {
    if (hasNegativeStepFreq && !hasGps) {
      sportInfo = HUAWEI_SPORT_MAP[102];
    } else if (stepFreqCount > 0 && stepFreqPositiveMax === 0 && distanceMeters > 1000) {
      sportInfo = HUAWEI_SPORT_MAP[3]; // Ciclismo
    } else if (stepFreqCount > 0 && stepFreqSum / stepFreqCount > 125) {
      sportInfo =
        distanceMeters >= 4000 && eleStats.gain >= 300 && eleStats.gain / (distanceMeters / 1000) > 35
          ? HUAWEI_SPORT_MAP[118]
          : HUAWEI_SPORT_MAP[4];
    } else if (hasGps && stepFreqCount > 0 && stepFreqSum / stepFreqCount >= 60) {
      sportInfo = HUAWEI_SPORT_MAP[5];
    } else {
      sportInfo = HUAWEI_SPORT_MAP[4];
    }
  }

  const enrichedPoints = enrichPointsTelemetry(points, sportInfo.sport);
  const coordsForPoly = enrichedPoints
    .filter((p): p is ActivityPoint & { lat: number; lon: number } => typeof p.lat === 'number' && typeof p.lon === 'number')
    .map((p) => [p.lat, p.lon] as [number, number]);
  const polyCoords =
    coordsForPoly.length > 220
      ? coordsForPoly.filter((_, idx) => idx % Math.ceil(coordsForPoly.length / 220) === 0 || idx === coordsForPoly.length - 1)
      : coordsForPoly;

  const effMoving = movingTimeSec > 0 ? Math.round(movingTimeSec) : durationSec;
  const avgSpeedMs = effMoving > 0 && distanceMeters > 0 ? Math.round((distanceMeters / effMoving) * 100) / 100 : undefined;
  const avgHr = options.avgHr ?? (hrCount > 0 ? Math.round(hrSum / hrCount) : undefined);
  const maxHrFinal = options.maxHr ?? (maxHr > 0 ? maxHr : undefined);
  const avgCadence = cadCount > 0 ? Math.round(cadSum / cadCount) : undefined;

  const rawExtras: ActivityExtras = {
    deviceName: options.deviceName ?? 'Huawei Health / Reloj Huawei',
    steps: options.steps ?? null,
    originApp: 'HuaweiHealth',
  };

  const extras = computeSessionExtras(
    {
      sport: sportInfo.sport,
      durationSec,
      movingTimeSec: effMoving,
      distanceMeters,
      elevationGain: eleStats.gain,
      avgSpeedMs: avgSpeedMs ?? null,
      avgHr: avgHr ?? null,
      avgWatts: null,
      normalizedPower: null,
      extras: rawExtras,
    },
    enrichedPoints
  );

  const startedAtIso = new Date(startMs).toISOString();
  const combinedSpecs = [...(options.extraSegments ?? []), ...hiTrackSegments];
  const laps = buildLapsFromHuaweiSpecs(
    combinedSpecs,
    hiTrackBoundaryMarks,
    enrichedPoints,
    startMs,
    durationSec,
    distanceMeters
  );

  return {
    externalId: `huawei_ht_${startMs}_${options.sportTypeCode ?? sportInfo.sport}`,
    source: 'fit',
    sport: sportInfo.sport,
    subSport: sportInfo.subSport,
    title: resolveActivityTitle(null, sportInfo.sport, startedAtIso),
    startedAt: startedAtIso,
    durationSec,
    movingTimeSec: effMoving,
    distanceMeters,
    elevationGain: eleStats.gain,
    elevationLoss: eleStats.loss,
    avgSpeedMs,
    maxSpeedMs: maxSpeedMs > 0 ? Math.round(maxSpeedMs * 100) / 100 : undefined,
    avgHr,
    maxHr: maxHrFinal,
    avgCadence,
    calories: options.caloriesKcal !== undefined ? Math.round(options.caloriesKcal) : undefined,
    polyline: polyCoords.length > 1 ? encodePolyline(polyCoords) : undefined,
    startLat: coordsForPoly[0]?.[0],
    startLon: coordsForPoly[0]?.[1],
    points: downsamplePoints(enrichedPoints, 1800),
    laps,
    extras,
  };
}

function extractSegmentsFromHuaweiJson(
  entry: Record<string, unknown>,
  simplifyJson: Record<string, unknown>,
  parentObj: Record<string, unknown> | undefined,
  totalDurationSec?: number,
  totalDistanceM?: number
): RawHuaweiSegmentSpec[] {
  const out: RawHuaweiSegmentSpec[] = [];
  const arrayKeys = [
    'segmentList',
    'segments',
    'customSegments',
    'laps',
    'lapList',
    'splits',
    'splitList',
    'intervalList',
    'intervals',
    'sectionList',
    'sections',
    'stageList',
    'stages',
    'subTrackList',
    'partList',
    'sportSegments',
    'childTrackList',
    'trackSegments',
  ];

  const containers = [simplifyJson, entry, ...(parentObj ? [parentObj] : [])];
  for (const container of containers) {
    for (const key of arrayKeys) {
      const list = container[key];
      if (!Array.isArray(list)) continue;
      for (const rawItem of list) {
        if (!rawItem || typeof rawItem !== 'object') continue;
        const item = rawItem as Record<string, unknown>;
        const nameRaw = item.name ?? item.title ?? item.label ?? item.segmentName ?? item.lapName ?? item.typeName;
        const startMsRaw = Number(item.startTime ?? item.start_time ?? item.beginTime);
        const endMsRaw = Number(item.endTime ?? item.end_time);
        const startDistRaw = Number(item.startDist ?? item.startDistance ?? item.start_distance);
        const endDistRaw = Number(item.endDist ?? item.endDistance ?? item.end_distance);
        const distRaw = Number(item.distance ?? item.totalDistance ?? item.dist ?? item.distanceMeters);
        const durRaw = item.duration ?? item.totalTime ?? item.elapsedTime ?? item.time ?? item.durationSec;
        const movRaw = item.movingTime ?? item.activeTime ?? item.totalTimerTime;
        const eleGainRaw = Number(item.elevationGain ?? item.totalAscent ?? item.ascent);
        const eleLossRaw = Number(item.elevationLoss ?? item.totalDescent ?? item.descent);
        const avgHrRaw = Number(item.avgHr ?? item.avgHeartRate ?? item.heartRate);
        const maxHrRaw = Number(item.maxHr ?? item.maxHeartRate);
        const avgCadRaw = Number(item.avgCadence ?? item.cadence);
        const avgSpdRaw = Number(item.avgSpeed ?? item.speed);
        const calRaw = Number(item.calories ?? item.totalCalories);
        const triggerRaw = item.trigger ?? item.type ?? item.intensity ?? (key.toLowerCase().includes('lap') ? 'manual' : 'segment');

        const durSec = durRaw !== undefined ? normalizeDurationMaybeMs(durRaw, totalDurationSec) : undefined;
        const movSec = movRaw !== undefined ? normalizeDurationMaybeMs(movRaw, totalDurationSec) : undefined;
        const distM = Number.isFinite(distRaw) && distRaw > 0 ? Math.round(distRaw) : undefined;

        if ((durSec && durSec > 0) || (distM && distM > 0) || (Number.isFinite(startMsRaw) && Number.isFinite(endMsRaw) && endMsRaw > startMsRaw)) {
          out.push({
            name: typeof nameRaw === 'string' && nameRaw.trim() ? nameRaw.trim() : undefined,
            startMs: Number.isFinite(startMsRaw) && startMsRaw > 1e11 ? startMsRaw : undefined,
            endMs: Number.isFinite(endMsRaw) && endMsRaw > 1e11 ? endMsRaw : undefined,
            startDistM: Number.isFinite(startDistRaw) ? Math.round(startDistRaw) : undefined,
            endDistM: Number.isFinite(endDistRaw) ? Math.round(endDistRaw) : undefined,
            distanceMeters: distM,
            durationSec: durSec,
            movingTimeSec: movSec,
            elevationGain: Number.isFinite(eleGainRaw) && eleGainRaw >= 0 ? Math.round(eleGainRaw) : undefined,
            elevationLoss: Number.isFinite(eleLossRaw) && eleLossRaw >= 0 ? Math.round(eleLossRaw) : undefined,
            avgHr: Number.isFinite(avgHrRaw) && avgHrRaw > 25 && avgHrRaw < 245 ? Math.round(avgHrRaw) : undefined,
            maxHr: Number.isFinite(maxHrRaw) && maxHrRaw > 25 && maxHrRaw < 245 ? Math.round(maxHrRaw) : undefined,
            avgCadence: Number.isFinite(avgCadRaw) && avgCadRaw > 0 && avgCadRaw < 255 ? Math.round(avgCadRaw) : undefined,
            avgSpeedMs: Number.isFinite(avgSpdRaw) && avgSpdRaw > 0 && avgSpdRaw < 40 ? Math.round(avgSpdRaw * 100) / 100 : undefined,
            calories:
              Number.isFinite(calRaw) && calRaw > 0
                ? Math.round(calRaw > 5000 ? calRaw / 1000 : calRaw)
                : undefined,
            trigger: typeof triggerRaw === 'string' ? triggerRaw : 'segment',
          });
        }
      }
      if (out.length > 0) return out;
    }
  }

  // Revisar partTimeMap si contiene objetos o distancias personalizadas válidas
  for (const container of containers) {
    const ptm = container.partTimeMap;
    if (!ptm || typeof ptm !== 'object' || Array.isArray(ptm)) continue;
    const entries = Object.entries(ptm as Record<string, unknown>);
    if (entries.length === 0) continue;

    // Formato objeto: { "1": { distance, duration, name }, ... }
    if (entries.some(([, v]) => v && typeof v === 'object' && !Array.isArray(v))) {
      for (const [k, v] of entries) {
        if (!v || typeof v !== 'object') continue;
        const obj = v as Record<string, unknown>;
        const distM = Number(obj.distance ?? obj.totalDistance ?? obj.dist);
        const durSec = normalizeDurationMaybeMs(obj.duration ?? obj.time ?? obj.totalTime, totalDurationSec);
        if ((durSec && durSec > 0) || (Number.isFinite(distM) && distM > 0)) {
          out.push({
            name: typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : `Segmento ${k}`,
            distanceMeters: Number.isFinite(distM) && distM > 0 ? Math.round(distM) : undefined,
            durationSec: durSec,
            trigger: 'segment',
          });
        }
      }
      if (out.length > 0) return out;
    }

    // Formato numérico: claves de distancia (en metros, ej. 400, 800, 1500) -> duración o tiempo acumulado
    const numericPairs = entries
      .map(([k, v]) => ({ key: Number(k), val: Number(v) }))
      .filter((p) => Number.isFinite(p.key) && Number.isFinite(p.val) && p.val > 0)
      .sort((a, b) => a.key - b.key);

    if (numericPairs.length >= 2) {
      const hasDistanceKeys =
        numericPairs.every((p) => p.key >= 50) &&
        (!totalDistanceM || numericPairs[numericPairs.length - 1].key <= totalDistanceM * 1.15);
      const isUniform1Km =
        hasDistanceKeys &&
        numericPairs.every((p, idx) => idx === numericPairs.length - 1 ? p.key % 1000 === 0 || p.key > idx * 1000 : p.key === (idx + 1) * 1000);

      if (hasDistanceKeys && !isUniform1Km) {
        const vals = numericPairs.map((p) => normalizeDurationMaybeMs(p.val, totalDurationSec) ?? 0);
        const monotonicVals = vals.every((v, i) => i === 0 || v > vals[i - 1]);
        const sumDurs = monotonicVals ? vals[vals.length - 1] : vals.reduce((a, b) => a + b, 0);
        if (!totalDurationSec || sumDurs <= totalDurationSec * 1.25) {
          let prevDist = 0;
          let prevVal = 0;
          for (let i = 0; i < numericPairs.length; i++) {
            const distM = Math.max(0, Math.round(numericPairs[i].key - prevDist));
            const durSec = monotonicVals ? Math.max(1, vals[i] - prevVal) : vals[i];
            if (distM > 0 && durSec > 0) {
              out.push({
                name: `Segmento ${out.length + 1}`,
                startDistM: prevDist,
                endDistM: Math.round(numericPairs[i].key),
                distanceMeters: distM,
                durationSec: durSec,
                trigger: 'segment',
              });
            }
            prevDist = Math.round(numericPairs[i].key);
            prevVal = vals[i];
          }
          if (out.length > 0) return out;
        }
      }
    }
  }

  return out;
}

export function parseHuaweiMotionPathJson(jsonText: string, fileName = 'motion_path.json'): ParsedActivityData[] {
  // Huawei Privacy JSON suele traer claves numéricas sin comillas en partTimeMap:{0:123,...}
  const cleanText = jsonText.replace(/^\uFEFF/, '');
  let raw: unknown;
  try {
    const quotedKeys = cleanText.replace(/([{,]\s*)(\d+)\s*:/g, '$1"$2":');
    raw = JSON.parse(quotedKeys);
  } catch {
    const sanitized = cleanText.replace(/"partTimeMap"\s*:\s*\{[^{}]*\}/g, '"partTimeMap":null');
    raw = JSON.parse(sanitized);
  }
  const topList = Array.isArray(raw) ? raw : [raw];

  const entries: Array<{ entry: Record<string, unknown>; parent?: Record<string, unknown> }> = [];
  for (const item of topList) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    if (Array.isArray(obj.motionPathData)) {
      for (const mp of obj.motionPathData) {
        if (mp && typeof mp === 'object') {
          entries.push({ entry: mp as Record<string, unknown>, parent: obj });
        }
      }
    } else if ('attribute' in obj || 'sportType' in obj || 'startTime' in obj) {
      entries.push({ entry: obj });
    }
  }

  const out: ParsedActivityData[] = [];
  for (const { entry, parent } of entries) {
    const sportTypeCode = typeof entry.sportType === 'number' ? entry.sportType : undefined;
    const startTimeMs = typeof entry.startTime === 'number' ? entry.startTime : undefined;
    const totalTimeEntry = typeof entry.totalTime === 'number' ? entry.totalTime : undefined;
    const totalDistEntry = typeof entry.totalDistance === 'number' ? entry.totalDistance : undefined;

    const attrRaw = typeof entry.attribute === 'string' ? entry.attribute : '';
    let trackDetail = '';
    let simplifyJson: Record<string, unknown> = {};

    const detailIdx = attrRaw.indexOf('HW_EXT_TRACK_DETAIL@is');
    const simplifyIdx = attrRaw.indexOf('HW_EXT_TRACK_SIMPLIFY@is');

    if (detailIdx >= 0) {
      const start = detailIdx + 'HW_EXT_TRACK_DETAIL@is'.length;
      const end = simplifyIdx > detailIdx ? simplifyIdx : attrRaw.length;
      trackDetail = attrRaw.slice(start, end).replace(/&&\s*$/, '');
    }
    if (simplifyIdx >= 0) {
      const jsonSlice = attrRaw.slice(simplifyIdx + 'HW_EXT_TRACK_SIMPLIFY@is'.length).trim();
      try {
        simplifyJson = JSON.parse(jsonSlice) as Record<string, unknown>;
      } catch {
        simplifyJson = {};
      }
    }
    if (Object.keys(simplifyJson).length === 0 && entry.simplifyJson) {
      if (typeof entry.simplifyJson === 'string') {
        try {
          const parsedSimplify = JSON.parse(entry.simplifyJson);
          if (parsedSimplify && typeof parsedSimplify === 'object' && !Array.isArray(parsedSimplify)) {
            simplifyJson = parsedSimplify as Record<string, unknown>;
          }
        } catch {
          simplifyJson = {};
        }
      } else if (typeof entry.simplifyJson === 'object' && !Array.isArray(entry.simplifyJson)) {
        simplifyJson = entry.simplifyJson as Record<string, unknown>;
      }
    }

    const totalTimeMs =
      typeof simplifyJson.totalTime === 'number'
        ? simplifyJson.totalTime
        : totalTimeEntry;
    const totalDistanceM =
      typeof simplifyJson.totalDistance === 'number'
        ? simplifyJson.totalDistance
        : totalDistEntry;
    const totalCaloriesRaw =
      typeof simplifyJson.totalCalories === 'number'
        ? simplifyJson.totalCalories
        : typeof entry.totalCalories === 'number'
          ? entry.totalCalories
          : undefined;
    // Huawei almacena totalCalories en calorías pequeñas (cal), dividir por 1000 si > 5000
    const caloriesKcal =
      totalCaloriesRaw !== undefined
        ? totalCaloriesRaw > 5000
          ? Math.round(totalCaloriesRaw / 1000)
          : Math.round(totalCaloriesRaw)
        : undefined;
    const avgHr = typeof simplifyJson.avgHeartRate === 'number' && simplifyJson.avgHeartRate > 25 ? simplifyJson.avgHeartRate : undefined;
    const maxHr = typeof simplifyJson.maxHeartRate === 'number' && simplifyJson.maxHeartRate > 25 ? simplifyJson.maxHeartRate : undefined;
    const steps = typeof simplifyJson.totalSteps === 'number' && simplifyJson.totalSteps > 0 ? Math.round(simplifyJson.totalSteps) : undefined;

    if (!trackDetail && !totalTimeMs && !totalDistanceM) continue;

    const totalDurationSec = totalTimeMs ? Math.round(totalTimeMs / 1000) : undefined;
    const extraSegments = extractSegmentsFromHuaweiJson(entry, simplifyJson, parent, totalDurationSec, totalDistanceM);

    const parsed = parseHiTrackText(trackDetail, {
      fileName,
      sportTypeCode,
      startTimeMs,
      totalTimeMs,
      totalDistanceM,
      caloriesKcal,
      avgHr,
      maxHr,
      steps,
      extraSegments,
    });

    const explicitTitle =
      typeof simplifyJson.name === 'string'
        ? simplifyJson.name
        : typeof entry.name === 'string'
          ? entry.name
          : typeof entry.title === 'string'
            ? entry.title
            : null;
    if (explicitTitle && hasConcreteActivityName(explicitTitle)) {
      parsed.title = resolveActivityTitle(explicitTitle, parsed.sport, parsed.startedAt);
    }

    if (parsed.durationSec > 0 || parsed.distanceMeters > 0 || parsed.points.length > 0) {
      out.push(parsed);
    }
  }

  return out;
}

function splitCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

export function parseHealthSyncCsv(csvText: string): HealthSyncCsvMetadata | null {
  const clean = csvText.replace(/^\uFEFF/, '').trim();
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return null;

  const headers = splitCsvRow(lines[0]).map((h) => h.toLowerCase());
  const values = splitCsvRow(lines[1]);

  const pick = (...names: string[]): string | null => {
    for (const name of names) {
      const idx = headers.findIndex((h) => h.includes(name));
      if (idx >= 0 && values[idx] !== undefined && values[idx] !== '') {
        return values[idx];
      }
    }
    return null;
  };

  const num = (val: string | null): number | null => {
    if (!val) return null;
    const n = Number(val.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };

  const originApp = pick('aplicación de origen', 'aplicacion de origen', 'origin app', 'source app');
  const activityType = pick('tipo de actividad', 'activity type');
  const activityName = pick('nombre de la actividad', 'activity name');
  const dateTimeRaw = pick('fecha', 'date');
  const elapsedSec = num(pick('tiempo transcurrido', 'elapsed time'));
  const activeSec = num(pick('tiempo activo', 'active time'));
  const distKm = num(pick('distancia (km)', 'distance (km)', 'distancia', 'distance'));
  const calories = num(pick('calorías (kcal)', 'calorias (kcal)', 'calories'));
  const steps = num(pick('pasos', 'steps'));
  const avgHr = num(pick('frecuencia cardíaca media', 'frecuencia cardiaca media', 'average heart rate', 'avg hr'));
  const maxHr = num(pick('frecuencia cardíaca máxima', 'frecuencia cardiaca maxima', 'maximum heart rate', 'max hr'));
  const avgSpeedKmh = num(pick('velocidad media', 'average speed'));
  const maxSpeedKmh = num(pick('máxima velocidad', 'maxima velocidad', 'maximum speed'));

  if (!activityType && !activityName && !dateTimeRaw) return null;

  return {
    originApp,
    activityType,
    activityName,
    dateTimeRaw,
    elapsedSec: elapsedSec !== null ? Math.round(elapsedSec) : null,
    activeSec: activeSec !== null ? Math.round(activeSec) : null,
    distanceMeters: distKm !== null ? Math.round(distKm * 1000) : null,
    calories: calories !== null && calories > 0 ? Math.round(calories) : null,
    steps: steps !== null && steps > 0 ? Math.round(steps) : null,
    avgHr: avgHr !== null && avgHr > 0 ? Math.round(avgHr) : null,
    maxHr: maxHr !== null && maxHr > 0 ? Math.round(maxHr) : null,
    avgSpeedMs: avgSpeedKmh !== null && avgSpeedKmh > 0 ? Math.round((avgSpeedKmh / 3.6) * 100) / 100 : null,
    maxSpeedMs: maxSpeedKmh !== null && maxSpeedKmh > 0 ? Math.round((maxSpeedKmh / 3.6) * 100) / 100 : null,
  };
}

export function parseHealthSyncFileIdentity(fileName: string): HealthSyncFileIdentity | null {
  const base = (fileName.split(/[\\/]/).pop() ?? fileName).trim();

  // Formato pistas: "2026.07.28 08.22-RUNNING.fit" / .tcx / .gpx / .kml
  const trackMatch = base.match(/^(\d{4}\.\d{2}\.\d{2}\s+\d{2}\.\d{2})-([A-Za-z0-9_ ]+)\.(fit|tcx|gpx|kml)$/i);
  if (trackMatch) {
    const dateTimeKey = trackMatch[1].replace(/\s+/, ' ');
    const sportHint = trackMatch[2].trim().toUpperCase();
    const ext = trackMatch[3].toLowerCase();
    const kind = ext === 'fit' || ext === 'tcx' || ext === 'gpx' || ext === 'kml' ? ext : 'other';
    return {
      bundleKey: `${dateTimeKey}|${sportHint}`,
      ext,
      kind,
      sportHint,
      dateTimeKey,
    };
  }

  // Formato resumen CSV: "RUNNING 2026.07.28 08.22 Strava.csv" / "RUNNING 2026.07.28 08.22 HuaweiHealth.csv"
  const csvMatch = base.match(/^([A-Za-z0-9_ ]+?)\s+(\d{4}\.\d{2}\.\d{2}\s+\d{2}\.\d{2})(?:\s+[^.]+)?\.csv$/i);
  if (csvMatch) {
    const sportHint = csvMatch[1].trim().toUpperCase();
    const dateTimeKey = csvMatch[2].replace(/\s+/, ' ');
    return {
      bundleKey: `${dateTimeKey}|${sportHint}`,
      ext: 'csv',
      kind: 'csv',
      sportHint,
      dateTimeKey,
    };
  }

  return null;
}

export interface BundleableFileItem<T> {
  fileName: string;
  item: T;
}

export interface GroupedHealthSyncEntry<T> {
  primary: BundleableFileItem<T>;
  csvMetaItem?: BundleableFileItem<T>;
  fallbackTrackItems?: Array<BundleableFileItem<T>>;
  bundleKey: string;
}

const TRACK_PRIORITY: Record<string, number> = {
  fit: 3,
  tcx: 2,
  gpx: 1,
};

/**
 * Agrupa archivos hermanos exportados por Health Sync (por ejemplo .fit, .tcx, .gpx, .kml y Strava/HuaweiHealth.csv)
 * eligiendo siempre el archivo de mayor fidelidad (.fit > .tcx > .gpx) e ignorando .kml y duplicados de formato.
 */
export function groupHealthSyncFiles<T>(items: Array<BundleableFileItem<T>>): Array<GroupedHealthSyncEntry<T>> {
  const bundles = new Map<string, { tracks: Array<{ item: BundleableFileItem<T>; prio: number }>; csv?: BundleableFileItem<T> }>();
  const standalone: Array<GroupedHealthSyncEntry<T>> = [];

  for (const entry of items) {
    const id = parseHealthSyncFileIdentity(entry.fileName);
    if (!id) {
      standalone.push({
        primary: entry,
        bundleKey: entry.fileName,
      });
      continue;
    }

    if (id.kind === 'kml') {
      continue;
    }

    let grp = bundles.get(id.bundleKey);
    if (!grp) {
      grp = { tracks: [] };
      bundles.set(id.bundleKey, grp);
    }

    if (id.kind === 'csv') {
      grp.csv = entry;
    } else {
      const prio = TRACK_PRIORITY[id.kind] ?? 0;
      if (prio > 0) {
        grp.tracks.push({ item: entry, prio });
      }
    }
  }

  const out: Array<GroupedHealthSyncEntry<T>> = [...standalone];
  for (const [bundleKey, grp] of bundles.entries()) {
    if (grp.tracks.length === 0) continue;
    grp.tracks.sort((a, b) => b.prio - a.prio);
    out.push({
      primary: grp.tracks[0].item,
      csvMetaItem: grp.csv,
      fallbackTrackItems: grp.tracks.slice(1).map((t) => t.item),
      bundleKey,
    });
  }

  return out;
}

export function applyHealthSyncMetadata(parsed: ParsedActivityData, meta: HealthSyncCsvMetadata | null): ParsedActivityData {
  if (!meta) return parsed;

  const parsedHasConcreteName = hasConcreteActivityName(parsed.title);
  const csvHasConcreteName = hasConcreteActivityName(meta.activityName);
  const candidateTitle = csvHasConcreteName && !parsedHasConcreteName
    ? meta.activityName
    : parsedHasConcreteName
      ? parsed.title
      : csvHasConcreteName
        ? meta.activityName
        : null;
  const nextCalories = (!parsed.calories || parsed.calories <= 0) && meta.calories ? meta.calories : parsed.calories;
  const nextAvgHr = (!parsed.avgHr || parsed.avgHr <= 0) && meta.avgHr ? meta.avgHr : parsed.avgHr;
  const nextMaxHr = (!parsed.maxHr || parsed.maxHr <= 0) && meta.maxHr ? meta.maxHr : parsed.maxHr;

  const nextDurationSec =
    parsed.durationSec <= 0 && meta.elapsedSec && meta.elapsedSec > 0
      ? meta.elapsedSec
      : parsed.durationSec;
  const nextMovingTimeSec =
    meta.activeSec && meta.activeSec > 0 && meta.activeSec < nextDurationSec && parsed.movingTimeSec >= nextDurationSec - 2
      ? meta.activeSec
      : parsed.movingTimeSec;

  const nextExtras: ActivityExtras = {
    ...(parsed.extras ?? {}),
    steps: meta.steps ?? parsed.extras?.steps ?? null,
    originApp: meta.originApp ?? parsed.extras?.originApp ?? null,
    deviceName:
      parsed.extras?.deviceName && !/^(strava|samsung health)$/i.test(parsed.extras.deviceName)
        ? parsed.extras.deviceName
        : meta.originApp?.toLowerCase().includes('huawei')
          ? 'Huawei Health / Health Sync'
          : parsed.extras?.deviceName ?? 'Health Sync',
  };

  const csvSignal = /virtual|mywhoosh|zwift|indoor_cycling|spinning/i.test(
    `${meta.activityType ?? ''} ${meta.activityName ?? ''}`
  );
  const coords = parsed.points
    .filter((p): p is ActivityPoint & { lat: number; lon: number } => typeof p.lat === 'number' && typeof p.lon === 'number')
    .map((p): [number, number] => [p.lat, p.lon]);

  const virtualCtx =
    csvSignal ||
    isMyWhooshContext({
      sport: parsed.sport,
      subSport: parsed.subSport,
      worldName: parsed.worldName,
      title: candidateTitle ?? parsed.title,
      deviceName: nextExtras.deviceName,
    });

  const csvWalkingSignal = /^walk(ing)?$|caminat/i.test((meta.activityType ?? '').trim());
  const csvTrailSignal = /trail[\s_-]*run/i.test(`${meta.activityType ?? ''} ${meta.activityName ?? ''}`);
  const csvHikeSignal = /^(hik(e|ing)|senderismo|mountaineering)$/i.test((meta.activityType ?? '').trim());
  const nextSport: SportType = virtualCtx
    ? 'mywhoosh'
    : csvWalkingSignal && parsed.sport !== 'mywhoosh'
      ? 'walking'
      : csvTrailSignal && parsed.sport !== 'mywhoosh'
        ? 'trail'
        : csvHikeSignal && parsed.sport !== 'mywhoosh'
          ? 'mountain'
          : parsed.sport;
  const nextSubSport = virtualCtx
    ? 'MyWhoosh Indoor'
    : nextSport === 'walking'
      ? 'Caminar'
      : nextSport === 'trail'
        ? 'Trail Running'
        : nextSport === 'mountain' && csvHikeSignal
          ? 'Senderismo'
          : parsed.subSport;

  const nextTitle = resolveActivityTitle(candidateTitle, nextSport, parsed.startedAt);

  const resolvedWorld = resolveMyWhooshWorldForActivity({
    worldName: parsed.worldName,
    title: nextTitle,
    sport: nextSport,
    subSport: csvSignal ? 'virtual_activity' : nextSubSport,
    deviceName: nextExtras.deviceName,
    coords,
  });

  return {
    ...parsed,
    sport: nextSport,
    subSport: nextSubSport,
    worldName: resolvedWorld?.world.name ?? parsed.worldName,
    title: nextTitle,
    durationSec: nextDurationSec,
    movingTimeSec: nextMovingTimeSec,
    calories: nextCalories,
    avgHr: nextAvgHr,
    maxHr: nextMaxHr,
    extras: nextExtras,
  };
}
