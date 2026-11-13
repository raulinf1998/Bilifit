import { formatDurationClock, getEffectiveDurationSec } from '@/lib/metrics';
import type { Activity, SportType } from '@/types';

/**
 * Selector de franjas de tiempo (estilo Samsung Health) para el historial.
 *
 * - `day`   : la ventana graficada es la semana (lunes a domingo) que contiene el día elegido.
 * - `week`  : la ventana graficada son las 8 semanas anteriores + la semana elegida.
 * - `month` : la ventana graficada son los 12 meses del año del mes elegido.
 *
 * El resumen (KPIs + listado) siempre corresponde al periodo *seleccionado*; las barras
 * muestran el contexto de la ventana completa con el periodo elegido resaltado.
 */
export type RangeMode = 'all' | 'day' | 'week' | 'month';
export type RangeMetric = 'time' | 'distance' | 'elevation' | 'calories' | 'sessions' | 'volume';

export interface RangeStats {
  sessions: number;
  durationSec: number;
  distanceMeters: number;
  elevationGain: number;
  calories: number;
  volumeKg: number;
  tss: number;
  avgHr: number | null;
  bySport: Record<SportType, number>;
}

export interface RangeBucket {
  /** Clave local `YYYY-MM-DD` del inicio del barril */
  key: string;
  /** Etiqueta corta bajo la barra (día del mes, `5/10` o `nov`) */
  label: string;
  /** Leyenda adicional (año bajo `ene`) */
  caption?: string;
  /** Instante ISO (UTC) de inicio, inclusivo */
  start: string;
  /** Instante ISO (UTC) de fin, exclusivo */
  end: string;
}

export interface ResolvedTimeRange {
  mode: RangeMode;
  /** Día local seleccionado (anchor) en formato `YYYY-MM-DD` */
  anchorKey: string;
  /** Barril realmente resaltado/dentro del cual se filtran las actividades */
  selectedKey: string;
  buckets: RangeBucket[];
  /** Ventana graficada (ISO UTC, `windowEnd` exclusivo) */
  windowStart: string;
  windowEnd: string;
  /** Periodo seleccionado (ISO UTC, `selectedEnd` exclusivo) */
  selectedStart: string;
  selectedEnd: string;
  /** Ej. `9 – 15 nov 2026` · `21 sept – 15 nov 2026` · `2026` */
  windowLabel: string;
  /** Ej. `viernes, 13 de noviembre de 2026` */
  selectedLabel: string;
}

const SPORT_KEYS: SportType[] = ['running', 'trail', 'mywhoosh', 'cycling', 'mountain', 'walking', 'strength'];

const MONTHS_SHORT_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const WEEKDAY_INITIALS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const WEEK_COUNT = 8;

const pad2 = (n: number) => String(n).padStart(2, '0');

export const RANGE_MODES: Array<{ id: RangeMode; label: string; hint: string }> = [
  { id: 'all', label: 'Todo', hint: 'Todo el historial' },
  { id: 'day', label: 'Días', hint: 'Un día dentro de su semana' },
  { id: 'week', label: 'Semanas', hint: 'Una semana dentro de 8' },
  { id: 'month', label: 'Meses', hint: 'Un mes dentro de su año' },
];

export const RANGE_METRICS: Array<{ id: RangeMetric; label: string }> = [
  { id: 'time', label: 'Tiempo' },
  { id: 'distance', label: 'Distancia' },
  { id: 'elevation', label: 'Desnivel' },
  { id: 'calories', label: 'Calorías' },
  { id: 'sessions', label: 'Sesiones' },
  { id: 'volume', label: 'Volumen' },
];

export function emptyRangeStats(): RangeStats {
  return {
    sessions: 0,
    durationSec: 0,
    distanceMeters: 0,
    elevationGain: 0,
    calories: 0,
    volumeKg: 0,
    tss: 0,
    avgHr: null,
    bySport: SPORT_KEYS.reduce((acc, key) => ({ ...acc, [key]: 0 }), {} as Record<SportType, number>),
  };
}

/** Aritmética de calendario local (resistente a cambios de hora de verano/invierno). */
export function addDaysLocal(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 0, 0, 0, 0);
}

export function addMonthsLocal(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1, 0, 0, 0, 0);
}

/** Inicio de semana local en lunes. */
export function startOfWeekLocal(date: Date): Date {
  const shift = (date.getDay() + 6) % 7;
  return addDaysLocal(date, -shift);
}

export function startOfMonthLocal(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

export function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function parseDayKey(key: string | null | undefined): Date | null {
  if (!key) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day, 0, 0, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day ||
    !Number.isFinite(date.getTime())
  ) {
    return null;
  }
  return date;
}

