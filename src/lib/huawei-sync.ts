import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { currentAccountId } from '@/lib/account-context';
import type { AccountId } from '@/lib/accounts';
import { decryptSecret, encryptSecret } from '@/lib/crypto';
import {
  createActivity,
  findDuplicateActivityId,
  getAthleteProfile,
  getDb,
  getDbPath,
  hasActivityWithExternalId,
} from '@/lib/db';
import { estimateActivityTSS } from '@/lib/metrics';
import { parseUploadedActivityFile } from '@/lib/parsers';
import {
  applyHealthSyncMetadata,
  groupHealthSyncFiles,
  parseHealthSyncCsv,
} from '@/lib/parsers/huawei';
import type { ParsedActivityData } from '@/lib/parsers/gpx';
import type { HuaweiConnectionStatus, HuaweiImportLog, HuaweiSyncResult } from '@/types';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const GOOGLE_DRIVE_ABOUT_URL = 'https://www.googleapis.com/drive/v3/about';
const MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024;
const STALE_LOCK_MS = 15 * 60 * 1000;

export type FetchLike = typeof fetch;

interface HuaweiDbRow {
  watch_dir: string | null;
  google_client_id: string | null;
  google_client_secret_enc: string | null;
  google_access_token: string | null;
  google_refresh_token: string | null;
  google_token_expires_at: number | null;
  google_account_email: string | null;
  drive_folder_id: string | null;
  drive_folder_name: string | null;
  auto_sync_enabled: number;
  sync_interval_min: number;
  sync_in_progress: number;
  sync_started_at: string | null;
  last_sync_at: string | null;
  last_sync_status: string;
  last_error: string | null;
}

export interface DriveFileMeta {
  id: string;
  name: string;
  mimeType?: string;
  modifiedTime?: string;
  size?: string | number;
  parents?: string[];
}

interface LocalFileEntry {
  fullPath: string;
  relPath: string;
  fileName: string;
  mtimeMs: number;
  size: number;
}

const inFlightHuaweiSyncByAccount = new Map<AccountId, Promise<HuaweiSyncResult>>();

export function getDefaultHuaweiWatchDir(account: AccountId = currentAccountId()): string {
  const configured = process.env.HUAWEI_SYNC_DIR?.trim();
  if (configured) {
    const resolved = path.isAbsolute(configured)
      ? configured
      : path.join(/*turbopackIgnore: true*/ process.cwd(), configured);
    return account === 'raul' ? resolved : `${resolved}-${account}`;
  }
  const folderName = account === 'raul' ? 'huawei-sync' : `huawei-sync-${account}`;
  return path.join(path.dirname(getDbPath(account)), folderName);
}

function getHuaweiEnvConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || null;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || null;
  const autoRaw = process.env.HUAWEI_AUTO_SYNC?.trim().toLowerCase();
  const autoSync = autoRaw === '1' || autoRaw === 'true';
  const intervalParsed = Number(process.env.HUAWEI_SYNC_INTERVAL_MIN);
  const intervalMin =
    Number.isFinite(intervalParsed) && intervalParsed >= 5 && intervalParsed <= 1440 ? Math.round(intervalParsed) : null;
  return {
    googleClientId: clientId,
    googleClientSecret: clientSecret,
    autoSync,
    intervalMin,
  };
}

