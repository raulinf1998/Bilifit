import type { ActivityPoint } from '@/types';

/**
 * Decodifica una polilínea codificada de Google/Strava en pares [lat, lon].
 */
export function decodePolyline(encoded: string): Array<[number, number]> {
  if (!encoded) return [];
  const points: Array<[number, number]> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      if (index >= encoded.length) break;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push([lat / 1e5, lng / 1e5]);
  }

  return points;
}

/**
 * Codifica coordenadas [lat, lon] en formato polilínea de Google/Strava.
 */
export function encodePolyline(coords: Array<[number, number]>): string {
  let result = '';
  let prevLat = 0;
  let prevLng = 0;

  for (const [lat, lng] of coords) {
    const latInt = Math.round(lat * 1e5);
    const lngInt = Math.round(lng * 1e5);
    result += encodeSigned(latInt - prevLat);
    result += encodeSigned(lngInt - prevLng);
    prevLat = latInt;
    prevLng = lngInt;
  }

  return result;
}

function encodeSigned(value: number): string {
  let sgnNum = value << 1;
  if (value < 0) sgnNum = ~sgnNum;
  let encoded = '';
  while (sgnNum >= 0x20) {
    encoded += String.fromCharCode((0x20 | (sgnNum & 0x1f)) + 63);
    sgnNum >>= 5;
  }
  encoded += String.fromCharCode(sgnNum + 63);
  return encoded;
}

/**
 * Distancia Haversine entre dos coordenadas GPS en metros.
 */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calcula desnivel positivo y negativo acumulado con un umbral de histéresis
 * para filtrar el ruido típico del GPS/barómetro en montaña.
 */
export function computeElevationGainLoss(
  points: Array<{ ele?: number }>,
  thresholdMeters = 2.5
): { gain: number; loss: number; maxEle: number; minEle: number } {
  const elevations = points.map((p) => p.ele).filter((e): e is number => typeof e === 'number' && Number.isFinite(e));
  if (elevations.length === 0) {
    return { gain: 0, loss: 0, maxEle: 0, minEle: 0 };
  }

  let gain = 0;
  let loss = 0;
  let refEle = elevations[0];
  let maxEle = elevations[0];
  let minEle = elevations[0];

  for (let i = 1; i < elevations.length; i++) {
    const ele = elevations[i];
    if (ele > maxEle) maxEle = ele;
    if (ele < minEle) minEle = ele;

    const diff = ele - refEle;
    if (diff >= thresholdMeters) {
      gain += diff;
      refEle = ele;
    } else if (diff <= -thresholdMeters) {
      loss += Math.abs(diff);
      refEle = ele;
    }
  }

  return {
    gain: Math.round(gain),
    loss: Math.round(loss),
    maxEle: Math.round(maxEle),
    minEle: Math.round(minEle),
  };
}

/**
 * Reduce una serie de puntos GPS/telemetría conservando la fidelidad de ruta y métricas.
 */
export function downsamplePoints(points: ActivityPoint[], maxPoints = 1800): ActivityPoint[] {
  if (points.length <= maxPoints) return points;
  const step = (points.length - 1) / (maxPoints - 1);
  const result: ActivityPoint[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.min(points.length - 1, Math.round(i * step));
    result.push(points[idx]);
  }
  return result;
}