/** Día local (`YYYY-MM-DD`) de un instante ISO cualquiera. */
export function dayKeyOfIso(iso: string): string | null {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return null;
  return localDayKey(new Date(ts));
}

export function todayKey(): string {
  return localDayKey(new Date());
}

function toIsoUtc(date: Date): string {
  return date.toISOString();
}

function monthDayLabel(date: Date, previous: Date | null, mode: RangeMode): string {
  if (mode === 'month') {
    return MONTHS_SHORT_ES[date.getMonth()];
  }
  if (mode === 'week') {
    const day = date.getDate();
    if (!previous || previous.getMonth() !== date.getMonth()) {
      return `${day}/${date.getMonth() + 1}`;
    }
    return String(day);
  }
  return String(date.getDate());
}

function buildBuckets(
  mode: RangeMode,
  windowStart: Date,
  count: number,
  opts: { unit: 'day' | 'month'; step: number }
): RangeBucket[] {
  const buckets: RangeBucket[] = [];
  let previous: Date | null = null;
  for (let i = 0; i < count; i++) {
    const offset = i * opts.step;
    const start =
      opts.unit === 'month' ? addMonthsLocal(windowStart, offset) : addDaysLocal(windowStart, offset);
    const end =
      opts.unit === 'month' ? addMonthsLocal(start, 1) : addDaysLocal(start, opts.step);
    buckets.push({
      key: localDayKey(start),
      label: monthDayLabel(start, previous, mode),
      caption: mode === 'month' && start.getMonth() === 0 ? String(start.getFullYear()) : undefined,
      start: toIsoUtc(start),
      end: toIsoUtc(end),
    });
    previous = start;
  }
  return buckets;
}

function monthShort(date: Date): string {
  return MONTHS_SHORT_ES[date.getMonth()];
}

function longDate(date: Date): string {
  return `${date.getDate()} ${monthShort(date)}`;
}

function joinRange(start: Date, endExclusive: Date): string {
  const end = addDaysLocal(endExclusive, -1);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  if (sameMonth) {
    return `${start.getDate()} – ${end.getDate()} ${monthShort(end)} ${end.getFullYear()}`;
  }
  const sameYear = start.getFullYear() === end.getFullYear();
  return sameYear
    ? `${longDate(start)} – ${longDate(end)} ${end.getFullYear()}`
    : `${longDate(start)} ${start.getFullYear()} – ${longDate(end)} ${end.getFullYear()}`;
}

export function resolveRange(mode: RangeMode, anchorKey: string | null): ResolvedTimeRange {
  const anchor = parseDayKey(anchorKey) ?? new Date();
  const anchorDay = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 0, 0, 0, 0);

  if (mode === 'all') {
    const monthAnchor = startOfMonthLocal(anchorDay);
    const overviewStart = addMonthsLocal(monthAnchor, -11);
    const buckets = buildBuckets('month', overviewStart, 12, { unit: 'month', step: 1 });
    return {
      mode,
      anchorKey: localDayKey(anchorDay),
      selectedKey: 'all',
      buckets,
      windowStart: '',
      windowEnd: '',
      selectedStart: '',
      selectedEnd: '',
      windowLabel: `Últimos 12 meses (${buckets[0]?.label ?? ''} ${buckets[0]?.caption ?? ''} – ${
        buckets[buckets.length - 1]?.label ?? ''
      } ${buckets[buckets.length - 1]?.caption ?? ''})`.replace(/\s+/g, ' ').trim(),
      selectedLabel: 'Todo el historial',
    };
  }

  if (mode === 'day') {
    const windowStart = startOfWeekLocal(anchorDay);
    const windowEnd = addDaysLocal(windowStart, 7);
    return {
      mode,
      anchorKey: localDayKey(anchorDay),
      selectedKey: localDayKey(anchorDay),
      buckets: buildBuckets('day', windowStart, 7, { unit: 'day', step: 1 }),
      windowStart: toIsoUtc(windowStart),
      windowEnd: toIsoUtc(windowEnd),
      selectedStart: toIsoUtc(anchorDay),
      selectedEnd: toIsoUtc(addDaysLocal(anchorDay, 1)),
      windowLabel: joinRange(windowStart, windowEnd),
      selectedLabel: anchorDay.toLocaleDateString('es-ES', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
    };
  }

  if (mode === 'week') {
    const selectedStart = startOfWeekLocal(anchorDay);
    const windowStart = addDaysLocal(selectedStart, -7 * (WEEK_COUNT - 1));
    const windowEnd = addDaysLocal(selectedStart, 7);
    return {
      mode,
      anchorKey: localDayKey(anchorDay),
      selectedKey: localDayKey(selectedStart),
      buckets: buildBuckets('week', windowStart, WEEK_COUNT, { unit: 'day', step: 7 }),
      windowStart: toIsoUtc(windowStart),
      windowEnd: toIsoUtc(windowEnd),
      selectedStart: toIsoUtc(selectedStart),
      selectedEnd: toIsoUtc(windowEnd),
      windowLabel: joinRange(windowStart, windowEnd),
      selectedLabel: `Semana del ${joinRange(selectedStart, windowEnd)}`,
    };
  }

  const yearStart = new Date(anchorDay.getFullYear(), 0, 1, 0, 0, 0, 0);
  const monthStart = startOfMonthLocal(anchorDay);
  const monthEnd = addMonthsLocal(monthStart, 1);
  return {
    mode,
    anchorKey: localDayKey(anchorDay),
    selectedKey: localDayKey(monthStart),
    buckets: buildBuckets('month', yearStart, 12, { unit: 'month', step: 1 }),
    windowStart: toIsoUtc(yearStart),
    windowEnd: toIsoUtc(addMonthsLocal(yearStart, 12)),
    selectedStart: toIsoUtc(monthStart),
    selectedEnd: toIsoUtc(monthEnd),
    windowLabel: String(anchorDay.getFullYear()),
    selectedLabel: monthStart.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }),
  };
}