function ensureHuaweiConfigRow(): HuaweiDbRow {
  const db = getDb();
  let row = db.prepare('SELECT * FROM huawei_config WHERE id = 1').get() as HuaweiDbRow | undefined;
  if (!row) {
    db.prepare('INSERT OR IGNORE INTO huawei_config (id) VALUES (1)').run();
    row = db.prepare('SELECT * FROM huawei_config WHERE id = 1').get() as HuaweiDbRow | undefined;
  }
  return (
    row ?? {
      watch_dir: null,
      google_client_id: null,
      google_client_secret_enc: null,
      google_access_token: null,
      google_refresh_token: null,
      google_token_expires_at: null,
      google_account_email: null,
      drive_folder_id: null,
      drive_folder_name: null,
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

function getSharedRaulGoogleOAuthCredentials(): { clientId: string; clientSecret: string } | null {
  if (currentAccountId() === 'raul') return null;
  try {
    const raulDb = getDb('raul');
    const raulRow = raulDb
      .prepare('SELECT google_client_id, google_client_secret_enc FROM huawei_config WHERE id = 1')
      .get() as { google_client_id: string | null; google_client_secret_enc: string | null } | undefined;
    const clientId = raulRow?.google_client_id?.trim() || null;
    const clientSecret = raulRow?.google_client_secret_enc
      ? decryptSecret(raulRow.google_client_secret_enc)
      : null;
    if (clientId && clientSecret) {
      return { clientId, clientSecret };
    }
  } catch {
    // ignorar si la BD de Raúl aún no tiene credenciales OAuth
  }
  return null;
}

function resolveGoogleOAuthCredentials(row: HuaweiDbRow): {
  clientId: string | null;
  clientSecret: string | null;
  fromEnv: boolean;
  sharedFromRaul: boolean;
} {
  const env = getHuaweiEnvConfig();
  const dbSecret = row.google_client_secret_enc ? decryptSecret(row.google_client_secret_enc) : null;
  if (row.google_client_id && dbSecret) {
    return { clientId: row.google_client_id, clientSecret: dbSecret, fromEnv: false, sharedFromRaul: false };
  }
  if (env.googleClientId && env.googleClientSecret) {
    return { clientId: env.googleClientId, clientSecret: env.googleClientSecret, fromEnv: true, sharedFromRaul: false };
  }
  const shared = getSharedRaulGoogleOAuthCredentials();
  if (shared) {
    return { clientId: shared.clientId, clientSecret: shared.clientSecret, fromEnv: false, sharedFromRaul: true };
  }
  return {
    clientId: row.google_client_id ?? env.googleClientId,
    clientSecret: dbSecret ?? env.googleClientSecret,
    fromEnv: false,
    sharedFromRaul: false,
  };
}

function isSupportedWatchFileName(name: string): boolean {
  const lower = name.toLowerCase();
  if (name.startsWith('.') || lower.endsWith('.tmp') || lower.endsWith('.part') || lower.endsWith('.crdownload')) {
    return false;
  }
  if (/^hitrack_/i.test(name) && !name.includes('.')) return true;
  return (
    lower.endsWith('.fit') ||
    lower.endsWith('.dms') ||
    lower.endsWith('.tcx') ||
    lower.endsWith('.gpx') ||
    lower.endsWith('.zip') ||
    lower.endsWith('.gz') ||
    lower.endsWith('.json') ||
    lower.endsWith('.csv')
  );
}

export function listWatchDirFiles(watchDir: string, depth = 0, baseDir = watchDir): LocalFileEntry[] {
  if (depth > 3 || !fs.existsSync(watchDir)) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(watchDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: LocalFileEntry[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(watchDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listWatchDirFiles(fullPath, depth + 1, baseDir));
    } else if (entry.isFile() && isSupportedWatchFileName(entry.name)) {
      try {
        const stat = fs.statSync(fullPath);
        if (stat.size > 0 && stat.size <= MAX_DOWNLOAD_BYTES) {
          out.push({
            fullPath,
            relPath: path.relative(baseDir, fullPath),
            fileName: entry.name,
            mtimeMs: stat.mtimeMs,
            size: stat.size,
          });
        }
      } catch {
        // Ignorar archivos ilegibles
      }
    }
  }
  return out;
}

export function getHuaweiStatus(originHint?: string): HuaweiConnectionStatus {
  const row = ensureHuaweiConfigRow();
  const env = getHuaweiEnvConfig();
  const creds = resolveGoogleOAuthCredentials(row);
  const db = getDb();

    const watchDir = row.watch_dir?.trim() || getDefaultHuaweiWatchDir();
    const watchDirExists = fs.existsSync(/*turbopackIgnore: true*/ watchDir);
    const localFiles = watchDirExists ? listWatchDirFiles(watchDir) : [];
  const bundledLocalCount = groupHealthSyncFiles(
    localFiles.map((f) => ({ fileName: f.fileName, item: f }))
  ).filter((g) => !g.primary.fileName.toLowerCase().endsWith('.csv')).length;

  const importedCountRow = db
    .prepare("SELECT COUNT(*) as c FROM activities WHERE source = 'huawei' OR external_id LIKE 'huawei_%'")
    .get() as { c: number };

  const recentRows = db
    .prepare('SELECT * FROM huawei_imports ORDER BY imported_at DESC LIMIT 12')
    .all() as Array<Record<string, unknown>>;

  const recentImports: HuaweiImportLog[] = recentRows.map((r) => ({
    itemKey: String(r.item_key),
    fileName: String(r.file_name),
    driveFileId: r.drive_file_id ? String(r.drive_file_id) : null,
    localActivityId: r.local_activity_id ? String(r.local_activity_id) : null,
    title: String(r.title),
    startedAt: r.started_at ? String(r.started_at) : null,
    channel: (String(r.channel || 'folder') as HuaweiImportLog['channel']),
    status: (String(r.status || 'imported') as HuaweiImportLog['status']),
    error: r.error ? String(r.error) : null,
    importedAt: String(r.imported_at),
  }));

  const isStaleLock =
    row.sync_in_progress === 1 &&
    row.sync_started_at &&
    Date.now() - Date.parse(row.sync_started_at) > STALE_LOCK_MS;

  return {
    accountId: currentAccountId(),
    watchDir,
    watchDirExists,
    watchDirFileCount: bundledLocalCount,
    googleConfigured: Boolean(creds.clientId && creds.clientSecret),
    googleConnected: Boolean(row.google_refresh_token || row.google_access_token),
    hasGoogleEnvCredentials: Boolean(env.googleClientId && env.googleClientSecret),
    sharedOAuthAppConfigured: Boolean(creds.sharedFromRaul || creds.fromEnv),
    googleClientId: creds.clientId,
    googleAccountEmail: row.google_account_email || null,
    driveFolderId: row.drive_folder_id || null,
    driveFolderName: row.drive_folder_name || null,
    googleRedirectUriHint: originHint ? `${originHint}/api/huawei/google/callback` : undefined,
    autoSyncEnabled: Boolean(row.auto_sync_enabled) || env.autoSync,
    syncIntervalMin: row.sync_interval_min || env.intervalMin || 15,
    syncInProgress: Boolean(row.sync_in_progress && !isStaleLock),
    lastSyncAt: row.last_sync_at || null,
    lastSyncStatus: (row.last_sync_status as HuaweiConnectionStatus['lastSyncStatus']) || 'idle',
    lastError: row.last_error || null,
    importedCount: importedCountRow.c,
    recentImports,
  };
}

export function updateHuaweiPreferences(patch: {
  watchDir?: string;
  googleClientId?: string;
  googleClientSecret?: string;
  driveFolderId?: string | null;
  driveFolderName?: string | null;
  autoSyncEnabled?: boolean;
  syncIntervalMin?: number;
}): HuaweiConnectionStatus {
  const row = ensureHuaweiConfigRow();

  const nextWatchDir =
    patch.watchDir !== undefined ? (patch.watchDir.trim() || null) : row.watch_dir;

  if (nextWatchDir) {
    try {
      fs.mkdirSync(nextWatchDir, { recursive: true });
    } catch {
      // No fallar si el usuario guarda una ruta aún por montar en Docker
    }
  }

  const nextClientId =
    patch.googleClientId !== undefined ? (patch.googleClientId.trim() || null) : row.google_client_id;
  const nextClientSecretEnc =
    patch.googleClientSecret !== undefined
      ? patch.googleClientSecret.trim()
        ? encryptSecret(patch.googleClientSecret.trim())
        : row.google_client_secret_enc
      : row.google_client_secret_enc;

  const nextFolderId = patch.driveFolderId !== undefined ? (patch.driveFolderId || null) : row.drive_folder_id;
  const nextFolderName = patch.driveFolderName !== undefined ? (patch.driveFolderName || null) : row.drive_folder_name;
  const nextAuto = patch.autoSyncEnabled !== undefined ? (patch.autoSyncEnabled ? 1 : 0) : row.auto_sync_enabled;
  const nextInterval =
    patch.syncIntervalMin !== undefined && Number.isFinite(patch.syncIntervalMin)
      ? Math.max(5, Math.min(1440, Math.round(patch.syncIntervalMin)))
      : row.sync_interval_min || 15;

  getDb()
    .prepare(`
      UPDATE huawei_config
      SET watch_dir = ?,
          google_client_id = ?,
          google_client_secret_enc = ?,
          drive_folder_id = ?,
          drive_folder_name = ?,
          auto_sync_enabled = ?,
          sync_interval_min = ?
      WHERE id = 1
    `)
    .run(
      nextWatchDir,
      nextClientId,
      nextClientSecretEnc,
      nextFolderId,
      nextFolderName,
      nextAuto,
      nextInterval
    );

  return getHuaweiStatus();
}

export function disconnectGoogleDrive(): HuaweiConnectionStatus {
  ensureHuaweiConfigRow();
  getDb()
    .prepare(`
      UPDATE huawei_config
      SET google_access_token = NULL,
          google_refresh_token = NULL,
          google_token_expires_at = NULL,
          google_account_email = NULL,
          drive_folder_id = NULL,
          drive_folder_name = NULL,
          last_error = NULL
      WHERE id = 1
    `)
    .run();
  return getHuaweiStatus();
}

export function getGoogleDriveAuthUrl(origin: string, state: string): string {
  const row = ensureHuaweiConfigRow();
  const creds = resolveGoogleOAuthCredentials(row);
  if (!creds.clientId || !creds.clientSecret) {
    throw new Error('Configura primero el Google Client ID y Client Secret.');
  }

  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: `${origin}/api/huawei/google/callback`,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/userinfo.email',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeGoogleDriveCode(
  code: string,
  origin: string,
  fetchImpl: FetchLike = fetch
): Promise<HuaweiConnectionStatus> {
  const row = ensureHuaweiConfigRow();
  const creds = resolveGoogleOAuthCredentials(row);
  if (!creds.clientId || !creds.clientSecret) {
    throw new Error('Faltan credenciales OAuth de Google Drive.');
  }

  const res = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: `${origin}/api/huawei/google/callback`,
      grant_type: 'authorization_code',
    }),
  });

  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error_description?: string;
    error?: string;
  };

  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || 'No se pudo completar la autorización con Google Drive.');
  }

  const expiresAt = Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600);
  const refreshToken = data.refresh_token || row.google_refresh_token;

  // Obtener email del usuario
  let email: string | null = row.google_account_email;
  try {
    const aboutRes = await fetchImpl(`${GOOGLE_DRIVE_ABOUT_URL}?fields=user(emailAddress)`, {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    if (aboutRes.ok) {
      const aboutData = (await aboutRes.json()) as { user?: { emailAddress?: string } };
      if (aboutData.user?.emailAddress) {
        email = aboutData.user.emailAddress;
      }
    }
  } catch {
    // No bloquear por email opcional
  }

  getDb()
    .prepare(`
      UPDATE huawei_config
      SET google_access_token = ?,
          google_refresh_token = ?,
          google_token_expires_at = ?,
          google_account_email = ?,
          auto_sync_enabled = 1,
          last_error = NULL
      WHERE id = 1
    `)
    .run(data.access_token, refreshToken, expiresAt, email);

  // Auto-detectar carpeta Health Sync Actividades si aún no hay carpeta elegida
  if (!row.drive_folder_id) {
    try {
      const folders = await listGoogleDriveFolders(fetchImpl);
      const preferred =
        folders.find((f) => f.name.toLowerCase().includes('health sync actividades')) ??
        folders.find((f) => f.name.toLowerCase().includes('health sync')) ??
        folders.find((f) => f.name.toLowerCase().includes('huawei')) ??
        null;
      if (preferred) {
        getDb()
          .prepare('UPDATE huawei_config SET drive_folder_id = ?, drive_folder_name = ? WHERE id = 1')
          .run(preferred.id, preferred.name);
      }
    } catch {
      // El usuario podrá seleccionarla manualmente en la UI
    }
  }

  return getHuaweiStatus(origin);
}

async function getValidGoogleAccessToken(fetchImpl: FetchLike = fetch): Promise<string> {
  const row = ensureHuaweiConfigRow();
  const nowSec = Math.floor(Date.now() / 1000);

  if (row.google_access_token && (!row.google_token_expires_at || row.google_token_expires_at > nowSec + 180)) {
    return row.google_access_token;
  }

  if (!row.google_refresh_token) {
    throw new Error('Tu sesión de Google Drive ha caducado o no está conectada. Vuelve a autorizar.');
  }

  const creds = resolveGoogleOAuthCredentials(row);
  if (!creds.clientId || !creds.clientSecret) {
    throw new Error('Faltan Client ID / Secret de Google para renovar el acceso a Drive.');
  }

  const res = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: row.google_refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
    error?: string;
  };

  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || 'No se pudo renovar el token de Google Drive.');
  }

  const expiresAt = Math.floor(Date.now() / 1000) + (data.expires_in ?? 3600);
  getDb()
    .prepare('UPDATE huawei_config SET google_access_token = ?, google_token_expires_at = ? WHERE id = 1')
    .run(data.access_token, expiresAt);

  return data.access_token;
}

