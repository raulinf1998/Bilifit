import { computeSessionExtras, enrichPointsTelemetry } from '@/lib/analytics';
import { isMyWhooshContext, resolveMyWhooshWorldForActivity } from '@/lib/mywhoosh-maps';
import { computeElevationGainLoss, downsamplePoints, encodePolyline, haversineMeters } from '@/lib/polyline';
import type { ParsedActivityData } from '@/lib/parsers/gpx';
import type { ActivityExtras, ActivityPoint, SportType } from '@/types';

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
  2: { sport: 'mountain', subSport: 'Montaña / Senderismo', fallbackTitle: 'Ruta de Montaña' },
  3: { sport: 'cycling', subSport: 'Ciclismo', fallbackTitle: 'Salida en Bici' },
  4: { sport: 'running', subSport: 'Asfalto', fallbackTitle: 'Carrera' },
  5: { sport: 'walking', subSport: 'Caminar', fallbackTitle: 'Caminata' },
  101: { sport: 'running', subSport: 'Cinta / Interior', fallbackTitle: 'Carrera en Cinta' },
  102: { sport: 'running', subSport: 'Natación Piscina', fallbackTitle: 'Natación en Piscina' },
  103: { sport: 'cycling', subSport: 'Bici Indoor', fallbackTitle: 'Bici Indoor' },
  104: { sport: 'running', subSport: 'Aguas Abiertas', fallbackTitle: 'Natación Aguas Abiertas' },
  111: { sport: 'strength', subSport: 'Elíptica / Cardio', fallbackTitle: 'Elíptica' },
  117: { sport: 'strength', subSport: 'Entrenamiento', fallbackTitle: 'Sesión Huawei' },
  118: { sport: 'mountain', subSport: 'Trail Running', fallbackTitle: 'Trail Running' },
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
  const dateLabel = new Date(startMs).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });

  return {
    externalId: `huawei_ht_${startMs}_${options.sportTypeCode ?? sportInfo.sport}`,
    source: 'fit',
    sport: sportInfo.sport,
    subSport: sportInfo.subSport,
    title: `${sportInfo.fallbackTitle} · ${dateLabel}`,
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
    laps: [],
    extras,
  };
}

export function parseHuaweiMotionPathJson(jsonText: string, fileName = 'motion_path.json'): ParsedActivityData[] {
  // Huawei Privacy JSON suele traer claves numéricas sin comillas en partTimeMap:{0:123,...}
  const sanitized = jsonText
    .replace(/^\uFEFF/, '')
    .replace(/"partTimeMap"\s*:\s*\{[^{}]*\}/g, '"partTimeMap":null');

  const raw = JSON.parse(sanitized) as unknown;
  const topList = Array.isArray(raw) ? raw : [raw];

  const entries: Array<Record<string, unknown>> = [];
  for (const item of topList) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    if (Array.isArray(obj.motionPathData)) {
      for (const mp of obj.motionPathData) {
        if (mp && typeof mp === 'object') {
          entries.push(mp as Record<string, unknown>);
        }
      }
    } else if ('attribute' in obj || 'sportType' in obj || 'startTime' in obj) {
      entries.push(obj);
    }
  }

  const out: ParsedActivityData[] = [];
  for (const entry of entries) {
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
    });

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
      bundleKey,
    });
  }

  return out;
}

export function applyHealthSyncMetadata(parsed: ParsedActivityData, meta: HealthSyncCsvMetadata | null): ParsedActivityData {
  if (!meta) return parsed;

  const isGenericTitle =
    /^\d{4}\.\d{2}\.\d{2}\s+\d{2}\.\d{2}/.test(parsed.title) ||
    ['running', 'walking', 'hiking', 'cycling', 'biking', 'actividad'].includes(parsed.title.trim().toLowerCase());

  const nextTitle = meta.activityName && isGenericTitle ? meta.activityName : parsed.title || meta.activityName || 'Actividad';
  const nextCalories = (!parsed.calories || parsed.calories <= 0) && meta.calories ? meta.calories : parsed.calories;
  const nextAvgHr = (!parsed.avgHr || parsed.avgHr <= 0) && meta.avgHr ? meta.avgHr : parsed.avgHr;
  const nextMaxHr = (!parsed.maxHr || parsed.maxHr <= 0) && meta.maxHr ? meta.maxHr : parsed.maxHr;

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
      title: nextTitle,
      deviceName: nextExtras.deviceName,
    });

  const csvWalkingSignal = /^walk(ing)?$|caminat/i.test((meta.activityType ?? '').trim());
  const nextSport: SportType = virtualCtx
    ? 'mywhoosh'
    : csvWalkingSignal && parsed.sport !== 'mywhoosh'
      ? 'walking'
      : parsed.sport;
  const nextSubSport = virtualCtx
    ? 'MyWhoosh Indoor'
    : nextSport === 'walking'
      ? 'Caminar'
      : parsed.subSport;

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
    calories: nextCalories,
    avgHr: nextAvgHr,
    maxHr: nextMaxHr,
    extras: nextExtras,
  };
}