/** Desplaza el anchor `delta` periodos (1 = siguiente, -1 = anterior) sin ir más allá de hoy. */
export function shiftAnchorKey(mode: RangeMode, anchorKey: string, delta: number): string {
  const anchor = parseDayKey(anchorKey) ?? new Date();
  let next: Date;
  if (mode === 'day') {
    next = addDaysLocal(anchor, delta);
  } else if (mode === 'week') {
    next = addDaysLocal(startOfWeekLocal(anchor), delta * 7);
  } else if (mode === 'month') {
    next = startOfMonthLocal(addMonthsLocal(anchor, delta));
  } else {
    return anchorKey;
  }

  const today = new Date();
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
  const maxForMode =
    mode === 'month'
      ? startOfMonthLocal(todayDay)
      : mode === 'week'
        ? startOfWeekLocal(todayDay)
        : todayDay;

  if (delta > 0 && next.getTime() > maxForMode.getTime()) {
    return localDayKey(maxForMode);
  }
  return localDayKey(next);
}

export function isNextDisabled(mode: RangeMode, anchorKey: string): boolean {
  if (mode === 'all') return true;
  const today = new Date();
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
  const anchor = parseDayKey(anchorKey);
  if (!anchor) return false;
  if (mode === 'day') return anchor.getTime() >= todayDay.getTime();
  if (mode === 'week') return startOfWeekLocal(anchor).getTime() >= startOfWeekLocal(todayDay).getTime();
  return startOfMonthLocal(anchor).getTime() >= startOfMonthLocal(todayDay).getTime();
}

export function summarizeActivities(activities: Activity[]): RangeStats {
  const stats = emptyRangeStats();
  let hrWeight = 0;
  let hrSum = 0;

  for (const act of activities) {
    stats.sessions += 1;
    stats.durationSec += getEffectiveDurationSec(act);
    stats.distanceMeters += act.distanceMeters || 0;
    stats.elevationGain += act.elevationGain || 0;
    stats.calories += act.calories || 0;
    stats.volumeKg += act.totalVolumeKg || 0;
    stats.tss += act.tss || 0;
    if (typeof act.avgHr === 'number' && act.avgHr > 0) {
      const weight = Math.max(1, getEffectiveDurationSec(act));
      hrSum += act.avgHr * weight;
      hrWeight += weight;
    }
    if (stats.bySport[act.sport] !== undefined) {
      stats.bySport[act.sport] += 1;
    }
  }

  stats.avgHr = hrWeight > 0 ? Math.round(hrSum / hrWeight) : null;
  return stats;
}

export interface RangeBucketStat extends RangeStats {
  bucket: RangeBucket;
}

/** Reparte las actividades (ordenadas por fecha) en los barriles de la ventana. */
export function statsForBuckets(activities: Activity[], buckets: RangeBucket[]): RangeBucketStat[] {
  const perBucket: Activity[][] = buckets.map(() => []);

  for (const act of activities) {
    const ts = Date.parse(act.startedAt);
    if (!Number.isFinite(ts)) continue;
    for (let i = 0; i < buckets.length; i++) {
      const startTs = Date.parse(buckets[i].start);
      const endTs = Date.parse(buckets[i].end);
      if (ts >= startTs && ts < endTs) {
        perBucket[i].push(act);
        break;
      }
    }
  }

  return buckets.map((bucket, i) => ({ bucket, ...summarizeActivities(perBucket[i]) }));
}

