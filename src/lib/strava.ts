import type { NextRequest } from 'next/server';
import { resolveActivityTitle } from '@/lib/activity-naming';
import { computeSessionExtras, enrichPointsTelemetry } from '@/lib/analytics';
import {
  createActivity,
  findActivityIdByExternalId,
  findDuplicateActivityId,
  getAthleteProfile,
  getDb,
  refreshActivityFromSource,
} from '@/lib/db';
import { calculateNormalizedPower, estimateActivityTSS } from '@/lib/metrics';
import { isMyWhooshContext, resolveMyWhooshWorldForActivity } from '@/lib/mywhoosh-maps';
import { detectMyWhooshWorld } from '@/lib/parsers/gpx';
import { decodePolyline, downsamplePoints } from '@/lib/polyline';
import type { ActivityLap, ActivityPoint, SportType, StravaConnectionStatus } from '@/types';

interface StravaDbRow {
  client_id: string | null;
  client_secret: string | null;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: number | null;
  athlete_id: number | null;
  athlete_name: string | null;
  last_sync_at: string | null;
}

function getStravaRow(): StravaDbRow {
  const row = getDb().prepare('SELECT * FROM strava_config WHERE id = 1').get() as StravaDbRow | undefined;
  return (
    row ?? {
      client_id: null,
      client_secret: null,
      access_token: null,
      refresh_token: null,
      expires_at: null,
      athlete_id: null,
      athlete_name: null,
      last_sync_at: null,
    }
  );
}

export function getEffectiveStravaCredentials(): { clientId: string | null; clientSecret: string | null; fromEnv: boolean } {
  const envId = process.env.STRAVA_CLIENT_ID?.trim() || null;
  const envSecret = process.env.STRAVA_CLIENT_SECRET?.trim() || null;
  if (envId && envSecret) {
    return { clientId: envId, clientSecret: envSecret, fromEnv: true };
  }
  const row = getStravaRow();
  return {
    clientId: row.client_id || null,
    clientSecret: row.client_secret || null,
    fromEnv: false,
  };
}

export function resolveRedirectUri(req?: NextRequest): string {
  if (process.env.STRAVA_REDIRECT_URI?.trim()) {
    return process.env.STRAVA_REDIRECT_URI.trim();
  }
  if (req) {
    const proto = req.headers.get('x-forwarded-proto') || (req.nextUrl.protocol ? req.nextUrl.protocol.replace(':', '') : 'http');
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
    return `${proto}://${host}/api/strava/callback`;
  }
  return 'http://localhost:3000/api/strava/callback';
}

export function getStravaStatus(req?: NextRequest): StravaConnectionStatus {
  const creds = getEffectiveStravaCredentials();
  const row = getStravaRow();
  return {
    configured: Boolean(creds.clientId && creds.clientSecret),
    connected: Boolean(row.refresh_token || row.access_token),
    hasEnvCredentials: creds.fromEnv,
    clientId: creds.clientId,
    athleteId: row.athlete_id,
    athleteName: row.athlete_name,
    lastSyncAt: row.last_sync_at,
    tokenExpiresAt: row.expires_at,
    redirectUriHint: resolveRedirectUri(req),
  };
}

export function saveStravaClientCredentials(clientId: string, clientSecret: string) {
  getDb()
    .prepare('UPDATE strava_config SET client_id = ?, client_secret = ? WHERE id = 1')
    .run(clientId.trim(), clientSecret.trim());
}

export function clearStravaTokens() {
  getDb()
    .prepare(
      'UPDATE strava_config SET access_token = NULL, refresh_token = NULL, expires_at = NULL, athlete_id = NULL, athlete_name = NULL WHERE id = 1'
    )
    .run();
}

