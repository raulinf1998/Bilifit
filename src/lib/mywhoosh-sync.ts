import crypto from 'node:crypto';
import net from 'node:net';
import { currentAccountId } from '@/lib/account-context';
import type { AccountId } from '@/lib/accounts';
import { hasConcreteActivityName, resolveActivityTitle } from '@/lib/activity-naming';
import { decryptSecret, encryptSecret } from '@/lib/crypto';
import {
  createActivity,
  findDuplicateActivityId,
  getAthleteProfile,
  getDb,
  hasActivityWithExternalId,
} from '@/lib/db';
import { estimateActivityTSS } from '@/lib/metrics';
import { resolveMyWhooshWorldForActivity } from '@/lib/mywhoosh-maps';
import { parseUploadedActivityFile, sniffActivityFormat } from '@/lib/parsers';
import { detectMyWhooshWorld } from '@/lib/parsers/gpx';
import type { MyWhooshConnectionStatus, MyWhooshImportLog, MyWhooshSyncResult } from '@/types';

export const MYWHOOSH_LOGIN_URL = 'https://services.mywhoosh.com/http-service/api/login';
export const MYWHOOSH_REFRESH_URL = 'https://services.mywhoosh.com/http-service/api/tokens/generate';
export const MYWHOOSH_PLAYER_DATA_URL = 'https://services.mywhoosh.com/http-service/v1/player/player-data';
export const MYWHOOSH_ACTIVITIES_URL = 'https://service14.mywhoosh.com/v2/rider/profile/activities';
export const MYWHOOSH_DOWNLOAD_URL = 'https://service14.mywhoosh.com/v2/rider/profile/download-activity-file';

const MYWHOOSH_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36';
const ALLOWED_DOWNLOAD_HOST_SUFFIXES = ['.amazonaws.com', '.amazonaws.com.cn', '.mywhoosh.com', '.cloudfront.net'];
const MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024;
const STALE_LOCK_MS = 15 * 60 * 1000;
const REFRESH_MARGIN_SEC = 3 * 24 * 3600; // Renovar si al access token (~15d) le quedan menos de 3 días

export type FetchLike = typeof fetch;

interface MyWhooshDbRow {
  email: string | null;
  password_enc: string | null;
  access_token: string | null;
  refresh_token: string | null;
  whoosh_id: string | null;
  device_id: string | null;
  rider_name: string | null;
  ftp_watts: number | null;
  token_expires_at: number | null;
  auto_sync_enabled: number;
  sync_interval_min: number;
  sync_in_progress: number;
  sync_started_at: string | null;
  last_sync_at: string | null;
  last_sync_status: string;
  last_error: string | null;
}

export interface MyWhooshRemoteActivity {
  activityId: string;
  activityFileId: string;
  title: string;
  startedAt: string | null;
  worldHint: string | null;
  distanceKm: number | null;
  durationSec: number | null;
}

const inFlightSyncByAccount = new Map<AccountId, Promise<MyWhooshSyncResult>>();

function ensureMyWhooshConfigRow(): MyWhooshDbRow {
  const db = getDb();
  let row = db.prepare('SELECT * FROM mywhoosh_config WHERE id = 1').get() as MyWhooshDbRow | undefined;
  if (!row) {
    db.prepare('INSERT OR IGNORE INTO mywhoosh_config (id) VALUES (1)').run();
    row = db.prepare('SELECT * FROM mywhoosh_config WHERE id = 1').get() as MyWhooshDbRow | undefined;
  }
  return (
    row ?? {
      email: null,
      password_enc: null,
      access_token: null,
      refresh_token: null,
      whoosh_id: null,
      device_id: null,
      rider_name: null,
      ftp_watts: null,
      token_expires_at: null,
      auto_sync_enabled: 0,
      sync_interval_min: 15,
      sync_in_progress: 0,
      sync_started_at: null,
      last_sync_at: null,
      last_sync_status: 'idle',
      last_error: null,
    }
  );
}

export function getMyWhooshEnvCredentials(): {
  email: string | null;
  password: string | null;
  autoSync: boolean;
  intervalMin: number | null;
} {
  if (currentAccountId() !== 'raul') {
    return { email: null, password: null, autoSync: false, intervalMin: null };
  }
  const email = process.env.MYWHOOSH_EMAIL?.trim() || process.env.MYWHOOSH_USERNAME?.trim() || null;
  const password = process.env.MYWHOOSH_PASSWORD?.trim() || null;
  const autoSyncRaw = process.env.MYWHOOSH_AUTO_SYNC?.trim().toLowerCase();
  const autoSync = autoSyncRaw === '1' || autoSyncRaw === 'true';
  const intervalParsed = Number(process.env.MYWHOOSH_SYNC_INTERVAL_MIN);
  const intervalMin =
    Number.isFinite(intervalParsed) && intervalParsed >= 5 && intervalParsed <= 1440 ? Math.round(intervalParsed) : null;
  return { email: email && password ? email : null, password: email && password ? password : null, autoSync, intervalMin };
}

