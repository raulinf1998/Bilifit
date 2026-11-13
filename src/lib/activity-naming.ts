import { sportLabel } from '@/lib/metrics';
import type { SportType } from '@/types';

const GENERIC_TOKENS = new Set([
  'run',
  'running',
  'runner',
  'correr',
  'carrera',
  'trail',
  'trailrun',
  'trailrunning',
  'cycling',
  'cycle',
  'ciclismo',
  'bici',
  'bicicleta',
  'ride',
  'biking',
  'bike',
  'mtb',
  'gravel',
  'road',
  'carretera',
  'mountain',
  'montana',
  'montaña',
  'hike',
  'hiking',
  'senderismo',
  'walk',
  'walking',
  'caminar',
  'caminata',
  'paseo',
  'strength',
  'fuerza',
  'casa',
  'sport',
  'deporte',
  'fitness',
  'cardio',
  'elliptical',
  'eliptica',
  'elíptica',
  'swimming',
  'natacion',
  'natación',
  'indoor',
  'outdoor',
  'virtual',
  'virtualride',
  'mountainbikeride',
  'gravelride',
  'treadmill',
  'cinta',
  'asfalto',
  'mywhoosh',
  'entrenamiento',
  'entreno',
  'workout',
  'actividad',
  'activity',
  'sesion',
  'sesión',
  'session',
  'fit',
  'gpx',
  'tcx',
  'dms',
  'xml',
  'json',
  'csv',
  'gps',
  'hitrack',
  'motion',
  'path',
  'detail',
  'data',
  'export',
  'untitled',
  'generic',
  'generico',
  'genérico',
  'other',
  'otro',
  'otra',
  'ruta',
  'route',
  'track',
  'trk',
  'strava',
  'huawei',
  'health',
  'sync',
  'garmin',
  'polar',
  'suunto',
  'coros',
  'mw',
  'act',
  'file',
  'archivo',
  'aire',
  'libre',
  'en',
  'de',
  'del',
  'la',
  'el',
  'los',
  'las',
  'al',
  'por',
  'con',
  'sin',
  'titulo',
  'título',
  'unknown',
  'desconocido',
  'desconocida',
  'interior',
  'exterior',
]);

const MONTH_DATE_RE =
  /\b(?:\d{1,2}\s+(?:ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic|jan|apr|aug|dec)[a-z]*\.?(?:\s+\d{2,4})?|(?:ene|feb|mar|abr|may|jun|jul|ago|sep|sept|oct|nov|dic|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{2,4})?)\b/gi;

export function formatActivityDateForTitle(startedAt: string): string {
  const ms = Date.parse(startedAt);
  const d = Number.isFinite(ms) ? new Date(ms) : new Date();
  return d.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function buildDefaultActivityTitle(sport: SportType, startedAt: string): string {
  return `${sportLabel(sport)} · ${formatActivityDateForTitle(startedAt)}`;
}

/**
 * Determina si una cadena representa un nombre concreto de actividad (más allá de
 * fechas, horas, IDs de archivo/dispositivo o nombres genéricos del tipo de deporte).
 */
export function hasConcreteActivityName(rawTitle?: string | null): boolean {
  if (!rawTitle) return false;
  let cleaned = rawTitle
    .trim()
    .replace(/\.(fit|gpx|tcx|dms|json|csv|zip|gz|xml)$/i, '');

  if (!cleaned) return false;

  // Quitar timestamps ISO, fechas YYYY-MM-DD / DD.MM.YYYY / YYYYMMDD y horas HH:MM(:SS) / HH.MM
  cleaned = cleaned
    .replace(/\b\d{4}[-./]\d{1,2}[-./]\d{1,2}(?:[T\s_]\d{1,2}[:.]\d{2}(?:[:.]\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?\b/gi, ' ')
    .replace(/\b\d{1,2}[-./]\d{1,2}[-./]\d{2,4}\b/g, ' ')
    .replace(/\b\d{1,2}[:.h]\d{2}(?:[:.]\d{2})?\b/gi, ' ')
    .replace(/\b\d{8}(?:[_-]\d{4,6})?\b/g, ' ')
    .replace(MONTH_DATE_RE, ' ')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, ' ');

  const tokens = cleaned
    .split(/[\s_\-·/|,:;()+]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  const meaningful = tokens.filter((tok) => {
    if (GENERIC_TOKENS.has(tok)) return false;
    if (/^\d+$/.test(tok)) return false;
    if (/^(?:mw|act|ht|trk|id)\d+$/i.test(tok)) return false;
    if (/^[a-f0-9]{7,}$/i.test(tok) && /\d/.test(tok)) return false;
    return true;
  });

  return meaningful.length > 0;
}

export function cleanImportedActivityTitle(rawTitle: string): string {
  return rawTitle
    .trim()
    .replace(/\.(fit|gpx|tcx|dms|json|csv|zip|gz|xml)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveActivityTitle(
  rawTitle: string | null | undefined,
  sport: SportType,
  startedAt: string
): string {
  if (rawTitle && hasConcreteActivityName(rawTitle)) {
    const cleaned = cleanImportedActivityTitle(rawTitle);
    if (cleaned) return cleaned;
  }
  return buildDefaultActivityTitle(sport, startedAt);
}