export async function listGoogleDriveFolders(fetchImpl: FetchLike = fetch): Promise<DriveFileMeta[]> {
  const token = await getValidGoogleAccessToken(fetchImpl);
  const params = new URLSearchParams({
    q: "mimeType = 'application/vnd.google-apps.folder' and trashed = false",
    orderBy: 'modifiedTime desc',
    pageSize: '100',
    fields: 'files(id,name,mimeType,modifiedTime,parents)',
    includeItemsFromAllDrives: 'true',
    supportsAllDrives: 'true',
  });

  const res = await fetchImpl(`${GOOGLE_DRIVE_FILES_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Error listando carpetas de Google Drive (${res.status}): ${text.slice(0, 140)}`);
  }

  const data = (await res.json()) as { files?: DriveFileMeta[] };
  return data.files ?? [];
}

async function listDriveFolderFiles(
  folderId: string,
  maxPages: number,
  fetchImpl: FetchLike
): Promise<DriveFileMeta[]> {
  if (!/^[A-Za-z0-9_-]+$/.test(folderId)) {
    throw new Error('ID de carpeta de Google Drive inválido.');
  }
  const token = await getValidGoogleAccessToken(fetchImpl);
  const out: DriveFileMeta[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      orderBy: 'modifiedTime desc',
      pageSize: '100',
      fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,size)',
      includeItemsFromAllDrives: 'true',
      supportsAllDrives: 'true',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const res = await fetchImpl(`${GOOGLE_DRIVE_FILES_URL}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Error leyendo archivos de Google Drive (${res.status}): ${text.slice(0, 140)}`);
    }

    const data = (await res.json()) as { files?: DriveFileMeta[]; nextPageToken?: string };
    if (Array.isArray(data.files)) {
      out.push(...data.files.filter((f) => isSupportedWatchFileName(f.name)));
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  return out;
}