export { decryptSecret, encryptSecret };

export function decodeJwtExpiry(token: string | null | undefined): number | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as { exp?: unknown };
    return typeof json.exp === 'number' && Number.isFinite(json.exp) ? Math.round(json.exp) : null;
  } catch {
    return null;
  }
}

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.local') || lower.endsWith('.internal')) return true;
  const ipVer = net.isIP(lower);
  if (ipVer === 4) {
    const parts = lower.split('.').map(Number);
    if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    return false;
  }
  if (ipVer === 6) {
    if (lower === '::1' || lower === '::' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) {
      return true;
    }
  }
  return false;
}

export function validateMyWhooshDownloadUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('MyWhoosh devolvió una URL de descarga inválida.');
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || parsed.hash) {
    throw new Error('MyWhoosh devolvió una URL de descarga insegura.');
  }
  if (parsed.port && parsed.port !== '443') {
    throw new Error('MyWhoosh devolvió un puerto no permitido en la descarga.');
  }
  const host = parsed.hostname.toLowerCase();
  if (isPrivateOrLoopbackHost(host)) {
    throw new Error('La URL de descarga apunta a una dirección privada no permitida.');
  }
  if (!ALLOWED_DOWNLOAD_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix) || host === suffix.slice(1))) {
    throw new Error(`Host de descarga de MyWhoosh no reconocido (${host}).`);
  }
  return parsed;
}

export function parseMyWhooshTimestamp(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = raw > 1e12 ? raw : raw * 1000;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) && d.getUTCFullYear() >= 2015 && d.getUTCFullYear() <= 2036 ? d.toISOString() : null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      return parseMyWhooshTimestamp(Number(trimmed));
    }
    const ms = Date.parse(trimmed);
    if (Number.isFinite(ms)) {
      const d = new Date(ms);
      if (d.getUTCFullYear() >= 2015 && d.getUTCFullYear() <= 2036) {
        return d.toISOString();
      }
    }
  }
  return null;
}

export function parseMyWhooshActivityPage(
  rawPayload: unknown,
  requestedPage: number
): { items: MyWhooshRemoteActivity[]; totalPages: number | null; hasMore: boolean } {
  if (!rawPayload || typeof rawPayload !== 'object') {
    throw new Error('Respuesta inesperada de la lista de actividades de MyWhoosh.');
  }
  const obj = rawPayload as Record<string, unknown>;
  if (obj.Success === false || obj.error === true) {
    throw new Error(String(obj.Message || obj.message || 'MyWhoosh rechazó la consulta de actividades.'));
  }

  const dataObj = obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data) ? (obj.data as Record<string, unknown>) : null;
  const rawList =
    (dataObj?.results as unknown[]) ??
    (obj.results as unknown[]) ??
    (Array.isArray(obj.data) ? obj.data : null) ??
    (obj.activities as unknown[]) ??
    (obj.rides as unknown[]) ??
    (Array.isArray(rawPayload) ? rawPayload : null);

  if (!Array.isArray(rawList)) {
    throw new Error('MyWhoosh no devolvió una lista de actividades reconocible.');
  }

  const items: MyWhooshRemoteActivity[] = [];
  for (const entry of rawList) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const activityId = String(row.id ?? row._id ?? row.activityId ?? row.activity_id ?? '').trim();
    const activityFileId = String(
      row.activityFileId ?? row.activity_file_id ?? row.fileId ?? row.file_id ?? ''
    ).trim();
    if (!activityId) continue;

    const titleRaw = row.title ?? row.name ?? row.routeName ?? row.workoutName ?? 'Sesión MyWhoosh';
    const title = String(titleRaw || 'Sesión MyWhoosh').trim() || 'Sesión MyWhoosh';
    const startedAt =
      parseMyWhooshTimestamp(row.startDatetime) ??
      parseMyWhooshTimestamp(row.start_datetime) ??
      parseMyWhooshTimestamp(row.startTime) ??
      parseMyWhooshTimestamp(row.date) ??
      parseMyWhooshTimestamp(row.createdAt) ??
      parseMyWhooshTimestamp(row.timestamp);

    const worldHintRaw = row.worldName ?? row.world ?? row.routeName ?? row.route ?? row.mapName ?? row.levelName ?? null;
    const worldHint = worldHintRaw ? String(worldHintRaw).trim() : null;
    const distNum = row.distance !== undefined && row.distance !== null ? Number(row.distance) : NaN;
    const distanceKm = Number.isFinite(distNum) && distNum > 0 ? distNum : null;
    const durNum = row.duration !== undefined && row.duration !== null ? Number(row.duration) : NaN;
    const durationSec = Number.isFinite(durNum) && durNum > 0 ? Math.round(durNum) : null;

    items.push({
      activityId,
      activityFileId,
      title,
      startedAt,
      worldHint,
      distanceKm,
      durationSec,
    });
  }

  const meta = dataObj ?? obj;
  const rawTotalPages = meta.totalPages ?? meta.total_pages;
  const totalPages = typeof rawTotalPages === 'number' && Number.isFinite(rawTotalPages) ? rawTotalPages : null;
  const rawHasNext = meta.hasNextPage ?? meta.hasNext;
  const hasMore =
    typeof rawHasNext === 'boolean'
      ? rawHasNext
      : totalPages !== null
        ? requestedPage < totalPages
        : items.length > 0;

  return { items, totalPages, hasMore };
}