export function buildStravaAuthorizeUrl(req: NextRequest): string {
  const creds = getEffectiveStravaCredentials();
  if (!creds.clientId) {
    throw new Error('Falta configurar el Client ID de Strava.');
  }
  const redirectUri = resolveRedirectUri(req);
  const url = new URL('https://www.strava.com/oauth/authorize');
  url.searchParams.set('client_id', creds.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('approval_prompt', 'auto');
  url.searchParams.set('scope', 'read,activity:read_all,profile:read_all');
  return url.toString();
}

export async function exchangeStravaCode(code: string) {
  const creds = getEffectiveStravaCredentials();
  if (!creds.clientId || !creds.clientSecret) {
    throw new Error('Faltan Client ID o Client Secret de Strava.');
  }

  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      code,
      grant_type: 'authorization_code',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Strava OAuth error (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
    athlete?: { id?: number; firstname?: string; lastname?: string };
  };

  const athleteName = data.athlete
    ? `${data.athlete.firstname ?? ''} ${data.athlete.lastname ?? ''}`.trim() || 'Atleta Strava'
    : 'Atleta Strava';

  getDb()
    .prepare(
      'UPDATE strava_config SET access_token = ?, refresh_token = ?, expires_at = ?, athlete_id = ?, athlete_name = ? WHERE id = 1'
    )
    .run(data.access_token, data.refresh_token, data.expires_at, data.athlete?.id ?? null, athleteName);

  return { athleteName, athleteId: data.athlete?.id ?? null };
}

export async function getValidStravaAccessToken(): Promise<string> {
  const row = getStravaRow();
  if (!row.refresh_token && !row.access_token) {
    throw new Error('No hay una cuenta de Strava vinculada todavía.');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (row.access_token && row.expires_at && row.expires_at > nowSec + 120) {
    return row.access_token;
  }

  const creds = getEffectiveStravaCredentials();
  if (!creds.clientId || !creds.clientSecret || !row.refresh_token) {
    throw new Error('No se puede refrescar el token de Strava: faltan credenciales o refresh_token.');
  }

  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: row.refresh_token,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Error al refrescar token Strava (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
  };

  getDb()
    .prepare('UPDATE strava_config SET access_token = ?, refresh_token = ?, expires_at = ? WHERE id = 1')
    .run(data.access_token, data.refresh_token, data.expires_at);

  return data.access_token;
}

export function mapStravaSport(
  stravaType: string,
  sportType: string,
  name: string,
  deviceName?: string,
  coords: Array<[number, number]> = []
): { sport: SportType; subSport: string; worldName?: string } {
  const t = (sportType || stravaType || '').toLowerCase();
  const titleLower = name.toLowerCase();
  const devLower = (deviceName || '').toLowerCase();
  const isVirtual =
    t === 'virtualride' ||
    devLower.includes('mywhoosh') ||
    titleLower.includes('mywhoosh') ||
    titleLower.includes('zwift') ||
    isMyWhooshContext({ title: name, deviceName, subSport: t === 'virtualride' ? 'virtual_activity' : t });

  const resolvedWorld = resolveMyWhooshWorldForActivity({
    worldName: isVirtual ? detectMyWhooshWorld(`${name} ${deviceName || ''}`) : undefined,
    title: name,
    subSport: isVirtual ? 'virtual_activity' : t,
    deviceName,
    coords,
  });

  if (isVirtual || (resolvedWorld && (t === 'ride' || t === 'virtualride'))) {
    return { sport: 'mywhoosh', subSport: 'MyWhoosh Indoor', worldName: resolvedWorld?.world.name };
  }
  if (t === 'trailrun') {
    return { sport: 'trail', subSport: 'Trail Running' };
  }
  if (t === 'walk') {
    return { sport: 'walking', subSport: 'Caminar' };
  }
  if (t === 'hike' || t === 'rockclimbing' || t === 'mountaineering' || t === 'backcountryski') {
    return { sport: 'mountain', subSport: t === 'hike' ? 'Senderismo' : 'Montaña' };
  }
  if (t === 'mountainbikeride' || t === 'gravelride' || t === 'ride' || t === 'ebikeride') {
    return {
      sport: 'cycling',
      subSport: t === 'mountainbikeride' ? 'MTB' : t === 'gravelride' ? 'Gravel' : 'Carretera',
    };
  }
  if (t === 'weighttraining' || t === 'workout' || t === 'crossfit' || t === 'yoga') {
    return { sport: 'strength', subSport: 'Fuerza / Entrenamiento' };
  }
  return { sport: 'running', subSport: 'Correr' };
}

interface StravaSummaryActivity {
  id: number;
  name: string;
  type: string;
  sport_type?: string;
  start_date: string;
  elapsed_time: number;
  moving_time: number;
  distance: number;
  total_elevation_gain: number;
  average_speed?: number;
  max_speed?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_watts?: number;
  weighted_average_watts?: number;
  max_watts?: number;
  average_cadence?: number;
  kilojoules?: number;
  calories?: number;
  device_name?: string;
  description?: string;
  perceived_exertion?: number;
  map?: { summary_polyline?: string };
  start_latlng?: [number, number];
}

async function fetchStravaStreams(accessToken: string, stravaId: number): Promise<ActivityPoint[]> {
  try {
    const res = await fetch(
      `https://www.strava.com/api/v3/activities/${stravaId}/streams?keys=time,latlng,altitude,heartrate,watts,cadence,velocity_smooth,distance,temp,grade_smooth&key_by_type=true`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    if (!res.ok) return [];
    const json = (await res.json()) as Record<string, { data?: unknown[] }>;
    const times = (json.time?.data as number[] | undefined) ?? [];
    if (times.length === 0) return [];

    const latlng = (json.latlng?.data as Array<[number, number]> | undefined) ?? [];
    const alt = (json.altitude?.data as number[] | undefined) ?? [];
    const hr = (json.heartrate?.data as number[] | undefined) ?? [];
    const watts = (json.watts?.data as number[] | undefined) ?? [];
    const cad = (json.cadence?.data as number[] | undefined) ?? [];
    const speed = (json.velocity_smooth?.data as number[] | undefined) ?? [];
    const dist = (json.distance?.data as number[] | undefined) ?? [];
    const temp = (json.temp?.data as number[] | undefined) ?? [];
    const grade = (json.grade_smooth?.data as number[] | undefined) ?? [];

    const points: ActivityPoint[] = [];
    for (let i = 0; i < times.length; i++) {
      points.push({
        t: times[i],
        lat: latlng[i]?.[0],
        lon: latlng[i]?.[1],
        ele: typeof alt[i] === 'number' ? Math.round(alt[i] * 10) / 10 : undefined,
        hr: typeof hr[i] === 'number' ? Math.round(hr[i]) : undefined,
        watts: typeof watts[i] === 'number' ? Math.round(watts[i]) : undefined,
        cad: typeof cad[i] === 'number' ? Math.round(cad[i]) : undefined,
        speed: typeof speed[i] === 'number' ? Math.round(speed[i] * 100) / 100 : undefined,
        dist: typeof dist[i] === 'number' ? Math.round(dist[i]) : undefined,
        temp: typeof temp[i] === 'number' ? Math.round(temp[i] * 10) / 10 : undefined,
        grade: typeof grade[i] === 'number' ? Math.round(grade[i] * 10) / 10 : undefined,
      });
    }
    return downsamplePoints(points, 1800);
  } catch {
    return [];
  }
}

async function fetchStravaLaps(accessToken: string, stravaId: number, sport: SportType): Promise<ActivityLap[]> {
  try {
    const res = await fetch(`https://www.strava.com/api/v3/activities/${stravaId}/laps`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return [];
    const list = (await res.json()) as Array<{
      lap_index?: number;
      name?: string;
      elapsed_time?: number;
      moving_time?: number;
      distance?: number;
      average_speed?: number;
      max_speed?: number;
      total_elevation_gain?: number;
      average_heartrate?: number;
      max_heartrate?: number;
      average_watts?: number;
      average_cadence?: number;
    }>;
    let cumDist = 0;
    return list.map((lap, idx) => {
      const dist = Math.round(lap.distance ?? 0);
      const startDistM = Math.round(cumDist);
      cumDist += dist;
      const rawCad = lap.average_cadence;
      const shouldDoubleLapCad =
        rawCad &&
        (((sport === 'running' || sport === 'trail' || sport === 'mountain') && rawCad < 115) ||
          (sport === 'walking' && rawCad < 80));
      const cad =
        rawCad
          ? shouldDoubleLapCad
            ? Math.round(rawCad * 2)
            : Math.round(rawCad)
          : null;
      return {
        lapNumber: lap.lap_index ?? idx + 1,
        name: lap.name || `Vuelta ${idx + 1}`,
        startDistM,
        endDistM: Math.round(cumDist),
        distanceMeters: dist,
        durationSec: Math.round(lap.elapsed_time ?? 0),
        movingTimeSec: Math.round(lap.moving_time ?? lap.elapsed_time ?? 0),
        avgSpeedMs: lap.average_speed ? Math.round(lap.average_speed * 100) / 100 : null,
        maxSpeedMs: lap.max_speed ? Math.round(lap.max_speed * 100) / 100 : null,
        elevationGain: Math.round(lap.total_elevation_gain ?? 0),
        elevationLoss: 0,
        avgHr: lap.average_heartrate ? Math.round(lap.average_heartrate) : null,
        maxHr: lap.max_heartrate ? Math.round(lap.max_heartrate) : null,
        avgWatts: lap.average_watts ? Math.round(lap.average_watts) : null,
        avgCadence: cad,
      };
    });
  } catch {
    return [];
  }
}

export async function syncStravaActivities(
  limit = 30,
  fetchStreams = true,
  refreshExisting = false
): Promise<{ imported: number; updated: number; skipped: number; totalFetched: number }> {
  const accessToken = await getValidStravaAccessToken();
  const profile = getAthleteProfile();

  const res = await fetch(`https://www.strava.com/api/v3/athlete/activities?per_page=${Math.min(50, limit)}&page=1`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Error al leer actividades de Strava (${res.status}): ${text}`);
  }

  const list = (await res.json()) as StravaSummaryActivity[];
  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const item of list) {
    const externalId = `strava_${item.id}`;
    const polylineCoords = item.map?.summary_polyline ? decodePolyline(item.map.summary_polyline) : [];
    const mapped = mapStravaSport(item.type, item.sport_type ?? item.type, item.name, item.device_name, polylineCoords);

    const existingId =
      findActivityIdByExternalId(externalId) ??
      findDuplicateActivityId(item.start_date, mapped.sport, item.distance ?? 0, externalId);

    if (existingId && !refreshExisting) {
      skipped++;
      continue;
    }

    let points: ActivityPoint[] = [];
    let laps: ActivityLap[] = [];
    if (fetchStreams && imported + updated < 30) {
      [points, laps] = await Promise.all([
        fetchStravaStreams(accessToken, item.id),
        fetchStravaLaps(accessToken, item.id, mapped.sport),
      ]);
    }

    const polyline = item.map?.summary_polyline || null;
    if (points.length === 0 && polylineCoords.length > 0) {
      points = polylineCoords.map(([lat, lon], idx) => ({
        t: Math.round((idx / Math.max(1, polylineCoords.length - 1)) * (item.moving_time || item.elapsed_time || 1)),
        lat,
        lon,
      }));
    }

    points = enrichPointsTelemetry(points, mapped.sport);

    let resolvedWorldName = mapped.worldName ?? null;
    if (!resolvedWorldName && mapped.sport === 'mywhoosh') {
      const pointCoords = points
        .filter((p): p is ActivityPoint & { lat: number; lon: number } => typeof p.lat === 'number' && typeof p.lon === 'number')
        .map((p) => [p.lat, p.lon] as [number, number]);
      resolvedWorldName =
        resolveMyWhooshWorldForActivity({
          title: item.name,
          sport: mapped.sport,
          subSport: mapped.subSport,
          deviceName: item.device_name,
          coords: pointCoords.length > 0 ? pointCoords : polylineCoords,
        })?.world.name ?? null;
    }

    const rawCad = item.average_cadence;
    const shouldDoubleSessionCad =
      rawCad &&
      (((mapped.sport === 'running' || mapped.sport === 'trail' || mapped.sport === 'mountain') && rawCad < 115) ||
        (mapped.sport === 'walking' && rawCad < 80));
    const adjustedCadence =
      rawCad
        ? shouldDoubleSessionCad
          ? Math.round(rawCad * 2)
          : Math.round(rawCad)
        : null;

    const np =
      item.weighted_average_watts ??
      (points.length > 10 ? calculateNormalizedPower(points) : null) ??
      (item.average_watts ? Math.round(item.average_watts) : null);

    const tss = estimateActivityTSS(
      {
        sport: mapped.sport,
        durationSec: item.elapsed_time ?? item.moving_time ?? 0,
        movingTimeSec: item.moving_time ?? item.elapsed_time ?? 0,
        avgWatts: item.average_watts ?? null,
        normalizedPower: np,
        avgHr: item.average_heartrate ?? null,
        rpe: item.perceived_exertion ?? null,
        elevationGain: item.total_elevation_gain ?? 0,
      },
      profile
    );

    const extras = computeSessionExtras(
      {
        sport: mapped.sport,
        durationSec: Math.round(item.elapsed_time ?? 0),
        movingTimeSec: Math.round(item.moving_time ?? item.elapsed_time ?? 0),
        distanceMeters: Math.round(item.distance ?? 0),
        elevationGain: Math.round(item.total_elevation_gain ?? 0),
        avgSpeedMs: item.average_speed ?? null,
        avgHr: item.average_heartrate ? Math.round(item.average_heartrate) : null,
        avgWatts: item.average_watts ? Math.round(item.average_watts) : null,
        normalizedPower: np,
        extras: {
          deviceName: item.device_name ?? null,
          workKj: item.kilojoules ? Math.round(item.kilojoules) : null,
        },
      },
      points
    );

    const resolvedTitle = resolveActivityTitle(item.name, mapped.sport, item.start_date);
    const durationSec = Math.round(item.elapsed_time ?? 0);
    const movingTimeSec = Math.round(item.moving_time ?? item.elapsed_time ?? 0);
    const distanceMeters = Math.round(item.distance ?? 0);
    const elevationGain = Math.round(item.total_elevation_gain ?? 0);
    const calories = item.calories ? Math.round(item.calories) : item.kilojoules ? Math.round(item.kilojoules * 1.05) : null;

    if (existingId && refreshExisting) {
      refreshActivityFromSource(existingId, {
        externalId,
        sport: mapped.sport,
        subSport: mapped.subSport,
        title: resolvedTitle,
        description: item.description ?? (item.device_name ? `Grabado con ${item.device_name}` : null),
        startedAt: item.start_date,
        durationSec,
        movingTimeSec,
        distanceMeters,
        elevationGain,
        elevationLoss: elevationGain,
        avgSpeedMs: item.average_speed ?? null,
        maxSpeedMs: item.max_speed ?? null,
        avgHr: item.average_heartrate ? Math.round(item.average_heartrate) : null,
        maxHr: item.max_heartrate ? Math.round(item.max_heartrate) : null,
        avgWatts: item.average_watts ? Math.round(item.average_watts) : null,
        normalizedPower: np,
        maxWatts: item.max_watts ? Math.round(item.max_watts) : null,
        avgCadence: adjustedCadence,
        calories,
        tss,
        worldName: resolvedWorldName,
        polyline,
        startLat: item.start_latlng?.[0] ?? points[0]?.lat ?? null,
        startLon: item.start_latlng?.[1] ?? points[0]?.lon ?? null,
        points,
        laps,
        extras,
      });
      updated++;
      continue;
    }

    createActivity({
      id: `act_strava_${item.id}`,
      externalId,
      source: 'strava',
      sport: mapped.sport,
      subSport: mapped.subSport,
      title: resolvedTitle,
      description: item.description ?? (item.device_name ? `Grabado con ${item.device_name}` : null),
      startedAt: item.start_date,
      durationSec,
      movingTimeSec,
      distanceMeters,
      elevationGain,
      elevationLoss: elevationGain,
      avgSpeedMs: item.average_speed ?? null,
      maxSpeedMs: item.max_speed ?? null,
      avgHr: item.average_heartrate ? Math.round(item.average_heartrate) : null,
      maxHr: item.max_heartrate ? Math.round(item.max_heartrate) : null,
      avgWatts: item.average_watts ? Math.round(item.average_watts) : null,
      normalizedPower: np,
      maxWatts: item.max_watts ? Math.round(item.max_watts) : null,
      avgCadence: adjustedCadence,
      calories,
      tss,
      rpe: item.perceived_exertion ?? null,
      gearId: null,
      worldName: resolvedWorldName,
      polyline,
      startLat: item.start_latlng?.[0] ?? points[0]?.lat ?? null,
      startLon: item.start_latlng?.[1] ?? points[0]?.lon ?? null,
      points,
      strengthLogs: [],
      totalVolumeKg: null,
      laps,
      extras,
      createdAt: new Date().toISOString(),
    });

    imported++;
  }

  getDb().prepare('UPDATE strava_config SET last_sync_at = ? WHERE id = 1').run(new Date().toISOString());

  return { imported, updated, skipped, totalFetched: list.length };
}