async function downloadDriveFileBuffer(fileId: string, fetchImpl: FetchLike): Promise<Buffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(fileId)) {
    throw new Error('ID de archivo de Google Drive inválido.');
  }
  const token = await getValidGoogleAccessToken(fetchImpl);
  const res = await fetchImpl(`${GOOGLE_DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error(`No se pudo descargar archivo de Drive (${res.status}).`);
  }

  const cl = res.headers.get('content-length');
  if (cl && Number(cl) > MAX_DOWNLOAD_BYTES) {
    throw new Error('El archivo en Google Drive excede el límite de 32 MB.');
  }

  const ab = await res.arrayBuffer();
  if (ab.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error('El archivo en Google Drive excede el límite de 32 MB.');
  }
  return Buffer.from(ab);
}

function upsertHuaweiImportLog(entry: {
  itemKey: string;
  fileName: string;
  driveFileId?: string | null;
  localActivityId?: string | null;
  title: string;
  startedAt?: string | null;
  channel: 'folder' | 'drive' | 'upload';
  status: 'imported' | 'skipped' | 'failed';
  error?: string | null;
}) {
  getDb()
    .prepare(`
      INSERT INTO huawei_imports (item_key, file_name, drive_file_id, local_activity_id, title, started_at, channel, status, error, imported_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(item_key) DO UPDATE SET
        file_name = excluded.file_name,
        drive_file_id = excluded.drive_file_id,
        local_activity_id = excluded.local_activity_id,
        title = excluded.title,
        started_at = excluded.started_at,
        channel = excluded.channel,
        status = excluded.status,
        error = excluded.error,
        imported_at = excluded.imported_at
    `)
    .run(
      entry.itemKey,
      entry.fileName,
      entry.driveFileId ?? null,
      entry.localActivityId ?? null,
      entry.title,
      entry.startedAt ?? null,
      entry.channel,
      entry.status,
      entry.error ?? null,
      new Date().toISOString()
    );
}

function persistHuaweiParsedActivities(
  itemKey: string,
  fileName: string,
  driveFileId: string | null,
  channel: 'folder' | 'drive',
  parsedList: ParsedActivityData[]
): { imported: number; skipped: number } {
  const profile = getAthleteProfile();
  let imported = 0;
  let skipped = 0;

  for (let idx = 0; idx < parsedList.length; idx++) {
    const parsed = parsedList[idx];
    const hashSeed = `${itemKey}:${idx}:${parsed.startedAt}:${parsed.sport}`;
    const extId =
      parsed.externalId ||
      `huawei_${crypto.createHash('sha1').update(hashSeed).digest('hex').slice(0, 16)}`;

    if (hasActivityWithExternalId(extId)) {
      skipped++;
      continue;
    }

    const dupId = findDuplicateActivityId(parsed.startedAt, parsed.sport, parsed.distanceMeters, extId);
    if (dupId) {
      if (parsedList.length === 1) {
        upsertHuaweiImportLog({
          itemKey,
          fileName,
          driveFileId,
          localActivityId: dupId,
          title: parsed.title,
          startedAt: parsed.startedAt,
          channel,
          status: 'skipped',
        });
      }
      skipped++;
      continue;
    }

    const tss = estimateActivityTSS(
      {
        sport: parsed.sport,
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
      id: `act_${crypto.randomUUID().slice(0, 12)}`,
      externalId: extId,
      source: 'huawei',
      sport: parsed.sport,
      subSport: parsed.subSport ?? null,
      title: parsed.title,
      description: parsed.description ?? null,
      startedAt: parsed.startedAt,
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
      calories: parsed.calories ?? Math.round((parsed.durationSec / 60) * 9),
      tss,
      rpe: null,
      gearId: null,
      worldName: parsed.worldName ?? null,
      polyline: parsed.polyline ?? null,
      startLat: parsed.startLat ?? null,
      startLon: parsed.startLon ?? null,
      points: parsed.points,
      strengthLogs: [],
      totalVolumeKg: null,
      laps: parsed.laps ?? [],
      extras: {
        ...(parsed.extras ?? {}),
        deviceName: parsed.extras?.deviceName ?? 'Huawei Health / Health Sync',
      },
      createdAt: new Date().toISOString(),
    });

    if (parsedList.length === 1 || idx === 0) {
      upsertHuaweiImportLog({
        itemKey,
        fileName,
        driveFileId,
        localActivityId: created.id,
        title: created.title,
        startedAt: created.startedAt,
        channel,
        status: 'imported',
      });
    }
    imported++;
  }

  if (parsedList.length > 1 && imported === 0 && skipped > 0) {
    upsertHuaweiImportLog({
      itemKey,
      fileName,
      driveFileId,
      title: `${fileName} (${parsedList.length} sesiones)`,
      channel,
      status: 'skipped',
    });
  }

  return { imported, skipped };
}

function shouldSkipLoggedItem(itemKey: string, retryFailed: boolean): boolean {
  const prev = getDb()
    .prepare('SELECT status, local_activity_id FROM huawei_imports WHERE item_key = ?')
    .get(itemKey) as { status: string; local_activity_id: string | null } | undefined;

  if (!prev) return false;
  if (prev.status === 'failed') return !retryFailed;
  if (prev.local_activity_id) {
    const exists = getDb().prepare('SELECT id FROM activities WHERE id = ?').get(prev.local_activity_id);
    return Boolean(exists);
  }
  return prev.status === 'imported' || prev.status === 'skipped';
}

export async function syncHuaweiActivities(
  options: {
    mode?: 'auto' | 'folder' | 'drive';
    limit?: number;
    maxPages?: number;
    retryFailed?: boolean;
    fetchImpl?: FetchLike;
  } = {}
): Promise<HuaweiSyncResult> {
  const account = currentAccountId();
  const existingFlight = inFlightHuaweiSyncByAccount.get(account);
  if (existingFlight) {
    return existingFlight;
  }

  const run = async (): Promise<HuaweiSyncResult> => {
    const fetchImpl = options.fetchImpl ?? fetch;
    const db = getDb();
    const row = ensureHuaweiConfigRow();

    const isStaleLock =
      row.sync_in_progress === 1 &&
      row.sync_started_at &&
      Date.now() - Date.parse(row.sync_started_at) > STALE_LOCK_MS;

    if (row.sync_in_progress === 1 && !isStaleLock) {
      throw new Error('Ya hay una sincronización de Huawei Health en curso.');
    }

    const mode = options.mode ?? 'auto';
    const watchDir = row.watch_dir?.trim() || getDefaultHuaweiWatchDir();
    const hasGoogle = Boolean((row.google_refresh_token || row.google_access_token) && row.drive_folder_id);

    if (mode === 'drive' && !hasGoogle) {
      throw new Error('Conecta Google Drive y selecciona una carpeta (p. ej. "Health Sync Actividades") primero.');
    }
    if (mode === 'folder') {
      fs.mkdirSync(watchDir, { recursive: true });
    }

    const doDrive = mode === 'drive' || (mode === 'auto' && hasGoogle);
    const doFolder = mode === 'folder' || (mode === 'auto' && fs.existsSync(/*turbopackIgnore: true*/ watchDir));

    if (!doDrive && !doFolder) {
      throw new Error('Activa la carpeta local de sincronización o conecta Google Drive primero.');
    }

    db.prepare('UPDATE huawei_config SET sync_in_progress = 1, sync_started_at = ?, last_error = NULL WHERE id = 1').run(
      new Date().toISOString()
    );

    const limit = Math.max(1, Math.min(500, options.limit ?? 50));
    const maxPages = Math.max(1, Math.min(30, options.maxPages ?? 10));
    const retryFailed = options.retryFailed ?? true;

    let imported = 0;
    let skipped = 0;
    let failed = 0;
    let scanned = 0;
    const errors: string[] = [];

    try {
      // 1. Escaneo de carpeta local / volumen Docker (/app/data/huawei-sync)
      if (doFolder) {
        const localFiles = listWatchDirFiles(watchDir);
        const bundles = groupHealthSyncFiles(localFiles.map((f) => ({ fileName: f.fileName, item: f })));
        for (const grp of bundles) {
          if (grp.primary.fileName.toLowerCase().endsWith('.csv')) continue;
          scanned++;
          const itemKey = `folder:${grp.bundleKey === grp.primary.fileName ? grp.primary.item.relPath : grp.bundleKey}`;

          if (shouldSkipLoggedItem(itemKey, retryFailed)) {
            skipped++;
            continue;
          }
          if (imported >= limit) continue;

          try {
            const rawBuf = fs.readFileSync(grp.primary.item.fullPath);
            const parsed = await parseUploadedActivityFile(grp.primary.fileName, rawBuf);
            if (parsed.activities.length === 0) {
              throw new Error(parsed.errors.join(' | ') || 'Archivo sin datos de actividad');
            }

            let activities = parsed.activities;
            if (grp.csvMetaItem) {
              try {
                const csvText = fs.readFileSync(grp.csvMetaItem.item.fullPath, 'utf8');
                const meta = parseHealthSyncCsv(csvText);
                activities = activities.map((a) => applyHealthSyncMetadata(a, meta));
              } catch {
                // Ignorar CSV ilegible
              }
            }

            const res = persistHuaweiParsedActivities(itemKey, grp.primary.fileName, null, 'folder', activities);
            imported += res.imported;
            skipped += res.skipped;
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Error procesando archivo';
            failed++;
            errors.push(`${grp.primary.fileName}: ${msg}`);
            upsertHuaweiImportLog({
              itemKey,
              fileName: grp.primary.fileName,
              title: grp.primary.fileName,
              channel: 'folder',
              status: 'failed',
              error: msg,
            });
          }
        }
      }

      // 2. Sincronización directa desde Google Drive (Health Sync / Huawei)
      if (doDrive && row.drive_folder_id) {
        const driveFiles = await listDriveFolderFiles(row.drive_folder_id, maxPages, fetchImpl);
        const bundles = groupHealthSyncFiles(driveFiles.map((f) => ({ fileName: f.name, item: f })));

        for (const grp of bundles) {
          if (grp.primary.fileName.toLowerCase().endsWith('.csv')) continue;
          scanned++;
          const itemKey = `drive:${grp.bundleKey === grp.primary.fileName ? grp.primary.item.id : grp.bundleKey}`;

          if (shouldSkipLoggedItem(itemKey, retryFailed)) {
            skipped++;
            continue;
          }
          if (imported >= limit) continue;

          try {
            const rawBuf = await downloadDriveFileBuffer(grp.primary.item.id, fetchImpl);
            const parsed = await parseUploadedActivityFile(grp.primary.fileName, rawBuf);
            if (parsed.activities.length === 0) {
              throw new Error(parsed.errors.join(' | ') || 'Archivo de Drive sin datos de actividad');
            }

            let activities = parsed.activities;
            if (grp.csvMetaItem) {
              try {
                const csvBuf = await downloadDriveFileBuffer(grp.csvMetaItem.item.id, fetchImpl);
                const meta = parseHealthSyncCsv(csvBuf.toString('utf8'));
                activities = activities.map((a) => applyHealthSyncMetadata(a, meta));
              } catch {
                // Ignorar error de CSV secundario
              }
            }

            const res = persistHuaweiParsedActivities(
              itemKey,
              grp.primary.fileName,
              grp.primary.item.id,
              'drive',
              activities
            );
            imported += res.imported;
            skipped += res.skipped;
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'Error descargando o parseando archivo de Drive';
            failed++;
            errors.push(`${grp.primary.fileName}: ${msg}`);
            upsertHuaweiImportLog({
              itemKey,
              fileName: grp.primary.fileName,
              driveFileId: grp.primary.item.id,
              title: grp.primary.fileName,
              channel: 'drive',
              status: 'failed',
              error: msg,
            });
          }
        }
      }

      db.prepare(`
        UPDATE huawei_config
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

      return { imported, skipped, failed, scanned, errors };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error sincronizando Huawei Health';
      const needsReconnect = /caducad|autoriz|token|refresh/i.test(msg);
      db.prepare(`
        UPDATE huawei_config
        SET sync_in_progress = 0,
            sync_started_at = NULL,
            last_sync_status = ?,
            last_error = ?
        WHERE id = 1
      `).run(needsReconnect ? 'needs_reconnect' : 'error', msg);
      throw err;
    }
  };

  const promise = run().finally(() => {
    inFlightHuaweiSyncByAccount.delete(account);
  });
  inFlightHuaweiSyncByAccount.set(account, promise);
  return promise;
}

export async function runScheduledHuaweiSyncIfDue(): Promise<HuaweiSyncResult | null> {
  const account = currentAccountId();
  if (inFlightHuaweiSyncByAccount.has(account)) return null;
  const status = getHuaweiStatus();
  if (!status.autoSyncEnabled) return null;
  const hasReadyDrive = Boolean(status.googleConnected && status.driveFolderId);
  const hasReadyFolder = Boolean(status.watchDirExists && status.watchDirFileCount > 0);
  if (!hasReadyDrive && !hasReadyFolder) return null;
  if (status.syncInProgress) return null;

  const intervalMs = Math.max(5, status.syncIntervalMin) * 60_000;
  if (status.lastSyncAt) {
    const elapsed = Date.now() - Date.parse(status.lastSyncAt);
    if (Number.isFinite(elapsed) && elapsed < intervalMs) {
      return null;
    }
  }

  return syncHuaweiActivities({ mode: 'auto', limit: 30, maxPages: 5, retryFailed: false });
}