export function filterActivitiesByIsoRange(
  activities: Activity[],
  startIso: string | null,
  endIso: string | null
): Activity[] {
  const startTs = startIso ? Date.parse(startIso) : Number.NEGATIVE_INFINITY;
  const endTs = endIso ? Date.parse(endIso) : Number.POSITIVE_INFINITY;
  return activities.filter((act) => {
    const ts = Date.parse(act.startedAt);
    if (!Number.isFinite(ts)) return false;
    return ts >= startTs && ts < endTs;
  });
}

export function metricValueOf(stats: RangeStats, metric: RangeMetric): number {
  switch (metric) {
    case 'time':
      return stats.durationSec;
    case 'distance':
      return stats.distanceMeters / 1000;
    case 'elevation':
      return stats.elevationGain;
    case 'calories':
      return stats.calories;
    case 'sessions':
      return stats.sessions;
    case 'volume':
      return stats.volumeKg;
    default:
      return 0;
  }
}

export function formatMetricValue(metric: RangeMetric, value: number, opts?: { compact?: boolean }): string {
  const compact = opts?.compact ?? false;
  switch (metric) {
    case 'time':
      return compact ? `${(value / 3600).toFixed(1)} h` : formatDurationClock(value);
    case 'distance':
      return compact ? `${value.toFixed(0)} km` : `${value.toFixed(2)} km`;
    case 'elevation':
      return compact ? `${Math.round(value)} m` : `+${Math.round(value)} m`;
    case 'calories':
      return compact ? `${Math.round(value)}` : `${Math.round(value)} kcal`;
    case 'sessions':
      return compact ? `${Math.round(value)}` : `${Math.round(value)} ${Math.round(value) === 1 ? 'sesión' : 'sesiones'}`;
    case 'volume':
      return compact ? `${Math.round(value)} kg` : `${Math.round(value)} kg`;
    default:
      return String(value);
  }
}

export function metricAxisHint(metric: RangeMetric): string {
  switch (metric) {
    case 'time':
      return '(h:min)';
    case 'distance':
      return '(km)';
    case 'elevation':
      return '(m+)';
    case 'calories':
      return '(kcal)';
    case 'sessions':
      return '(nº)';
    case 'volume':
      return '(kg)';
    default:
      return '';
  }
}

/** Rejilla mensual local (lunes a domingo) para el calendario selector. */
export interface CalendarDay {
  key: string;
  day: number;
  weekdayInitial: string;
  inMonth: boolean;
  isToday: boolean;
}

export function buildMonthGrid(anchor: Date): CalendarDay[][] {
  const first = startOfMonthLocal(anchor);
  const gridStart = startOfWeekLocal(first);
  const today = new Date();
  const rows: CalendarDay[][] = [];

  for (let week = 0; week < 6; week++) {
    const row: CalendarDay[] = [];
    for (let offset = 0; offset < 7; offset++) {
      const date = addDaysLocal(gridStart, week * 7 + offset);
      const key = localDayKey(date);
      row.push({
        key,
        day: date.getDate(),
        weekdayInitial: WEEKDAY_INITIALS[offset],
        inMonth: date.getMonth() === first.getMonth(),
        isToday: key === localDayKey(today),
      });
    }
    const lastInMonth = row.some((cell) => cell.inMonth);
    if (week === 5 && !lastInMonth) break;
    rows.push(row);
  }

  return rows;
}

export function monthTitle(date: Date): string {
  return `${MONTHS_SHORT_ES[date.getMonth()].replace(/^\w/, (c) => c.toUpperCase())} ${date.getFullYear()}`;
}

export interface ActivityDayStat extends RangeStats {
  /** Día local `YYYY-MM-DD` */
  key: string;
  /** Etiqueta tipo `vie, 13 nov` */
  label: string;
  /** Actividades de ese día (más reciente primero) */
  items: Activity[];
}

/** Agrupa actividades por día local (más reciente primero) con sus totales. */
export function groupActivitiesByDay(activities: Activity[]): ActivityDayStat[] {
  const groups = new Map<string, Activity[]>();
  for (const act of activities) {
    const key = dayKeyOfIso(act.startedAt);
    if (!key) continue;
    const list = groups.get(key);
    if (list) list.push(act);
    else groups.set(key, [act]);
  }

  return Array.from(groups.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, items]) => {
      const date = parseDayKey(key);
      return {
        key,
        items,
        label: date
          ? date.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '')
          : key,
        ...summarizeActivities(items),
      };
    });
}

/** Totales por día local para sombrear el calendario selector. */
export function buildDayStatsMap(activities: Activity[]): Record<string, ActivityDayStat> {
  const map: Record<string, ActivityDayStat> = {};
  for (const stat of groupActivitiesByDay(activities)) {
    map[stat.key] = stat;
  }
  return map;
}