export function extractMyWhooshActivityBuffer(
  rawBuffer: Buffer,
  activityId: string
): { fileName: string; buffer: Buffer } {
  const format = sniffActivityFormat(rawBuffer);
  if (!format) {
    const preview = rawBuffer.subarray(0, 80).toString('utf8').replace(/\s+/g, ' ').trim();
    throw new Error(`Formato de actividad MyWhoosh no reconocido (${preview || 'binario vacío'}).`);
  }
  const safeId = activityId.replace(/[^A-Za-z0-9_-]/g, '_');
  return {
    fileName: `mywhoosh_${safeId}${format}`,
    buffer: rawBuffer,
  };
}

export function getMyWhooshStatus(): MyWhooshConnectionStatus {
  const row = ensureMyWhooshConfigRow();
  const envCreds = getMyWhooshEnvCredentials();
  const db = getDb();

  const importedCountRow = db
    .prepare("SELECT COUNT(*) as c FROM activities WHERE source = 'mywhoosh' OR external_id LIKE 'mywhoosh_%'")
    .get() as { c: number };

  const recentRows = db
    .prepare('SELECT * FROM mywhoosh_imports ORDER BY imported_at DESC LIMIT 12')
    .all() as Array<Record<string, unknown>>;

  const recentImports: MyWhooshImportLog[] = recentRows.map((r) => ({
    activityId: String(r.activity_id),
    activityFileId: r.activity_file_id ? String(r.activity_file_id) : null,
    localActivityId: r.local_activity_id ? String(r.local_activity_id) : null,
    title: String(r.title),
    startedAt: r.started_at ? String(r.started_at) : null,
    status: (String(r.status || 'imported') as MyWhooshImportLog['status']),
    error: r.error ? String(r.error) : null,
    importedAt: String(r.imported_at),
  }));

  const isStaleLock =
    row.sync_in_progress === 1 &&
    row.sync_started_at &&
    Date.now() - Date.parse(row.sync_started_at) > STALE_LOCK_MS;

  return {
    connected: Boolean(row.access_token || envCreds.email),
    hasEnvCredentials: Boolean(envCreds.email && envCreds.password),
    hasSavedPassword: Boolean(row.password_enc),
    email: row.email || envCreds.email || null,
    whooshId: row.whoosh_id || null,
    riderName: row.rider_name || null,
    ftpWatts: row.ftp_watts ?? null,
    autoSyncEnabled: Boolean(row.auto_sync_enabled) || (envCreds.autoSync && Boolean(envCreds.email)),
    syncIntervalMin: row.sync_interval_min || envCreds.intervalMin || 15,
    syncInProgress: Boolean(row.sync_in_progress && !isStaleLock),
    lastSyncAt: row.last_sync_at || null,
    lastSyncStatus: (row.last_sync_status as MyWhooshConnectionStatus['lastSyncStatus']) || 'idle',
    lastError: row.last_error || null,
    tokenExpiresAt: row.token_expires_at ?? decodeJwtExpiry(row.access_token),
    importedCount: importedCountRow.c,
    recentImports,
  };
}

export function updateMyWhooshSyncPreferences(patch: { autoSyncEnabled?: boolean; syncIntervalMin?: number }): MyWhooshConnectionStatus {
  const row = ensureMyWhooshConfigRow();
  const nextAuto = patch.autoSyncEnabled !== undefined ? (patch.autoSyncEnabled ? 1 : 0) : row.auto_sync_enabled;
  const nextInterval =
    patch.syncIntervalMin !== undefined && Number.isFinite(patch.syncIntervalMin)
      ? Math.max(5, Math.min(1440, Math.round(patch.syncIntervalMin)))
      : row.sync_interval_min || 15;

  getDb()
    .prepare('UPDATE mywhoosh_config SET auto_sync_enabled = ?, sync_interval_min = ? WHERE id = 1')
    .run(nextAuto, nextInterval);

  return getMyWhooshStatus();
}

export function disconnectMyWhoosh(): MyWhooshConnectionStatus {
  ensureMyWhooshConfigRow();
  getDb()
    .prepare(`
      UPDATE mywhoosh_config
      SET email = NULL,
          password_enc = NULL,
          access_token = NULL,
          refresh_token = NULL,
          whoosh_id = NULL,
          rider_name = NULL,
          ftp_watts = NULL,
          token_expires_at = NULL,
          auto_sync_enabled = 0,
          sync_in_progress = 0,
          sync_started_at = NULL,
          last_sync_status = 'idle',
          last_error = NULL
      WHERE id = 1
    `)
    .run();
  return getMyWhooshStatus();
}

async function loginToMyWhoosh(
  email: string,
  password: string,
  deviceId: string,
  fetchImpl: FetchLike = fetch
): Promise<{ accessToken: string; refreshToken: string | null; whooshId: string; expiresAt: number | null }> {
  const res = await fetchImpl(MYWHOOSH_LOGIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain, */*',
      'User-Agent': MYWHOOSH_USER_AGENT,
    },
    body: JSON.stringify({
      Username: email.trim(),
      Password: password,
      Platform: 'Android',
      Action: 1001,
      CorrelationId: crypto.randomUUID(),
      DeviceId: deviceId,
      Authorization: '',
    }),
    signal: AbortSignal.timeout(25_000),
  });

  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new Error(`MyWhoosh devolvió una respuesta no JSON en el login (HTTP ${res.status}).`);
  }

  if (!res.ok || data.Success !== true) {
    const rawMsg = String(data.Message || data.message || '').trim();
    const hint =
      res.status === 401 || /invalid|password|incorrect|credential|user/i.test(rawMsg)
        ? ' Si entrabas con Google o Apple en MyWhoosh, configura primero una contraseña en tu cuenta de MyWhoosh.'
        : '';
    throw new Error(`Login de MyWhoosh rechazado${rawMsg ? `: ${rawMsg}` : ` (HTTP ${res.status})`}.${hint}`);
  }

  const accessToken = String(data.AccessToken || '').trim();
  const refreshToken = data.RefreshToken ? String(data.RefreshToken).trim() : null;
  const whooshId = data.WhooshId !== undefined && data.WhooshId !== null ? String(data.WhooshId).trim() : '';

  if (!accessToken || !whooshId) {
    throw new Error('MyWhoosh no devolvió AccessToken o WhooshId válidos tras el login.');
  }

  return {
    accessToken,
    refreshToken,
    whooshId,
    expiresAt: decodeJwtExpiry(accessToken),
  };
}

async function refreshMyWhooshToken(
  refreshToken: string,
  fetchImpl: FetchLike = fetch
): Promise<{ accessToken: string; refreshToken: string | null; whooshId: string | null; expiresAt: number | null } | null> {
  try {
    const res = await fetchImpl(MYWHOOSH_REFRESH_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': MYWHOOSH_USER_AGENT,
        Authorization: `Bearer ${refreshToken}`,
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    const accessToken = data.AccessToken ? String(data.AccessToken).trim() : '';
    if (!accessToken) return null;
    return {
      accessToken,
      refreshToken: data.RefreshToken ? String(data.RefreshToken).trim() : refreshToken,
      whooshId: data.WhooshId ? String(data.WhooshId).trim() : null,
      expiresAt: decodeJwtExpiry(accessToken),
    };
  } catch {
    return null;
  }
}

async function fetchMyWhooshRiderProfile(
  accessToken: string,
  whooshId: string,
  deviceId: string,
  fetchImpl: FetchLike = fetch
): Promise<{ riderName: string | null; ftpWatts: number | null }> {
  try {
    const res = await fetchImpl(MYWHOOSH_PLAYER_DATA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': MYWHOOSH_USER_AGENT,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        WhooshId: whooshId,
        Action: 1052,
        CorrelationId: crypto.randomUUID(),
        DeviceId: deviceId,
        Authorization: '',
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { riderName: null, ftpWatts: null };
    const data = (await res.json()) as {
      PlayerDataStruct?: {
        PlayerProfileStruct?: { PlayerFirstName?: string; PlayerLastName?: string; fullName?: string };
        PlayerPersonalStruct?: { FtpPlayer?: number };
      };
    };
    const prof = data?.PlayerDataStruct?.PlayerProfileStruct;
    const personal = data?.PlayerDataStruct?.PlayerPersonalStruct;
    const fullName =
      prof?.fullName?.trim() ||
      [prof?.PlayerFirstName, prof?.PlayerLastName].filter(Boolean).join(' ').trim() ||
      null;
    const ftp =
      typeof personal?.FtpPlayer === 'number' && Number.isFinite(personal.FtpPlayer) && personal.FtpPlayer > 30
        ? Math.round(personal.FtpPlayer)
        : null;
    return { riderName: fullName, ftpWatts: ftp };
  } catch {
    return { riderName: null, ftpWatts: null };
  }
}

export async function connectMyWhooshAccount(
  input: {
    email?: string;
    password?: string;
    rememberPassword?: boolean;
    autoSyncEnabled?: boolean;
    syncIntervalMin?: number;
    useEnv?: boolean;
  },
  fetchImpl: FetchLike = fetch
): Promise<MyWhooshConnectionStatus> {
  const row = ensureMyWhooshConfigRow();
  const envCreds = getMyWhooshEnvCredentials();

  const email = input.useEnv ? envCreds.email : input.email?.trim() || envCreds.email;
  const password = input.useEnv ? envCreds.password : input.password || envCreds.password;

  if (!email || !password) {
    throw new Error('Introduce tu email y contraseña de MyWhoosh (o defínelos en MYWHOOSH_EMAIL / MYWHOOSH_PASSWORD).');
  }

  const deviceId = row.device_id || crypto.randomUUID();
  const login = await loginToMyWhoosh(email, password, deviceId, fetchImpl);
  const rider = await fetchMyWhooshRiderProfile(login.accessToken, login.whooshId, deviceId, fetchImpl);

  const passwordEnc = input.rememberPassword ? encryptSecret(password) : null;
  const autoSync = input.autoSyncEnabled !== undefined ? (input.autoSyncEnabled ? 1 : 0) : row.auto_sync_enabled;
  const syncInterval =
    input.syncIntervalMin !== undefined && Number.isFinite(input.syncIntervalMin)
      ? Math.max(5, Math.min(1440, Math.round(input.syncIntervalMin)))
      : row.sync_interval_min || 15;

  getDb()
    .prepare(`
      UPDATE mywhoosh_config
      SET email = ?,
          password_enc = ?,
          access_token = ?,
          refresh_token = ?,
          whoosh_id = ?,
          device_id = ?,
          rider_name = ?,
          ftp_watts = ?,
          token_expires_at = ?,
          auto_sync_enabled = ?,
          sync_interval_min = ?,
          last_sync_status = 'idle',
          last_error = NULL
      WHERE id = 1
    `)
    .run(
      email,
      passwordEnc,
      login.accessToken,
      login.refreshToken,
      login.whooshId,
      deviceId,
      rider.riderName ?? email.split('@')[0],
      rider.ftpWatts,
      login.expiresAt,
      autoSync,
      syncInterval
    );

  return getMyWhooshStatus();
}

async function resolveValidAccessToken(
  forceReauth: boolean,
  fetchImpl: FetchLike = fetch
): Promise<{ accessToken: string; whooshId: string | null; deviceId: string }> {
  const row = ensureMyWhooshConfigRow();
  const envCreds = getMyWhooshEnvCredentials();
  const deviceId = row.device_id || crypto.randomUUID();
  const nowSec = Math.floor(Date.now() / 1000);

  if (!forceReauth && row.access_token) {
    const exp = row.token_expires_at ?? decodeJwtExpiry(row.access_token);
    if (!exp || exp > nowSec + REFRESH_MARGIN_SEC) {
      return { accessToken: row.access_token, whooshId: row.whoosh_id, deviceId };
    }
    if (row.refresh_token) {
      const refreshed = await refreshMyWhooshToken(row.refresh_token, fetchImpl);
      if (refreshed) {
        getDb()
          .prepare('UPDATE mywhoosh_config SET access_token = ?, refresh_token = ?, token_expires_at = ? WHERE id = 1')
          .run(refreshed.accessToken, refreshed.refreshToken, refreshed.expiresAt);
        return { accessToken: refreshed.accessToken, whooshId: refreshed.whooshId ?? row.whoosh_id, deviceId };
      }
    }
    if (exp > nowSec + 120) {
      return { accessToken: row.access_token, whooshId: row.whoosh_id, deviceId };
    }
  }

  // Intentar refrescar con refresh_token si estamos forzando por 401
  if (forceReauth && row.refresh_token) {
    const refreshed = await refreshMyWhooshToken(row.refresh_token, fetchImpl);
    if (refreshed) {
      getDb()
        .prepare('UPDATE mywhoosh_config SET access_token = ?, refresh_token = ?, token_expires_at = ? WHERE id = 1')
        .run(refreshed.accessToken, refreshed.refreshToken, refreshed.expiresAt);
      return { accessToken: refreshed.accessToken, whooshId: refreshed.whooshId ?? row.whoosh_id, deviceId };
    }
  }

  // Fallback a contraseña guardada cifrada o variables de entorno
  const savedPassword = row.password_enc ? decryptSecret(row.password_enc) : null;
  const email = row.email || envCreds.email;
  const password = savedPassword || (email && envCreds.email && email === envCreds.email ? envCreds.password : envCreds.password);

  if (email && password) {
    const login = await loginToMyWhoosh(email, password, deviceId, fetchImpl);
    getDb()
      .prepare('UPDATE mywhoosh_config SET email = ?, access_token = ?, refresh_token = ?, whoosh_id = ?, device_id = ?, token_expires_at = ? WHERE id = 1')
      .run(email, login.accessToken, login.refreshToken, login.whooshId, deviceId, login.expiresAt);
    return { accessToken: login.accessToken, whooshId: login.whooshId, deviceId };
  }

  getDb()
    .prepare("UPDATE mywhoosh_config SET last_sync_status = 'needs_reconnect', last_error = ? WHERE id = 1")
    .run('La sesión de MyWhoosh caducó. Vuelve a iniciar sesión.');
  throw new Error('Tu sesión de MyWhoosh ha caducado o no está configurada. Conecta tu cuenta de nuevo.');
}

async function authorizedMyWhooshPost<T = unknown>(
  url: string,
  body: Record<string, unknown>,
  fetchImpl: FetchLike = fetch
): Promise<T> {
  let session = await resolveValidAccessToken(false, fetchImpl);

  const attempt = async (token: string) =>
    fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': MYWHOOSH_USER_AGENT,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

  let res = await attempt(session.accessToken);
  if (res.status === 401 || res.status === 403) {
    session = await resolveValidAccessToken(true, fetchImpl);
    res = await attempt(session.accessToken);
  }

  if (res.status === 429) {
    throw new Error('MyWhoosh limitó temporalmente las peticiones (HTTP 429). Inténtalo en unos minutos.');
  }
  if (res.status === 401 || res.status === 403) {
    getDb()
      .prepare("UPDATE mywhoosh_config SET last_sync_status = 'needs_reconnect', last_error = ? WHERE id = 1")
      .run('Sesión rechazada por MyWhoosh (401).');
    throw new Error('MyWhoosh rechazó el token actual. Vuelve a iniciar sesión con tu cuenta.');
  }
  if (!res.ok) {
    throw new Error(`Error de la API de MyWhoosh (${res.status}) al consultar ${new URL(url).pathname}`);
  }

  return (await res.json()) as T;
}

async function downloadSignedMyWhooshFile(
  activityFileId: string,
  fetchImpl: FetchLike = fetch
): Promise<Buffer> {
  const payload = await authorizedMyWhooshPost<Record<string, unknown>>(
    MYWHOOSH_DOWNLOAD_URL,
    { fileId: activityFileId },
    fetchImpl
  );
  const rawUrl = typeof payload.data === 'string' ? payload.data : typeof payload.url === 'string' ? payload.url : '';
  if (!rawUrl) {
    throw new Error('MyWhoosh no devolvió una URL de descarga para esta actividad.');
  }
  const safeUrl = validateMyWhooshDownloadUrl(rawUrl);

  let currentUrl = safeUrl.toString();
  let fileRes: Response | null = null;
  for (let hop = 0; hop < 3; hop++) {
    const res = await fetchImpl(currentUrl, {
      method: 'GET',
      headers: { 'User-Agent': MYWHOOSH_USER_AGENT },
      redirect: 'manual',
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) break;
      currentUrl = validateMyWhooshDownloadUrl(new URL(location, currentUrl).toString()).toString();
      continue;
    }
    fileRes = res;
    break;
  }

  if (!fileRes) {
    throw new Error('Demasiadas redirecciones al descargar archivo de MyWhoosh S3.');
  }
  if (!fileRes.ok) {
    throw new Error(`Error descargando archivo de MyWhoosh S3 (HTTP ${fileRes.status}).`);
  }

  const contentLength = Number(fileRes.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES) {
    throw new Error('El archivo de MyWhoosh supera el límite permitido de 32 MB.');
  }

  const arr = await fileRes.arrayBuffer();
  if (arr.byteLength === 0) {
    throw new Error('El archivo descargado desde MyWhoosh está vacío.');
  }
  if (arr.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error('El archivo de MyWhoosh supera el límite permitido de 32 MB.');
  }
  return Buffer.from(arr);
}

function upsertImportLog(log: MyWhooshImportLog) {
  getDb()
    .prepare(`
      INSERT INTO mywhoosh_imports (activity_id, activity_file_id, local_activity_id, title, started_at, status, error, imported_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(activity_id) DO UPDATE SET
        activity_file_id = excluded.activity_file_id,
        local_activity_id = excluded.local_activity_id,
        title = excluded.title,
        started_at = excluded.started_at,
        status = excluded.status,
        error = excluded.error,
        imported_at = excluded.imported_at
    `)
    .run(
      log.activityId,
      log.activityFileId ?? null,
      log.localActivityId ?? null,
      log.title,
      log.startedAt ?? null,
      log.status,
      log.error ?? null,
      log.importedAt
    );
}

function pickSafeStartedAt(parsedStartedAt: string | undefined, remoteStartedAt: string | null): string {
  if (parsedStartedAt) {
    const ms = Date.parse(parsedStartedAt);
    if (Number.isFinite(ms)) {
      const year = new Date(ms).getUTCFullYear();
      const maxYear = new Date().getUTCFullYear() + 1;
      if (year >= 2015 && year <= maxYear) {
        return new Date(ms).toISOString();
      }
    }
  }
  return remoteStartedAt ?? new Date().toISOString();
}

export async function syncMyWhooshActivities(
  options: {
    limit?: number;
    maxPages?: number;
    syncAll?: boolean;
    retryFailed?: boolean;
    fetchImpl?: FetchLike;
  } = {}
): Promise<MyWhooshSyncResult> {
  const account = currentAccountId();
  const existingFlight = inFlightSyncByAccount.get(account);
  if (existingFlight) {
    return existingFlight;
  }

  const run = async (): Promise<MyWhooshSyncResult> => {
    const fetchImpl = options.fetchImpl ?? fetch;
    const db = getDb();
    const row = ensureMyWhooshConfigRow();
    const envCreds = getMyWhooshEnvCredentials();

    const hasAnyAuth = Boolean(
      row.access_token ||
      row.refresh_token ||
      row.password_enc ||
      (envCreds.email && envCreds.password)
    );
    if (!hasAnyAuth) {
      throw new Error('MyWhoosh no está conectado. Introduce tu email y contraseña primero.');
    }

    const isStaleLock =
      row.sync_in_progress === 1 &&
      row.sync_started_at &&
      Date.now() - Date.parse(row.sync_started_at) > STALE_LOCK_MS;

    if (row.sync_in_progress === 1 && !isStaleLock) {
      throw new Error('Ya hay una sincronización de MyWhoosh en curso.');
    }

    db.prepare('UPDATE mywhoosh_config SET sync_in_progress = 1, sync_started_at = ?, last_error = NULL WHERE id = 1').run(
      new Date().toISOString()
    );

    const maxPages = options.syncAll ? 50 : Math.max(1, Math.min(50, options.maxPages ?? 5));
    const maxImports = options.syncAll ? 500 : Math.max(1, Math.min(500, options.limit ?? 30));
    const retryFailed = options.retryFailed ?? true;

    let imported = 0;
    let skipped = 0;
    let failed = 0;
    let totalFetched = 0;
    const errors: string[] = [];

    try {
      const profile = getAthleteProfile();
      const seenRemoteIds = new Set<string>();

      for (let page = 1; page <= maxPages; page++) {
        const rawPage = await authorizedMyWhooshPost<unknown>(
          MYWHOOSH_ACTIVITIES_URL,
          { sortDate: 'DESC', page },
          fetchImpl
        );
        const parsedPage = parseMyWhooshActivityPage(rawPage, page);
        if (parsedPage.items.length === 0) break;

        for (const remote of parsedPage.items) {
          if (seenRemoteIds.has(remote.activityId)) continue;
          seenRemoteIds.add(remote.activityId);
          totalFetched++;

          const externalId = `mywhoosh_${remote.activityId}`;
          if (hasActivityWithExternalId(externalId)) {
            skipped++;
            continue;
          }

          if (!remote.activityFileId) {
            skipped++;
            continue;
          }

          const prevLog = db
            .prepare('SELECT status, local_activity_id FROM mywhoosh_imports WHERE activity_id = ?')
            .get(remote.activityId) as { status: string; local_activity_id: string | null } | undefined;

          if (prevLog?.status === 'failed' && !retryFailed) {
            skipped++;
            continue;
          }
          if (prevLog?.status === 'skipped' && prevLog.local_activity_id && !options.syncAll) {
            const dupStillExists = db.prepare('SELECT id FROM activities WHERE id = ?').get(prevLog.local_activity_id);
            if (dupStillExists) {
              skipped++;
              continue;
            }
          }

          try {
            const rawBytes = await downloadSignedMyWhooshFile(remote.activityFileId, fetchImpl);
            const extracted = extractMyWhooshActivityBuffer(rawBytes, remote.activityId);
            const parsedResult = await parseUploadedActivityFile(extracted.fileName, extracted.buffer);
            const parsed = parsedResult.activities[0];

            if (!parsed) {
              const reason = parsedResult.errors.join(' | ') || 'El archivo no contenía datos de actividad.';
              throw new Error(reason);
            }

            const startedAt = pickSafeStartedAt(parsed.startedAt, remote.startedAt);
            const duplicateId = findDuplicateActivityId(startedAt, 'mywhoosh', parsed.distanceMeters, externalId);
            if (duplicateId) {
              upsertImportLog({
                activityId: remote.activityId,
                activityFileId: remote.activityFileId,
                localActivityId: duplicateId,
                title: remote.title,
                startedAt,
                status: 'skipped',
                error: 'Duplicado detectado con sesión existente en Bilifit',
                importedAt: new Date().toISOString(),
              });
              skipped++;
              continue;
            }

            const coords = parsed.points
              .filter((p): p is typeof p & { lat: number; lon: number } => typeof p.lat === 'number' && typeof p.lon === 'number')
              .map((p): [number, number] => [p.lat, p.lon]);

            const worldMatch = resolveMyWhooshWorldForActivity({
              worldName: parsed.worldName ?? remote.worldHint,
              title: `${remote.title} ${parsed.title} ${remote.worldHint ?? ''}`,
              sport: 'mywhoosh',
              subSport: 'virtual_activity',
              deviceName: 'MyWhoosh',
              coords,
            });
            const worldName =
              worldMatch?.world.name ??
              parsed.worldName ??
              detectMyWhooshWorld(`${remote.title} ${remote.worldHint ?? ''}`) ??
              null;

            const remoteHasConcrete =
              remote.title !== remote.activityId && hasConcreteActivityName(remote.title);
            const parsedHasConcrete =
              parsed.title !== remote.activityId && hasConcreteActivityName(parsed.title);

            const candidateTitle =
              remoteHasConcrete && (!parsedHasConcrete || remote.title.length >= parsed.title.length)
                ? remote.title
                : parsedHasConcrete
                  ? parsed.title
                  : null;
            const finalTitle = resolveActivityTitle(candidateTitle, 'mywhoosh', startedAt);

            const tss = estimateActivityTSS(
              {
                sport: 'mywhoosh',
                durationSec: parsed.durationSec,
                movingTimeSec: parsed.movingTimeSec,
                avgWatts: parsed.avgWatts ?? null,
                normalizedPower: parsed.normalizedPower ?? null,
                avgHr: parsed.avgHr ?? null,
                elevationGain: parsed.elevationGain,
              },
              profile
            );

            const created = createActivity({
              id: `act_mw_${remote.activityId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20) || crypto.randomUUID().slice(0, 12)}`,
              externalId,
              source: 'mywhoosh',
              sport: 'mywhoosh',
              subSport: 'MyWhoosh Indoor',
              title: finalTitle,
              description: parsed.description ?? 'Importado directamente desde MyWhoosh.',
              startedAt,
              durationSec: parsed.durationSec,
              movingTimeSec: parsed.movingTimeSec,
              distanceMeters: parsed.distanceMeters,
              elevationGain: parsed.elevationGain,
              elevationLoss: parsed.elevationLoss,
              avgSpeedMs: parsed.avgSpeedMs ?? null,
              maxSpeedMs: parsed.maxSpeedMs ?? null,
              avgHr: parsed.avgHr ?? null,
              maxHr: parsed.maxHr ?? null,
              avgWatts: parsed.avgWatts ?? null,
              normalizedPower: parsed.normalizedPower ?? null,
              maxWatts: parsed.maxWatts ?? null,
              avgCadence: parsed.avgCadence ?? null,
              calories: parsed.calories ?? Math.round((parsed.durationSec / 60) * 10),
              tss,
              rpe: null,
              gearId: null,
              worldName,
              polyline: parsed.polyline ?? null,
              startLat: parsed.startLat ?? null,
              startLon: parsed.startLon ?? null,
              points: parsed.points,
              strengthLogs: [],
              totalVolumeKg: null,
              laps: parsed.laps ?? [],
              extras: parsed.extras ?? null,
              createdAt: new Date().toISOString(),
            });

            upsertImportLog({
              activityId: remote.activityId,
              activityFileId: remote.activityFileId,
              localActivityId: created.id,
              title: finalTitle,
              startedAt,
              status: 'imported',
              error: null,
              importedAt: new Date().toISOString(),
            });
            imported++;
            if (imported >= maxImports) break;
          } catch (actErr) {
            const msg = actErr instanceof Error ? actErr.message : 'Error importando sesión de MyWhoosh';
            failed++;
            errors.push(`${remote.title}: ${msg}`);
            upsertImportLog({
              activityId: remote.activityId,
              activityFileId: remote.activityFileId,
              localActivityId: null,
              title: remote.title,
              startedAt: remote.startedAt,
              status: 'failed',
              error: msg,
              importedAt: new Date().toISOString(),
            });
          }
        }

        if (imported >= maxImports || !parsedPage.hasMore) {
          break;
        }
      }

      db.prepare(`
        UPDATE mywhoosh_config
        SET sync_in_progress = 0,
            sync_started_at = NULL,
            last_sync_at = ?,
            last_sync_status = ?,
            last_error = ?
        WHERE id = 1
      `).run(
        new Date().toISOString(),
        failed > 0 && imported === 0 ? 'error' : 'ok',
        errors.length > 0 ? errors.slice(0, 3).join(' | ') : null
      );

      return { imported, skipped, failed, totalFetched, errors };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error sincronizando MyWhoosh';
      const currentStatus = (ensureMyWhooshConfigRow().last_sync_status === 'needs_reconnect' ? 'needs_reconnect' : 'error');
      db.prepare(`
        UPDATE mywhoosh_config
        SET sync_in_progress = 0,
            sync_started_at = NULL,
            last_sync_status = ?,
            last_error = ?
        WHERE id = 1
      `).run(currentStatus, msg);
      throw err;
    }
  };

  const promise = run().finally(() => {
    inFlightSyncByAccount.delete(account);
  });
  inFlightSyncByAccount.set(account, promise);
  return promise;
}

export async function runScheduledMyWhooshSyncIfDue(): Promise<boolean> {
  const account = currentAccountId();
  if (inFlightSyncByAccount.has(account)) return false;
  try {
    const status = getMyWhooshStatus();
    if (!status.connected || !status.autoSyncEnabled || status.syncInProgress) return false;
    if (status.lastSyncStatus === 'needs_reconnect') return false;

    const lastMs = status.lastSyncAt ? Date.parse(status.lastSyncAt) : 0;
    const intervalMs = Math.max(5, status.syncIntervalMin) * 60_000;
    if (lastMs && Date.now() - lastMs < intervalMs) {
      return false;
    }

    await syncMyWhooshActivities({ limit: 15, maxPages: 2, retryFailed: false });
    return true;
  } catch {
    return false;
  }
}
