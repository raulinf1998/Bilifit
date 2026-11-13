import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { currentAccountId } from '@/lib/account-context';
import type { AccountId } from '@/lib/accounts';
import { hasConcreteActivityName, resolveActivityTitle } from '@/lib/activity-naming';
import {
  computeTrimmedActivityData,
  previewActivityTrim,
  type TrimPreviewResult,
  type TrimSpec,
} from '@/lib/activity-trim';
import {
  computeBestEfforts,
  computeHeartRateZones,
  computeKmSplits,
  computePaceZones,
  computeSessionExtras,
  computeTerrainBreakdown,
  enrichActivityLaps,
  enrichPointsTelemetry,
} from '@/lib/analytics';
import {
  calculateStrengthSetVolumeKg,
  DEFAULT_EXERCISES,
  DEFAULT_HOME_EQUIPMENT,
  defaultExerciseImageUrl,
  resolveIsPerDumbbell,
} from '@/lib/home-workouts';
import { defaultSubSportForSport, estimateActivityTSS, isMismatchedSubSport } from '@/lib/metrics';
import { isMyWhooshContext, resolveMyWhooshWorldForActivity } from '@/lib/mywhoosh-maps';
import { decodePolyline } from '@/lib/polyline';
import { sanitizeImageList, sanitizeImageUrl } from '@/lib/uploads';
import {
  buildSeedActivityRows,
  PRESET_5DAY_ROUTINES,
  SEED_GEAR,
  SEED_PROFILE,
  SEED_ROUTES,
  SEED_ROUTINES,
} from '@/lib/seed';
import { buildSegmentFromRange, matchPointsToSegment } from '@/lib/segments';
import { emitSettingsEvent } from '@/lib/settings-events';
import {
  paletteColorsFromTheme,
  sanitizeCustomPalettes,
  sanitizePaletteColors,
} from '@/lib/theme-palettes';
import {
  DEFAULT_APP_SETTINGS,
  SETTINGS_SYNC_PROTOCOL,
  VALID_THEMES,
  type AppSettings,
  type CustomPalette,
  type ThemeId,
} from '@/lib/themes';
import type {
  Activity,
  ActivityDetail,
  ActivityExtras,
  ActivityLap,
  ActivityPoint,
  AthleteProfile,
  Exercise,
  GearItem,
  HomeEquipment,
  MountainRoute,
  Routine,
  RoutineExerciseItem,
  Segment,
  SegmentEffort,
  SportType,
  StrengthSetLog,
} from '@/types';

const dbInstances = new Map<string, Database.Database>();

export function getBaseDbPath(): string {
  const configured = process.env.BILIFIT_DB_PATH;
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.join(/*turbopackIgnore: true*/ process.cwd(), configured);
  }
  return path.join(process.cwd(), 'data', 'bilifit.db');
}

export function getDbPath(account: AccountId = currentAccountId()): string {
  const base = getBaseDbPath();
  if (account === 'raul') return base;
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  return `${stem}-${account}${ext || '.db'}`;
}

export function getDb(account: AccountId = currentAccountId()): Database.Database {
  const dbPath = getDbPath(account);
  const cached = dbInstances.get(dbPath);
  if (cached && fs.existsSync(/*turbopackIgnore: true*/ dbPath)) return cached;
  if (cached) {
    try {
      cached.close();
    } catch {
      // ignore close errors
    }
    dbInstances.delete(dbPath);
  }

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  initSchema(db);
  seedIfEmpty(db, account);
  ensureHomeEquipmentDefaults(db, account);
  ensurePreset5DayRoutines(db, account);
  backfillMyWhooshWorlds(db);
  backfillWalkingActivities(db);
  backfillSplitTrailActivities(db);
  backfillMismatchedSubSports(db);

  dbInstances.set(dbPath, db);
  return db;
}

export function ensureHomeEquipmentDefaults(db: Database.Database, account: AccountId = 'raul') {
  const migrationId = 'home_equipment_defaults_v2_cable';
  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?').get(migrationId);
  if (applied) return;

  const tx = db.transaction(() => {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO home_equipment (id, name, category, description, owned, details, is_custom)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `);
    for (const eq of DEFAULT_HOME_EQUIPMENT) {
      stmt.run(
        eq.id,
        eq.name,
        eq.category,
        eq.description,
        account === 'pequenaja' ? 0 : eq.owned ? 1 : 0,
        eq.details ?? null
      );
    }
    db.prepare('INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(
      migrationId,
      new Date().toISOString()
    );
  });
  tx();
}

export function ensurePreset5DayRoutines(db: Database.Database, account: AccountId = 'raul') {
  if (account === 'pequenaja') return;
  const migrationId = 'preset_5day_routines_v1';
  const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?').get(migrationId);
  if (applied) return;

  const tx = db.transaction(() => {
    const rtStmt = db.prepare(`
      INSERT OR IGNORE INTO routines (
        id, name, goal, level, estimated_minutes, equipment_ids_json, items_json, notes, times_completed, last_completed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const rt of PRESET_5DAY_ROUTINES) {
      rtStmt.run(
        rt.id,
        rt.name,
        rt.goal,
        rt.level,
        rt.estimatedMinutes,
        JSON.stringify(rt.equipmentIds),
        JSON.stringify(rt.items),
        rt.notes ?? null,
        rt.timesCompleted,
        rt.lastCompletedAt ?? null,
        rt.createdAt
      );
    }
    db.prepare('INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(
      migrationId,
      new Date().toISOString()
    );
  });
  tx();
}

export function backfillWalkingActivities(db: Database.Database = getDb()): number {
  const res = db
    .prepare(
      `UPDATE activities
       SET sport = 'walking',
           sub_sport = 'Caminar'
       WHERE sport = 'mountain'
         AND (
           sub_sport = 'Caminata'
           OR (external_id LIKE 'huawei_ht_%_5' AND (sub_sport IS NULL OR TRIM(sub_sport) = ''))
         )`
    )
    .run();
  return res.changes;
}

export function backfillSplitTrailActivities(db: Database.Database = getDb()): number {
  let updated = 0;
  const tx = db.transaction(() => {
    const actRes = db
      .prepare(
        `UPDATE activities
         SET sport = 'trail',
             sub_sport = 'Trail Running'
         WHERE sport = 'mountain'
           AND (
             LOWER(TRIM(COALESCE(sub_sport, ''))) IN ('trail running', 'trailrun', 'trail')
             OR external_id LIKE 'huawei_ht_%_118'
           )`
      )
      .run();
    updated += actRes.changes;

    // Normalizar antiguas etiquetas combinadas de Senderismo
    db.prepare(
      `UPDATE activities
       SET sub_sport = 'Senderismo'
       WHERE sport = 'mountain'
         AND LOWER(TRIM(COALESCE(sub_sport, ''))) IN ('montaña / senderismo', 'senderismo / montaña', 'montaña', 'montana', 'ruta de montaña')`
    ).run();

    // Actualizar segmentos creados desde actividades de Trail Running (e.g. seed Naranco)
    db.prepare(
      `UPDATE segments
       SET sport = 'trail'
       WHERE sport = 'mountain'
         AND source_activity_id IN (SELECT id FROM activities WHERE sport = 'trail')`
    ).run();

    db.prepare(
      `UPDATE gear_items
       SET default_for_sport = 'trail'
       WHERE id = 'gear_trail_shoes' AND default_for_sport = 'mountain'`
    ).run();
  });
  tx();
  return updated;
}

export function backfillMismatchedSubSports(db: Database.Database = getDb()): number {
  const rows = db
    .prepare(
      `SELECT id, sport, sub_sport
       FROM activities
       WHERE sub_sport IS NOT NULL AND TRIM(sub_sport) != ''`
    )
    .all() as Array<{ id: string; sport: string; sub_sport: string }>;

  const updateStmt = db.prepare('UPDATE activities SET sub_sport = ? WHERE id = ?');
  let updated = 0;

  const tx = db.transaction(() => {
    for (const row of rows) {
      const sport = row.sport as SportType;
      if (isMismatchedSubSport(sport, row.sub_sport)) {
        updateStmt.run(defaultSubSportForSport(sport), row.id);
        updated++;
      } else if (sport === 'running' && row.sub_sport.trim().toLowerCase() === 'asfalto') {
        updateStmt.run('Correr', row.id);
        updated++;
      }
    }
  });
  tx();

  return updated;
}

export function backfillMyWhooshWorlds(db: Database.Database = getDb()): number {
  const candidates = db
    .prepare(
      `SELECT id, sport, sub_sport, title, world_name, polyline, points_json, extras_json
       FROM activities
       WHERE (world_name IS NULL OR TRIM(world_name) = '')
         AND sport IN ('mywhoosh', 'cycling')`
    )
    .all() as Array<Record<string, unknown>>;

  if (candidates.length === 0) return 0;

  const updateStmt = db.prepare(`
    UPDATE activities
    SET sport = ?, sub_sport = ?, world_name = ?
    WHERE id = ?
  `);

  let updated = 0;
  const tx = db.transaction(() => {
    for (const row of candidates) {
      const sport = String(row.sport) as SportType;
      const subSport = row.sub_sport ? String(row.sub_sport) : null;
      const title = String(row.title ?? '');
      let deviceName: string | null = null;
      if (row.extras_json) {
        try {
          const ex = JSON.parse(String(row.extras_json)) as { deviceName?: string | null };
          deviceName = ex.deviceName ?? null;
        } catch {
          deviceName = null;
        }
      }

      const virtualCtx = isMyWhooshContext({
        sport,
        subSport,
        worldName: null,
        title,
        deviceName,
      });

      if (!virtualCtx && sport !== 'mywhoosh') continue;

      let coords: Array<[number, number]> = [];
      if (row.points_json) {
        try {
          const pts = JSON.parse(String(row.points_json)) as Array<{ lat?: number; lon?: number }>;
          coords = pts
            .filter((p): p is { lat: number; lon: number } => typeof p.lat === 'number' && typeof p.lon === 'number')
            .map((p) => [p.lat, p.lon]);
        } catch {
          coords = [];
        }
      }
      if (coords.length === 0 && row.polyline) {
        coords = decodePolyline(String(row.polyline));
      }

      const resolved = resolveMyWhooshWorldForActivity({
        worldName: null,
        title,
        sport,
        subSport,
        deviceName,
        coords,
      });

      const nextSport: SportType = virtualCtx ? 'mywhoosh' : sport;
      const nextSubSport = virtualCtx ? 'MyWhoosh Indoor' : subSport;
      const nextWorld = resolved?.world.name ?? null;

      if (nextWorld || (virtualCtx && sport !== 'mywhoosh')) {
        updateStmt.run(nextSport, nextSubSport, nextWorld, String(row.id));
        updated++;
      }
    }
  });
  tx();

  return updated;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS athlete_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT NOT NULL,
      weight_kg REAL NOT NULL DEFAULT 72,
      ftp_watts INTEGER NOT NULL DEFAULT 245,
      max_hr INTEGER NOT NULL DEFAULT 190,
      resting_hr INTEGER NOT NULL DEFAULT 50,
      lthr INTEGER NOT NULL DEFAULT 169,
      weekly_target_hours REAL NOT NULL DEFAULT 8,
      weekly_target_km REAL NOT NULL DEFAULT 55
    );

    CREATE TABLE IF NOT EXISTS strava_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      client_id TEXT,
      client_secret TEXT,
      access_token TEXT,
      refresh_token TEXT,
      expires_at INTEGER,
      athlete_id INTEGER,
      athlete_name TEXT,
      last_sync_at TEXT
    );

    CREATE TABLE IF NOT EXISTS mywhoosh_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      email TEXT,
      password_enc TEXT,
      access_token TEXT,
      refresh_token TEXT,
      whoosh_id TEXT,
      device_id TEXT,
      rider_name TEXT,
      ftp_watts INTEGER,
      token_expires_at INTEGER,
      auto_sync_enabled INTEGER NOT NULL DEFAULT 0,
      sync_interval_min INTEGER NOT NULL DEFAULT 15,
      sync_in_progress INTEGER NOT NULL DEFAULT 0,
      sync_started_at TEXT,
      last_sync_at TEXT,
      last_sync_status TEXT NOT NULL DEFAULT 'idle',
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS mywhoosh_imports (
      activity_id TEXT PRIMARY KEY,
      activity_file_id TEXT,
      local_activity_id TEXT,
      title TEXT NOT NULL,
      started_at TEXT,
      status TEXT NOT NULL DEFAULT 'imported',
      error TEXT,
      imported_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS huawei_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      watch_dir TEXT,
      google_client_id TEXT,
      google_client_secret_enc TEXT,
      google_access_token TEXT,
      google_refresh_token TEXT,
      google_token_expires_at INTEGER,
      google_account_email TEXT,
      drive_folder_id TEXT,
      drive_folder_name TEXT,
      auto_sync_enabled INTEGER NOT NULL DEFAULT 0,
      sync_interval_min INTEGER NOT NULL DEFAULT 15,
      sync_in_progress INTEGER NOT NULL DEFAULT 0,
      sync_started_at TEXT,
      last_sync_at TEXT,
      last_sync_status TEXT NOT NULL DEFAULT 'idle',
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS huawei_imports (
      item_key TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      drive_file_id TEXT,
      local_activity_id TEXT,
      title TEXT NOT NULL,
      started_at TEXT,
      channel TEXT NOT NULL DEFAULT 'folder',
      status TEXT NOT NULL DEFAULT 'imported',
      error TEXT,
      imported_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gear_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      brand TEXT,
      category TEXT NOT NULL,
      default_for_sport TEXT,
      initial_km REAL NOT NULL DEFAULT 0,
      max_km REAL NOT NULL DEFAULT 800,
      active INTEGER NOT NULL DEFAULT 1,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      external_id TEXT UNIQUE,
      source TEXT NOT NULL,
      sport TEXT NOT NULL,
      sub_sport TEXT,
      title TEXT NOT NULL,
      description TEXT,
      started_at TEXT NOT NULL,
      duration_sec INTEGER NOT NULL DEFAULT 0,
      moving_time_sec INTEGER NOT NULL DEFAULT 0,
      distance_meters REAL NOT NULL DEFAULT 0,
      elevation_gain REAL NOT NULL DEFAULT 0,
      elevation_loss REAL NOT NULL DEFAULT 0,
      avg_speed_ms REAL,
      max_speed_ms REAL,
      avg_hr INTEGER,
      max_hr INTEGER,
      avg_watts INTEGER,
      normalized_power INTEGER,
      max_watts INTEGER,
      avg_cadence INTEGER,
      calories INTEGER,
      tss INTEGER NOT NULL DEFAULT 0,
      rpe REAL,
      gear_id TEXT,
      world_name TEXT,
      polyline TEXT,
      start_lat REAL,
      start_lon REAL,
      points_json TEXT,
      strength_logs_json TEXT,
      total_volume_kg REAL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_activities_started_at ON activities(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_activities_sport ON activities(sport);

    CREATE TABLE IF NOT EXISTS mountain_routes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      region TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      sport TEXT NOT NULL DEFAULT 'mountain',
      distance_meters REAL NOT NULL DEFAULT 0,
      elevation_gain REAL NOT NULL DEFAULT 0,
      elevation_loss REAL NOT NULL DEFAULT 0,
      max_ele REAL NOT NULL DEFAULT 0,
      min_ele REAL NOT NULL DEFAULT 0,
      estimated_time_sec INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      notes TEXT,
      polyline TEXT,
      points_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS home_equipment (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      owned INTEGER NOT NULL DEFAULT 0,
      details TEXT,
      is_custom INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS custom_exercises (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      muscle_group TEXT NOT NULL,
      secondary_muscles_json TEXT NOT NULL,
      required_equipment_json TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      pattern TEXT NOT NULL,
      sport_benefit_json TEXT NOT NULL,
      default_sets INTEGER NOT NULL DEFAULT 3,
      default_reps TEXT NOT NULL,
      rest_seconds INTEGER NOT NULL DEFAULT 60,
      instructions TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS routines (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      goal TEXT NOT NULL,
      level TEXT NOT NULL,
      estimated_minutes INTEGER NOT NULL,
      equipment_ids_json TEXT NOT NULL,
      items_json TEXT NOT NULL,
      notes TEXT,
      times_completed INTEGER NOT NULL DEFAULT 0,
      last_completed_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS segments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sport TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'custom',
      distance_meters REAL NOT NULL,
      elevation_gain REAL NOT NULL DEFAULT 0,
      avg_grade_pct REAL NOT NULL DEFAULT 0,
      max_grade_pct REAL NOT NULL DEFAULT 0,
      start_lat REAL NOT NULL,
      start_lon REAL NOT NULL,
      end_lat REAL NOT NULL,
      end_lon REAL NOT NULL,
      polyline TEXT NOT NULL,
      points_json TEXT NOT NULL,
      source_activity_id TEXT,
      world_name TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS segment_efforts (
      id TEXT PRIMARY KEY,
      segment_id TEXT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
      activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
      duration_sec INTEGER NOT NULL,
      avg_speed_ms REAL NOT NULL,
      avg_hr INTEGER,
      max_hr INTEGER,
      avg_watts INTEGER,
      avg_cadence INTEGER,
      vam_mh INTEGER,
      started_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_seg_efforts_segment ON segment_efforts(segment_id, duration_sec ASC);
    CREATE INDEX IF NOT EXISTS idx_seg_efforts_activity ON segment_efforts(activity_id);

    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      theme TEXT NOT NULL DEFAULT 'calido',
      dark INTEGER NOT NULL DEFAULT 0,
      custom_palettes_json TEXT NOT NULL DEFAULT '[]',
      custom_palette_id TEXT,
      settings_version INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS exercise_media (
      exercise_id TEXT PRIMARY KEY,
      image_url TEXT,
      updated_at TEXT NOT NULL
    );
  `);

  // Migración segura para bases de datos existentes
  ensureColumn(db, 'activities', 'laps_json', 'TEXT');
  ensureColumn(db, 'activities', 'extras_json', 'TEXT');
  ensureColumn(db, 'activities', 'done_together', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'activities', 'exclude_paused_time', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'activities', 'trimmed', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'activities', 'images_json', 'TEXT');
  ensureColumn(db, 'custom_exercises', 'image_url', 'TEXT');
  ensureColumn(db, 'custom_exercises', 'per_dumbbell', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'routines', 'cover_image_url', 'TEXT');
}

function ensureColumn(db: Database.Database, table: string, column: string, colType: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${colType}`);
  }
}

function seedIfEmpty(db: Database.Database, account: AccountId = 'raul') {
  const profileCount = db.prepare('SELECT COUNT(*) as c FROM athlete_profile').get() as { c: number };
  if (profileCount.c === 0) {
    const profileSeed: AthleteProfile =
      account === 'pequenaja'
        ? {
            name: 'Pequeñaja',
            weightKg: 58,
            ftpWatts: 175,
            maxHr: 192,
            restingHr: 55,
            lthr: 172,
            weeklyTargetHours: 5,
            weeklyTargetKm: 35,
          }
        : SEED_PROFILE;

    db.prepare(`
      INSERT INTO athlete_profile (id, name, weight_kg, ftp_watts, max_hr, resting_hr, lthr, weekly_target_hours, weekly_target_km)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      profileSeed.name,
      profileSeed.weightKg,
      profileSeed.ftpWatts,
      profileSeed.maxHr,
      profileSeed.restingHr,
      profileSeed.lthr,
      profileSeed.weeklyTargetHours,
      profileSeed.weeklyTargetKm
    );
  }

  const settingsCount = db.prepare('SELECT COUNT(*) as c FROM app_settings').get() as { c: number };
  if (settingsCount.c === 0) {
    db.prepare(`
      INSERT INTO app_settings (id, theme, dark, custom_palettes_json, custom_palette_id, settings_version, updated_at)
      VALUES (1, ?, ?, '[]', NULL, 0, ?)
    `).run(
      DEFAULT_APP_SETTINGS.theme,
      DEFAULT_APP_SETTINGS.dark ? 1 : 0,
      new Date().toISOString()
    );
  }

  const stravaCount = db.prepare('SELECT COUNT(*) as c FROM strava_config').get() as { c: number };
  if (stravaCount.c === 0) {
    db.prepare('INSERT INTO strava_config (id) VALUES (1)').run();
  }

  const mwCount = db.prepare('SELECT COUNT(*) as c FROM mywhoosh_config').get() as { c: number };
  if (mwCount.c === 0) {
    db.prepare('INSERT INTO mywhoosh_config (id) VALUES (1)').run();
  }

  const hwCount = db.prepare('SELECT COUNT(*) as c FROM huawei_config').get() as { c: number };
  if (hwCount.c === 0) {
    db.prepare('INSERT INTO huawei_config (id) VALUES (1)').run();
  }

  const eqCount = db.prepare('SELECT COUNT(*) as c FROM home_equipment').get() as { c: number };
  if (eqCount.c === 0) {
    const stmt = db.prepare(`
      INSERT INTO home_equipment (id, name, category, description, owned, details, is_custom)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `);
    const insertMany = db.transaction(() => {
      for (const eq of DEFAULT_HOME_EQUIPMENT) {
        stmt.run(
          eq.id,
          eq.name,
          eq.category,
          eq.description,
          account === 'pequenaja' ? 0 : eq.owned ? 1 : 0,
          eq.details ?? null
        );
      }
    });
    insertMany();
  }

  // El perfil de Pequeñaja comienza limpio (sin actividades ni rutas/material de Raúl).
  if (account === 'pequenaja') {
    return;
  }

  const actCount = db.prepare('SELECT COUNT(*) as c FROM activities').get() as { c: number };
  const gearCount = db.prepare('SELECT COUNT(*) as c FROM gear_items').get() as { c: number };

  if (gearCount.c === 0) {
    const gStmt = db.prepare(`
      INSERT INTO gear_items (id, name, brand, category, default_for_sport, initial_km, max_km, active, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const g of SEED_GEAR) {
      gStmt.run(g.id, g.name, g.brand ?? null, g.category, g.defaultForSport ?? null, g.initialKm, g.maxKm, g.active ? 1 : 0, g.notes ?? null);
    }
  }

  if (actCount.c === 0) {
    const rows = buildSeedActivityRows(SEED_PROFILE);
    const aStmt = db.prepare(`
      INSERT INTO activities (
        id, external_id, source, sport, sub_sport, title, description, started_at,
        duration_sec, moving_time_sec, distance_meters, elevation_gain, elevation_loss,
        avg_speed_ms, max_speed_ms, avg_hr, max_hr, avg_watts, normalized_power, max_watts,
        avg_cadence, calories, tss, rpe, gear_id, world_name, polyline, start_lat, start_lon,
        points_json, strength_logs_json, total_volume_kg, laps_json, extras_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = db.transaction(() => {
      for (const r of rows) {
        aStmt.run(
          r.id,
          r.externalId,
          r.source,
          r.sport,
          r.subSport,
          r.title,
          r.description,
          r.startedAt,
          r.durationSec,
          r.movingTimeSec,
          r.distanceMeters,
          r.elevationGain,
          r.elevationLoss,
          r.avgSpeedMs,
          r.maxSpeedMs,
          r.avgHr,
          r.maxHr,
          r.avgWatts,
          r.normalizedPower,
          r.maxWatts,
          r.avgCadence,
          r.calories,
          r.tss,
          r.rpe,
          r.gearId,
          r.worldName,
          r.polyline,
          r.startLat,
          r.startLon,
          JSON.stringify(r.points),
          JSON.stringify(r.strengthLogs),
          r.totalVolumeKg,
          JSON.stringify(r.laps ?? []),
          JSON.stringify(r.extras ?? null),
          r.createdAt
        );
      }
    });
    tx();
  }

  const routeCount = db.prepare('SELECT COUNT(*) as c FROM mountain_routes').get() as { c: number };
  if (routeCount.c === 0) {
    const rStmt = db.prepare(`
      INSERT INTO mountain_routes (
        id, name, region, difficulty, sport, distance_meters, elevation_gain, elevation_loss,
        max_ele, min_ele, estimated_time_sec, status, notes, polyline, points_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of SEED_ROUTES) {
      rStmt.run(
        r.id,
        r.name,
        r.region,
        r.difficulty,
        r.sport,
        r.distanceMeters,
        r.elevationGain,
        r.elevationLoss,
        r.maxEle,
        r.minEle,
        r.estimatedTimeSec,
        r.status,
        r.notes ?? null,
        r.polyline ?? null,
        JSON.stringify(r.points),
        r.createdAt
      );
    }
  }

  const routineCount = db.prepare('SELECT COUNT(*) as c FROM routines').get() as { c: number };
  if (routineCount.c === 0) {
    const rtStmt = db.prepare(`
      INSERT INTO routines (
        id, name, goal, level, estimated_minutes, equipment_ids_json, items_json, notes, times_completed, last_completed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const rt of SEED_ROUTINES) {
      rtStmt.run(
        rt.id,
        rt.name,
        rt.goal,
        rt.level,
        rt.estimatedMinutes,
        JSON.stringify(rt.equipmentIds),
        JSON.stringify(rt.items),
        rt.notes ?? null,
        rt.timesCompleted,
        rt.lastCompletedAt ?? null,
        rt.createdAt
      );
    }
  }

  const segCount = db.prepare('SELECT COUNT(*) as c FROM segments').get() as { c: number };
  if (segCount.c === 0) {
    seedInitialSegments(db);
  }
}

function seedInitialSegments(db: Database.Database) {
  const candidates: Array<{ actId: string; name: string; startFrac: number; endFrac: number; cat: Segment['category'] }> = [
    { actId: 'act_seed_mtn_1', name: 'Subida Pico Paisano · Monte Naranco', startFrac: 0.08, endFrac: 0.45, cat: 'climb' },
    { actId: 'act_seed_run_1', name: 'Recta Pista Finlandesa (Oviedo)', startFrac: 0.15, endFrac: 0.45, cat: 'sprint' },
    { actId: 'act_seed_mw_1', name: 'Hudayriyat Velodrome Loop (MyWhoosh)', startFrac: 0.1, endFrac: 0.52, cat: 'flat' },
  ];

  const allActRows = db
    .prepare('SELECT id, title, started_at, sport, world_name, points_json, distance_meters FROM activities WHERE points_json IS NOT NULL')
    .all() as Array<Record<string, unknown>>;

  const parsedActs = allActRows
    .map((r) => {
      try {
        const pts = JSON.parse(String(r.points_json)) as ActivityPoint[];
        return {
          id: String(r.id),
          title: String(r.title),
          startedAt: String(r.started_at),
          sport: String(r.sport) as SportType,
          worldName: r.world_name ? String(r.world_name) : null,
          distanceMeters: Number(r.distance_meters),
          points: pts,
        };
      } catch {
        return null;
      }
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x && x.points.length >= 10));

  for (const c of candidates) {
    const src = parsedActs.find((a) => a.id === c.actId);
    if (!src) continue;
    const totalD = src.points[src.points.length - 1]?.dist ?? src.distanceMeters;
    if (totalD < 600) continue;

    const seg = buildSegmentFromRange({
      activity: src,
      points: src.points,
      startDistM: Math.round(totalD * c.startFrac),
      endDistM: Math.round(totalD * c.endFrac),
      name: c.name,
      category: c.cat,
    });
    if (!seg) continue;

    insertSegmentRow(db, seg);
    for (const act of parsedActs) {
      if (act.sport !== seg.sport) continue;
      const eff = matchPointsToSegment(act, act.points, seg);
      if (eff) insertSegmentEffortRow(db, eff);
    }
  }
}

// ===== HELPERS DE ACCESO A DATOS =====

export function getAthleteProfile(): AthleteProfile {
  const db = getDb();
  const row = db.prepare('SELECT * FROM athlete_profile WHERE id = 1').get() as Record<string, unknown>;
  return {
    name: String(row.name),
    weightKg: Number(row.weight_kg),
    ftpWatts: Number(row.ftp_watts),
    maxHr: Number(row.max_hr),
    restingHr: Number(row.resting_hr),
    lthr: Number(row.lthr),
    weeklyTargetHours: Number(row.weekly_target_hours),
    weeklyTargetKm: Number(row.weekly_target_km),
  };
}

export function updateAthleteProfile(patch: Partial<AthleteProfile>): AthleteProfile {
  const current = getAthleteProfile();
  const next = { ...current, ...patch };
  getDb()
    .prepare(`
      UPDATE athlete_profile
      SET name = ?, weight_kg = ?, ftp_watts = ?, max_hr = ?, resting_hr = ?, lthr = ?, weekly_target_hours = ?, weekly_target_km = ?
      WHERE id = 1
    `)
    .run(
      next.name,
      next.weightKg,
      next.ftpWatts,
      next.maxHr,
      next.restingHr,
      next.lthr,
      next.weeklyTargetHours,
      next.weeklyTargetKm
    );
  return next;
}

function mapActivityRow(row: Record<string, unknown>): Activity {
  let laps: ActivityLap[] | undefined;
  let extras: ActivityExtras | null = null;
  let images: string[] = [];
  try {
    if (row.laps_json) laps = JSON.parse(String(row.laps_json));
  } catch {
    laps = undefined;
  }
  try {
    if (row.extras_json) extras = JSON.parse(String(row.extras_json));
  } catch {
    extras = null;
  }
  try {
    if (row.images_json) images = sanitizeImageList(JSON.parse(String(row.images_json)));
  } catch {
    images = [];
  }

  return {
    id: String(row.id),
    externalId: row.external_id ? String(row.external_id) : null,
    source: row.source as Activity['source'],
    sport: row.sport as SportType,
    subSport: row.sub_sport ? String(row.sub_sport) : null,
    title: String(row.title),
    description: row.description ? String(row.description) : null,
    startedAt: String(row.started_at),
    durationSec: Number(row.duration_sec),
    movingTimeSec: Number(row.moving_time_sec),
    distanceMeters: Number(row.distance_meters),
    elevationGain: Number(row.elevation_gain),
    elevationLoss: Number(row.elevation_loss),
    avgSpeedMs: row.avg_speed_ms != null ? Number(row.avg_speed_ms) : null,
    maxSpeedMs: row.max_speed_ms != null ? Number(row.max_speed_ms) : null,
    avgHr: row.avg_hr != null ? Number(row.avg_hr) : null,
    maxHr: row.max_hr != null ? Number(row.max_hr) : null,
    avgWatts: row.avg_watts != null ? Number(row.avg_watts) : null,
    normalizedPower: row.normalized_power != null ? Number(row.normalized_power) : null,
    maxWatts: row.max_watts != null ? Number(row.max_watts) : null,
    avgCadence: row.avg_cadence != null ? Number(row.avg_cadence) : null,
    calories: row.calories != null ? Number(row.calories) : null,
    tss: Number(row.tss),
    rpe: row.rpe != null ? Number(row.rpe) : null,
    gearId: row.gear_id ? String(row.gear_id) : null,
    gearName: row.gear_name ? String(row.gear_name) : null,
    worldName: row.world_name ? String(row.world_name) : null,
    polyline: row.polyline ? String(row.polyline) : null,
    startLat: row.start_lat != null ? Number(row.start_lat) : null,
    startLon: row.start_lon != null ? Number(row.start_lon) : null,
    totalVolumeKg: row.total_volume_kg != null ? Number(row.total_volume_kg) : null,
    doneTogether: Boolean(row.done_together),
    excludePausedTime: Boolean(row.exclude_paused_time),
    trimmed: Boolean(row.trimmed),
    images,
    laps,
    extras,
    createdAt: String(row.created_at),
  };
}

export function listActivities(filters?: {
  sport?: string;
  q?: string;
  doneTogether?: boolean;
  limit?: number;
  from?: string;
  to?: string;
}): Activity[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters?.sport && filters.sport !== 'all') {
    clauses.push('a.sport = ?');
    params.push(filters.sport);
  }
  if (filters?.doneTogether) {
    clauses.push('a.done_together = 1');
  }
  if (filters?.from) {
    clauses.push("(strftime('%s', a.started_at) + 0) >= (strftime('%s', ?) + 0)");
    params.push(filters.from);
  }
  if (filters?.to) {
    clauses.push("(strftime('%s', a.started_at) + 0) < (strftime('%s', ?) + 0)");
    params.push(filters.to);
  }
  if (filters?.q && filters.q.trim()) {
    clauses.push('(LOWER(a.title) LIKE ? OR LOWER(COALESCE(a.description, \'\')) LIKE ?)');
    const like = `%${filters.q.trim().toLowerCase()}%`;
    params.push(like, like);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limitSql = filters?.limit ? `LIMIT ${Math.max(1, Math.min(500, filters.limit))}` : '';

  const rows = db
    .prepare(`
      SELECT a.*, g.name AS gear_name
      FROM activities a
      LEFT JOIN gear_items g ON a.gear_id = g.id
      ${where}
      ORDER BY a.started_at DESC
      ${limitSql}
    `)
    .all(...params) as Record<string, unknown>[];

  return rows.map(mapActivityRow);
}

export function getActivityById(id: string): ActivityDetail | null {
  const db = getDb();
  const row = db
    .prepare(`
      SELECT a.*, g.name AS gear_name
      FROM activities a
      LEFT JOIN gear_items g ON a.gear_id = g.id
      WHERE a.id = ?
    `)
    .get(id) as Record<string, unknown> | undefined;

  if (!row) return null;

  let points: ActivityPoint[] = [];
  let strengthLogs: StrengthSetLog[] = [];
  try {
    if (row.points_json) points = JSON.parse(String(row.points_json));
  } catch {
    points = [];
  }
  try {
    if (row.strength_logs_json) strengthLogs = JSON.parse(String(row.strength_logs_json));
  } catch {
    strengthLogs = [];
  }

  const mapped = mapActivityRow(row);
  const excludePaused = Boolean(mapped.excludePausedTime);
  const enrichedPoints = points.length > 0 ? enrichPointsTelemetry(points, mapped.sport) : [];
  const profile = getAthleteProfile();
  const extras = computeSessionExtras(mapped, enrichedPoints);
  const enrichedLaps = enrichActivityLaps(mapped.laps, enrichedPoints, mapped);
  const kmSplits = enrichedPoints.length > 1 ? computeKmSplits(enrichedPoints, mapped.sport, excludePaused) : [];
  const bestEfforts = enrichedPoints.length > 3 ? computeBestEfforts(enrichedPoints, mapped.sport) : [];
  const hrZones = enrichedPoints.length > 1 ? computeHeartRateZones(enrichedPoints, profile, excludePaused) : [];
  const paceZones = enrichedPoints.length > 1 ? computePaceZones(enrichedPoints, mapped.sport, excludePaused) : [];
  const terrainBreakdown = enrichedPoints.length > 2 ? computeTerrainBreakdown(enrichedPoints, excludePaused) : [];
  const segmentEfforts = getActivitySegmentEfforts(id);

  return {
    ...mapped,
    laps: enrichedLaps,
    extras,
    points: enrichedPoints,
    strengthLogs,
    kmSplits,
    bestEfforts,
    hrZones,
    paceZones,
    terrainBreakdown,
    segmentEfforts,
  };
}

export function findDefaultGearForSport(sport: SportType): string | null {
  const row = getDb()
    .prepare('SELECT id FROM gear_items WHERE active = 1 AND default_for_sport = ? LIMIT 1')
    .get(sport) as { id: string } | undefined;
  return row?.id ?? null;
}

export function createActivity(input: Omit<ActivityDetail, 'gearName' | 'powerCurve'>): ActivityDetail {
  const db = getDb();
  const gearId = input.gearId ?? findDefaultGearForSport(input.sport);
  const enrichedPoints = input.points && input.points.length > 0 ? enrichPointsTelemetry(input.points, input.sport) : [];
  const extras = input.extras ?? (enrichedPoints.length > 0 ? computeSessionExtras(input, enrichedPoints) : null);
  const normalizedSubSport =
    input.subSport && isMismatchedSubSport(input.sport, input.subSport)
      ? defaultSubSportForSport(input.sport)
      : input.sport === 'running' && input.subSport?.trim().toLowerCase() === 'asfalto'
        ? 'Correr'
        : input.subSport ?? null;

  db.prepare(`
    INSERT INTO activities (
      id, external_id, source, sport, sub_sport, title, description, started_at,
      duration_sec, moving_time_sec, distance_meters, elevation_gain, elevation_loss,
      avg_speed_ms, max_speed_ms, avg_hr, max_hr, avg_watts, normalized_power, max_watts,
      avg_cadence, calories, tss, rpe, gear_id, world_name, polyline, start_lat, start_lon,
      points_json, strength_logs_json, total_volume_kg, done_together, exclude_paused_time, images_json, laps_json, extras_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.externalId ?? null,
    input.source,
    input.sport,
    normalizedSubSport,
    input.title,
    input.description ?? null,
    input.startedAt,
    input.durationSec,
    input.movingTimeSec,
    input.distanceMeters,
    input.elevationGain,
    input.elevationLoss,
    input.avgSpeedMs ?? null,
    input.maxSpeedMs ?? null,
    input.avgHr ?? null,
    input.maxHr ?? null,
    input.avgWatts ?? null,
    input.normalizedPower ?? null,
    input.maxWatts ?? null,
    input.avgCadence ?? null,
    input.calories ?? null,
    input.tss,
    input.rpe ?? null,
    gearId,
    input.worldName ?? null,
    input.polyline ?? null,
    input.startLat ?? null,
    input.startLon ?? null,
    JSON.stringify(enrichedPoints),
    JSON.stringify(input.strengthLogs ?? []),
    input.totalVolumeKg ?? null,
    input.doneTogether ? 1 : 0,
    input.excludePausedTime ? 1 : 0,
    JSON.stringify(sanitizeImageList(input.images ?? [])),
    JSON.stringify(input.laps ?? []),
    JSON.stringify(extras),
    input.createdAt
  );

  // Emparejar automáticamente la nueva actividad contra todos los segmentos existentes
  if (enrichedPoints.some((p) => typeof p.lat === 'number' && typeof p.lon === 'number')) {
    const segments = listSegments();
    for (const seg of segments) {
      if (seg.sport !== input.sport) continue;
      const effort = matchPointsToSegment(input, enrichedPoints, seg);
      if (effort) {
        insertSegmentEffortRow(db, effort);
      }
    }
  }

  return getActivityById(input.id)!;
}

export function findActivityIdByExternalId(externalId: string): string | null {
  const row = getDb().prepare('SELECT id FROM activities WHERE external_id = ?').get(externalId) as { id: string } | undefined;
  return row?.id ?? null;
}

export function hasActivityWithExternalId(externalId: string): boolean {
  return Boolean(findActivityIdByExternalId(externalId));
}

export interface RefreshActivitySourceInput {
  externalId?: string | null;
  sport: SportType;
  subSport?: string | null;
  title: string;
  description?: string | null;
  startedAt: string;
  durationSec: number;
  movingTimeSec: number;
  distanceMeters: number;
  elevationGain: number;
  elevationLoss: number;
  avgSpeedMs?: number | null;
  maxSpeedMs?: number | null;
  avgHr?: number | null;
  maxHr?: number | null;
  avgWatts?: number | null;
  normalizedPower?: number | null;
  maxWatts?: number | null;
  avgCadence?: number | null;
  calories?: number | null;
  tss: number;
  worldName?: string | null;
  polyline?: string | null;
  startLat?: number | null;
  startLon?: number | null;
  points: ActivityPoint[];
  laps?: ActivityLap[];
  extras?: ActivityExtras | null;
}

/**
 * Actualiza de forma segura una actividad ya existente desde su archivo/fuente original
 * preservando ediciones manuales del usuario (título concreto, RPE, descripción, material,
 * doneTogether, excludePausedTime y rutas recortadas).
 */
export function refreshActivityFromSource(existingId: string, incoming: RefreshActivitySourceInput): ActivityDetail | null {
  const existing = getActivityById(existingId);
  if (!existing) return null;

  const db = getDb();
  // Si el usuario cambió manualmente el deporte a algo distinto (salvo migraciones legacy mountain->trail/walking o cycling->mywhoosh) conservar el deporte del usuario
  const isLegacyUpgrade =
    (existing.sport === 'mountain' && (incoming.sport === 'trail' || incoming.sport === 'walking')) ||
    (existing.sport === 'cycling' && incoming.sport === 'mywhoosh');
  const nextSport = isLegacyUpgrade ? incoming.sport : existing.sport;
  const nextSubSport =
    existing.subSport && !isMismatchedSubSport(nextSport, existing.subSport)
      ? existing.subSport
      : incoming.subSport && !isMismatchedSubSport(nextSport, incoming.subSport)
        ? incoming.subSport
        : defaultSubSportForSport(nextSport);

  const nextTitle = hasConcreteActivityName(existing.title)
    ? existing.title
    : resolveActivityTitle(incoming.title, nextSport, existing.trimmed ? existing.startedAt : incoming.startedAt);

  const nextWorldName = existing.worldName ?? incoming.worldName ?? null;
  const nextDescription = existing.description && existing.description.trim() ? existing.description : incoming.description ?? null;

  if (existing.trimmed) {
    const mergedLaps = (existing.laps?.length ?? 0) > 0 ? existing.laps : incoming.laps ?? [];
    db.prepare(`
      UPDATE activities
      SET external_id = COALESCE(external_id, ?),
          sport = ?,
          sub_sport = ?,
          title = ?,
          description = ?,
          world_name = ?,
          laps_json = ?
      WHERE id = ?
    `).run(
      incoming.externalId ?? null,
      nextSport,
      nextSubSport,
      nextTitle,
      nextDescription,
      nextWorldName,
      JSON.stringify(mergedLaps),
      existingId
    );
    return getActivityById(existingId);
  }

  const enrichedPoints =
    incoming.points && incoming.points.length > 0
      ? enrichPointsTelemetry(incoming.points, nextSport)
      : existing.points;
  const mergedLaps =
    incoming.laps && incoming.laps.length > 0
      ? incoming.laps
      : existing.laps ?? [];
  const nextDurationSec = incoming.durationSec > 0 ? incoming.durationSec : existing.durationSec;
  const nextMovingTimeSec =
    incoming.movingTimeSec > 0
      ? Math.min(nextDurationSec, incoming.movingTimeSec)
      : Math.min(nextDurationSec, existing.movingTimeSec > 0 ? existing.movingTimeSec : nextDurationSec);
  const nextDistance = incoming.distanceMeters > 0 ? incoming.distanceMeters : existing.distanceMeters;
  const nextExtras = computeSessionExtras(
    {
      sport: nextSport,
      durationSec: nextDurationSec,
      movingTimeSec: nextMovingTimeSec,
      distanceMeters: nextDistance,
      elevationGain: incoming.elevationGain,
      avgSpeedMs: incoming.avgSpeedMs ?? existing.avgSpeedMs ?? null,
      avgHr: incoming.avgHr ?? existing.avgHr ?? null,
      avgWatts: incoming.avgWatts ?? existing.avgWatts ?? null,
      normalizedPower: incoming.normalizedPower ?? existing.normalizedPower ?? null,
      extras: incoming.extras ?? existing.extras ?? null,
    },
    enrichedPoints
  );

  db.prepare(`
    UPDATE activities
    SET external_id = COALESCE(external_id, ?),
        sport = ?,
        sub_sport = ?,
        title = ?,
        description = ?,
        started_at = ?,
        duration_sec = ?,
        moving_time_sec = ?,
        distance_meters = ?,
        elevation_gain = ?,
        elevation_loss = ?,
        avg_speed_ms = ?,
        max_speed_ms = ?,
        avg_hr = ?,
        max_hr = ?,
        avg_watts = ?,
        normalized_power = ?,
        max_watts = ?,
        avg_cadence = ?,
        calories = ?,
        tss = ?,
        world_name = ?,
        polyline = ?,
        start_lat = ?,
        start_lon = ?,
        points_json = ?,
        laps_json = ?,
        extras_json = ?
    WHERE id = ?
  `).run(
    incoming.externalId ?? null,
    nextSport,
    nextSubSport,
    nextTitle,
    nextDescription,
    incoming.startedAt || existing.startedAt,
    nextDurationSec,
    nextMovingTimeSec,
    nextDistance,
    incoming.elevationGain,
    incoming.elevationLoss,
    incoming.avgSpeedMs ?? existing.avgSpeedMs ?? null,
    incoming.maxSpeedMs ?? existing.maxSpeedMs ?? null,
    incoming.avgHr ?? existing.avgHr ?? null,
    incoming.maxHr ?? existing.maxHr ?? null,
    incoming.avgWatts ?? existing.avgWatts ?? null,
    incoming.normalizedPower ?? existing.normalizedPower ?? null,
    incoming.maxWatts ?? existing.maxWatts ?? null,
    incoming.avgCadence ?? existing.avgCadence ?? null,
    incoming.calories ?? existing.calories ?? null,
    existing.rpe && !incoming.avgHr && !incoming.avgWatts && !incoming.normalizedPower ? existing.tss : incoming.tss,
    nextWorldName,
    incoming.polyline ?? existing.polyline ?? null,
    incoming.startLat ?? existing.startLat ?? null,
    incoming.startLon ?? existing.startLon ?? null,
    JSON.stringify(enrichedPoints),
    JSON.stringify(mergedLaps),
    JSON.stringify(nextExtras),
    existingId
  );

  return getActivityById(existingId);
}

export function findDuplicateActivityId(startedAt: string, sport: SportType, distanceMeters: number, externalId?: string | null): string | null {
  const db = getDb();
  if (externalId) {
    const byExt = db.prepare('SELECT id FROM activities WHERE external_id = ?').get(externalId) as { id: string } | undefined;
    if (byExt) return byExt.id;
  }
  const ts = Date.parse(startedAt);
  if (!Number.isFinite(ts)) return null;
  const minIso = new Date(ts - 180_000).toISOString();
  const maxIso = new Date(ts + 180_000).toISOString();
  const rows = db
    .prepare('SELECT id, distance_meters FROM activities WHERE sport = ? AND started_at BETWEEN ? AND ?')
    .all(sport, minIso, maxIso) as Array<{ id: string; distance_meters: number }>;
  const match = rows.find((r) => Math.abs(r.distance_meters - distanceMeters) < 250);
  return match?.id ?? null;
}

export function findDuplicateActivity(startedAt: string, sport: SportType, distanceMeters: number, externalId?: string | null): boolean {
  return Boolean(findDuplicateActivityId(startedAt, sport, distanceMeters, externalId));
}

export function updateActivity(
  id: string,
  patch: Partial<{
    title: string;
    sport: SportType;
    subSport: string | null;
    description: string | null;
    rpe: number | null;
    gearId: string | null;
    worldName: string | null;
    doneTogether: boolean;
    excludePausedTime: boolean;
    images: string[];
    strengthLogs: StrengthSetLog[];
  }>
): ActivityDetail | null {
  const existing = getActivityById(id);
  if (!existing) return null;

  const db = getDb();
  const nextSport = patch.sport ?? existing.sport;
  const sportChanged = Boolean(patch.sport && patch.sport !== existing.sport);
  const nextRpe = patch.rpe !== undefined ? patch.rpe : existing.rpe ?? null;
  const nextDoneTogether = patch.doneTogether !== undefined ? Boolean(patch.doneTogether) : Boolean(existing.doneTogether);
  const nextExcludePaused =
    patch.excludePausedTime !== undefined ? Boolean(patch.excludePausedTime) : Boolean(existing.excludePausedTime);
  const nextImages = patch.images !== undefined ? sanitizeImageList(patch.images) : existing.images ?? [];

  let nextStrengthLogs = existing.strengthLogs ?? [];
  let nextTotalVolumeKg = existing.totalVolumeKg ?? null;
  if (Array.isArray(patch.strengthLogs)) {
    const exerciseLookup = new Map(listAllExercises().map((ex) => [ex.id, ex]));
    let computedVolume = 0;
    nextStrengthLogs = patch.strengthLogs
      .map((ex) => {
        const meta = exerciseLookup.get(ex.exerciseId);
        const perDumbbell = resolveIsPerDumbbell(ex, meta?.perDumbbell);
        const cleanSets = (ex.sets ?? [])
          .filter((s) => s && s.completed !== false)
          .map((s) => {
            const weightRaw = Number(s.weightKg);
            const weightKg = Number.isFinite(weightRaw) && weightRaw >= 0 ? Math.round(weightRaw * 100) / 100 : 0;
            const durationRaw = Number(s.durationSec);
            const hasDuration = Number.isFinite(durationRaw) && durationRaw > 0;
            const repsRaw = Number(s.reps);
            const reps = hasDuration
              ? 1
              : Number.isFinite(repsRaw) && repsRaw >= 0
                ? Math.round(repsRaw)
                : 0;
            return {
              reps,
              weightKg,
              ...(hasDuration ? { durationSec: Math.round(durationRaw) } : {}),
              completed: true,
            };
          });
        for (const s of cleanSets) {
          computedVolume += calculateStrengthSetVolumeKg(s, perDumbbell);
        }
        return {
          exerciseId: String(ex.exerciseId || `ex_custom_${crypto.randomUUID().slice(0, 6)}`),
          exerciseName: String(ex.exerciseName || meta?.name || 'Ejercicio').trim() || 'Ejercicio',
          equipmentUsed: Array.isArray(ex.equipmentUsed)
            ? ex.equipmentUsed.map((eq) => String(eq))
            : (meta?.requiredEquipment ?? []),
          ...(perDumbbell ? { perDumbbell: true } : typeof ex.perDumbbell === 'boolean' ? { perDumbbell: ex.perDumbbell } : {}),
          sets: cleanSets,
        };
      })
      .filter((ex) => ex.sets.length > 0);
    nextTotalVolumeKg = Math.round(computedVolume);
  }

  let nextDescription = patch.description !== undefined ? patch.description : existing.description ?? null;
  if (
    Array.isArray(patch.strengthLogs) &&
    nextDescription &&
    /^Sesión en casa completada \(\d+ ejercicios? · \d+ kg movidos\)\.?$/i.test(nextDescription.trim())
  ) {
    nextDescription = `Sesión en casa completada (${nextStrengthLogs.length} ${nextStrengthLogs.length === 1 ? 'ejercicio' : 'ejercicios'} · ${nextTotalVolumeKg ?? 0} kg movidos).`;
  }
  const nextSubSport =
    patch.subSport !== undefined
      ? patch.subSport && isMismatchedSubSport(nextSport, patch.subSport)
        ? defaultSubSportForSport(nextSport)
        : patch.subSport
      : sportChanged
        ? defaultSubSportForSport(nextSport)
        : existing.subSport && isMismatchedSubSport(nextSport, existing.subSport)
          ? defaultSubSportForSport(nextSport)
          : existing.subSport ?? null;

  const nextTss =
    sportChanged || (patch.rpe !== undefined && patch.rpe !== existing.rpe && !existing.avgHr && !existing.avgWatts)
      ? estimateActivityTSS(
          {
            sport: nextSport,
            durationSec: existing.durationSec,
            movingTimeSec: existing.movingTimeSec,
            avgWatts: existing.avgWatts ?? null,
            normalizedPower: existing.normalizedPower ?? null,
            avgHr: existing.avgHr ?? null,
            rpe: nextRpe,
            elevationGain: existing.elevationGain,
          },
          getAthleteProfile()
        )
      : existing.tss;

  db.prepare(`
      UPDATE activities
      SET title = ?, sport = ?, sub_sport = ?, description = ?, rpe = ?, gear_id = ?, world_name = ?, tss = ?, done_together = ?, exclude_paused_time = ?, images_json = ?, strength_logs_json = ?, total_volume_kg = ?
      WHERE id = ?
    `).run(
    patch.title ?? existing.title,
    nextSport,
    nextSubSport,
    nextDescription,
    nextRpe,
    patch.gearId !== undefined ? patch.gearId : existing.gearId ?? null,
    patch.worldName !== undefined ? patch.worldName : existing.worldName ?? null,
    nextTss,
    nextDoneTogether ? 1 : 0,
    nextExcludePaused ? 1 : 0,
    JSON.stringify(nextImages),
    JSON.stringify(nextStrengthLogs),
    nextTotalVolumeKg,
    id
  );

  if (sportChanged && existing.points.length > 1) {
    // Re-emparejar esfuerzos con los segmentos del nuevo deporte
    db.prepare(
      `DELETE FROM segment_efforts
       WHERE activity_id = ?
         AND segment_id IN (SELECT id FROM segments WHERE sport != ?)`
    ).run(id, nextSport);

    const segments = listSegments().filter((s) => s.sport === nextSport);
    const enriched = enrichPointsTelemetry(existing.points, nextSport);
    for (const seg of segments) {
      const effort = matchPointsToSegment(
        {
          id,
          title: patch.title ?? existing.title,
          startedAt: existing.startedAt,
          sport: nextSport,
          worldName: patch.worldName !== undefined ? patch.worldName : existing.worldName ?? null,
        },
        enriched,
        seg
      );
      if (effort) {
        insertSegmentEffortRow(db, effort);
      }
    }
  }

  return getActivityById(id);
}

export function trimActivity(
  id: string,
  spec: TrimSpec
): { activity: ActivityDetail; preview: TrimPreviewResult } | null {
  const existing = getActivityById(id);
  if (!existing) return null;

  const profile = getAthleteProfile();
  const fallbackRatio =
    existing.durationSec > 0 && existing.movingTimeSec > 0
      ? Math.min(1, existing.movingTimeSec / existing.durationSec)
      : 1;
  const preview = previewActivityTrim(existing.points, existing.sport, spec, fallbackRatio);
  const patch = computeTrimmedActivityData(existing, spec, profile);
  const db = getDb();

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE activities
      SET started_at = ?,
          duration_sec = ?,
          moving_time_sec = ?,
          distance_meters = ?,
          elevation_gain = ?,
          elevation_loss = ?,
          avg_speed_ms = ?,
          max_speed_ms = ?,
          avg_hr = ?,
          max_hr = ?,
          avg_watts = ?,
          normalized_power = ?,
          max_watts = ?,
          avg_cadence = ?,
          calories = ?,
          tss = ?,
          polyline = ?,
          start_lat = ?,
          start_lon = ?,
          points_json = ?,
          laps_json = ?,
          extras_json = ?,
          trimmed = 1
      WHERE id = ?
    `).run(
      patch.startedAt,
      patch.durationSec,
      patch.movingTimeSec,
      patch.distanceMeters,
      patch.elevationGain,
      patch.elevationLoss,
      patch.avgSpeedMs,
      patch.maxSpeedMs,
      patch.avgHr,
      patch.maxHr,
      patch.avgWatts,
      patch.normalizedPower,
      patch.maxWatts,
      patch.avgCadence,
      patch.calories,
      patch.tss,
      patch.polyline,
      patch.startLat,
      patch.startLon,
      JSON.stringify(patch.points),
      JSON.stringify(patch.laps),
      JSON.stringify(patch.extras),
      id
    );

    db.prepare('DELETE FROM segment_efforts WHERE activity_id = ?').run(id);
    if (patch.points.some((p) => typeof p.lat === 'number' && typeof p.lon === 'number')) {
      const segments = listSegments().filter((s) => s.sport === existing.sport);
      for (const seg of segments) {
        const effort = matchPointsToSegment(
          {
            id,
            title: existing.title,
            startedAt: patch.startedAt,
            sport: existing.sport,
            worldName: existing.worldName ?? null,
          },
          patch.points,
          seg
        );
        if (effort) {
          insertSegmentEffortRow(db, effort);
        }
      }
    }
  });
  tx();

  const updated = getActivityById(id)!;
  return { activity: updated, preview };
}

export function deleteActivity(id: string): boolean {
  const res = getDb().prepare('DELETE FROM activities WHERE id = ?').run(id);
  return res.changes > 0;
}

// ===== GEAR =====

export function listGear(): GearItem[] {
  const rows = getDb()
    .prepare(`
      SELECT g.*, COALESCE(SUM(a.distance_meters), 0) / 1000.0 AS tracked_km
      FROM gear_items g
      LEFT JOIN activities a ON a.gear_id = g.id
      GROUP BY g.id
      ORDER BY g.active DESC, g.name ASC
    `)
    .all() as Record<string, unknown>[];

  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    brand: r.brand ? String(r.brand) : null,
    category: r.category as GearItem['category'],
    defaultForSport: r.default_for_sport ? (String(r.default_for_sport) as SportType) : null,
    initialKm: Math.round(Number(r.initial_km) * 10) / 10,
    trackedKm: Math.round(Number(r.tracked_km) * 10) / 10,
    maxKm: Number(r.max_km),
    active: Boolean(r.active),
    notes: r.notes ? String(r.notes) : null,
  }));
}

export function createGear(item: Omit<GearItem, 'trackedKm'>): GearItem {
  getDb()
    .prepare(`
      INSERT INTO gear_items (id, name, brand, category, default_for_sport, initial_km, max_km, active, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      item.id,
      item.name,
      item.brand ?? null,
      item.category,
      item.defaultForSport ?? null,
      item.initialKm,
      item.maxKm,
      item.active ? 1 : 0,
      item.notes ?? null
    );
  return listGear().find((g) => g.id === item.id)!;
}

export function updateGear(id: string, patch: Partial<Omit<GearItem, 'id' | 'trackedKm'>>): GearItem | null {
  const current = listGear().find((g) => g.id === id);
  if (!current) return null;
  getDb()
    .prepare(`
      UPDATE gear_items
      SET name = ?, brand = ?, category = ?, default_for_sport = ?, initial_km = ?, max_km = ?, active = ?, notes = ?
      WHERE id = ?
    `)
    .run(
      patch.name ?? current.name,
      patch.brand !== undefined ? patch.brand : current.brand ?? null,
      patch.category ?? current.category,
      patch.defaultForSport !== undefined ? patch.defaultForSport : current.defaultForSport ?? null,
      patch.initialKm ?? current.initialKm,
      patch.maxKm ?? current.maxKm,
      patch.active !== undefined ? (patch.active ? 1 : 0) : current.active ? 1 : 0,
      patch.notes !== undefined ? patch.notes : current.notes ?? null,
      id
    );
  return listGear().find((g) => g.id === id) ?? null;
}

export function deleteGear(id: string): boolean {
  getDb().prepare('UPDATE activities SET gear_id = NULL WHERE gear_id = ?').run(id);
  const res = getDb().prepare('DELETE FROM gear_items WHERE id = ?').run(id);
  return res.changes > 0;
}

// ===== MOUNTAIN ROUTES =====

export function listMountainRoutes(): MountainRoute[] {
  const rows = getDb()
    .prepare('SELECT * FROM mountain_routes ORDER BY created_at DESC')
    .all() as Record<string, unknown>[];

  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    region: String(r.region),
    difficulty: r.difficulty as MountainRoute['difficulty'],
    sport: r.sport as 'mountain' | 'cycling',
    distanceMeters: Number(r.distance_meters),
    elevationGain: Number(r.elevation_gain),
    elevationLoss: Number(r.elevation_loss),
    maxEle: Number(r.max_ele),
    minEle: Number(r.min_ele),
    estimatedTimeSec: Number(r.estimated_time_sec),
    status: r.status as 'pending' | 'completed',
    notes: r.notes ? String(r.notes) : null,
    polyline: r.polyline ? String(r.polyline) : null,
    points: r.points_json ? JSON.parse(String(r.points_json)) : [],
    createdAt: String(r.created_at),
  }));
}

export function createMountainRoute(route: MountainRoute): MountainRoute {
  getDb()
    .prepare(`
      INSERT INTO mountain_routes (
        id, name, region, difficulty, sport, distance_meters, elevation_gain, elevation_loss,
        max_ele, min_ele, estimated_time_sec, status, notes, polyline, points_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      route.id,
      route.name,
      route.region,
      route.difficulty,
      route.sport,
      route.distanceMeters,
      route.elevationGain,
      route.elevationLoss,
      route.maxEle,
      route.minEle,
      route.estimatedTimeSec,
      route.status,
      route.notes ?? null,
      route.polyline ?? null,
      JSON.stringify(route.points ?? []),
      route.createdAt
    );
  return route;
}

export function updateMountainRoute(id: string, patch: Partial<Pick<MountainRoute, 'status' | 'notes' | 'difficulty' | 'name' | 'region'>>): MountainRoute | null {
  const current = listMountainRoutes().find((r) => r.id === id);
  if (!current) return null;
  getDb()
    .prepare('UPDATE mountain_routes SET status = ?, notes = ?, difficulty = ?, name = ?, region = ? WHERE id = ?')
    .run(
      patch.status ?? current.status,
      patch.notes !== undefined ? patch.notes : current.notes ?? null,
      patch.difficulty ?? current.difficulty,
      patch.name ?? current.name,
      patch.region ?? current.region,
      id
    );
  return listMountainRoutes().find((r) => r.id === id) ?? null;
}

export function deleteMountainRoute(id: string): boolean {
  const res = getDb().prepare('DELETE FROM mountain_routes WHERE id = ?').run(id);
  return res.changes > 0;
}

// ===== HOME EQUIPMENT, EXERCISES & ROUTINES =====

export function listHomeEquipment(): HomeEquipment[] {
  const rows = getDb()
    .prepare('SELECT * FROM home_equipment ORDER BY is_custom ASC, owned DESC, name ASC')
    .all() as Record<string, unknown>[];

  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    category: r.category as HomeEquipment['category'],
    description: String(r.description),
    owned: Boolean(r.owned),
    details: r.details ? String(r.details) : null,
    isCustom: Boolean(r.is_custom),
  }));
}

export function toggleHomeEquipment(id: string, owned: boolean, details?: string | null): HomeEquipment | null {
  const db = getDb();
  const current = listHomeEquipment().find((e) => e.id === id);
  if (!current) return null;
  db.prepare('UPDATE home_equipment SET owned = ?, details = ? WHERE id = ?').run(
    owned ? 1 : 0,
    details !== undefined ? details : current.details ?? null,
    id
  );
  return listHomeEquipment().find((e) => e.id === id) ?? null;
}

export function createCustomEquipment(eq: Omit<HomeEquipment, 'isCustom'>): HomeEquipment {
  getDb()
    .prepare(`
      INSERT INTO home_equipment (id, name, category, description, owned, details, is_custom)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `)
    .run(eq.id, eq.name, eq.category, eq.description, eq.owned ? 1 : 0, eq.details ?? null);
  return listHomeEquipment().find((e) => e.id === eq.id)!;
}

export function deleteCustomEquipment(id: string): boolean {
  const res = getDb().prepare('DELETE FROM home_equipment WHERE id = ? AND is_custom = 1').run(id);
  return res.changes > 0;
}

export function listAllExercises(): Exercise[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM custom_exercises ORDER BY name ASC')
    .all() as Record<string, unknown>[];

  const mediaRows = db
    .prepare('SELECT exercise_id, image_url FROM exercise_media')
    .all() as Array<{ exercise_id: string; image_url: string | null }>;
  const mediaOverrides = new Map<string, string | null>();
  for (const m of mediaRows) {
    mediaOverrides.set(m.exercise_id, m.image_url ? sanitizeImageUrl(m.image_url) : null);
  }

  const custom: Exercise[] = rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    muscleGroup: r.muscle_group as Exercise['muscleGroup'],
    secondaryMuscles: JSON.parse(String(r.secondary_muscles_json)),
    requiredEquipment: JSON.parse(String(r.required_equipment_json)),
    difficulty: r.difficulty as Exercise['difficulty'],
    pattern: r.pattern as Exercise['pattern'],
    sportBenefit: JSON.parse(String(r.sport_benefit_json)),
    defaultSets: Number(r.default_sets),
    defaultReps: String(r.default_reps),
    restSeconds: Number(r.rest_seconds),
    instructions: String(r.instructions),
    imageUrl: r.image_url ? sanitizeImageUrl(String(r.image_url)) : null,
    perDumbbell: Boolean(r.per_dumbbell),
    isCustom: true,
  }));

  const defaults = DEFAULT_EXERCISES.map((ex) => {
    if (mediaOverrides.has(ex.id)) {
      const override = mediaOverrides.get(ex.id);
      return { ...ex, imageUrl: override ?? defaultExerciseImageUrl(ex.id) };
    }
    return ex;
  });

  return [...custom, ...defaults];
}

export function createCustomExercise(ex: Omit<Exercise, 'isCustom'>): Exercise {
  const cleanImage = ex.imageUrl ? sanitizeImageUrl(ex.imageUrl) : null;
  const perDumbbell = Boolean(ex.perDumbbell);
  getDb()
    .prepare(`
      INSERT INTO custom_exercises (
        id, name, muscle_group, secondary_muscles_json, required_equipment_json,
        difficulty, pattern, sport_benefit_json, default_sets, default_reps, rest_seconds, instructions, image_url, per_dumbbell
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      ex.id,
      ex.name,
      ex.muscleGroup,
      JSON.stringify(ex.secondaryMuscles ?? []),
      JSON.stringify(ex.requiredEquipment ?? []),
      ex.difficulty,
      ex.pattern,
      JSON.stringify(ex.sportBenefit ?? ['general']),
      ex.defaultSets,
      ex.defaultReps,
      ex.restSeconds,
      ex.instructions,
      cleanImage,
      perDumbbell ? 1 : 0
    );
  return { ...ex, imageUrl: cleanImage, perDumbbell, isCustom: true };
}

export function updateExerciseImage(exerciseId: string, imageUrl: string | null): Exercise | null {
  const db = getDb();
  const cleanUrl = imageUrl === null ? null : sanitizeImageUrl(imageUrl);
  if (imageUrl !== null && !cleanUrl) {
    throw new Error('URL de imagen no válida.');
  }

  const customRow = db
    .prepare('SELECT id FROM custom_exercises WHERE id = ?')
    .get(exerciseId) as { id: string } | undefined;

  if (customRow) {
    db.prepare('UPDATE custom_exercises SET image_url = ? WHERE id = ?').run(cleanUrl, exerciseId);
  } else {
    const existsBuiltIn = DEFAULT_EXERCISES.some((e) => e.id === exerciseId);
    if (!existsBuiltIn) return null;

    if (cleanUrl === null) {
      db.prepare('DELETE FROM exercise_media WHERE exercise_id = ?').run(exerciseId);
    } else {
      db.prepare(`
        INSERT INTO exercise_media (exercise_id, image_url, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(exercise_id) DO UPDATE SET image_url = excluded.image_url, updated_at = excluded.updated_at
      `).run(exerciseId, cleanUrl, new Date().toISOString());
    }
  }

  return listAllExercises().find((e) => e.id === exerciseId) ?? null;
}

export function listRoutines(): Routine[] {
  const rows = getDb()
    .prepare('SELECT * FROM routines ORDER BY created_at DESC')
    .all() as Record<string, unknown>[];

  const exLookup = new Map(listAllExercises().map((ex) => [ex.id, ex]));

  return rows.map((r) => {
    const rawItems: RoutineExerciseItem[] = JSON.parse(String(r.items_json));
    const items = rawItems.map((it) => {
      const meta = exLookup.get(it.exerciseId);
      const clean = it.imageUrl ? sanitizeImageUrl(it.imageUrl) : null;
      const isStaleDefaultAsset = Boolean(
        clean && /^\/exercises\/[a-z0-9_]+\.(svg|jpg|jpeg|png)$/i.test(clean) && clean.startsWith(`/exercises/${it.exerciseId}.`)
      );
      return {
        ...it,
        perDumbbell: resolveIsPerDumbbell(it, meta?.perDumbbell),
        imageUrl: !clean || isStaleDefaultAsset ? (meta?.imageUrl ?? clean) : clean,
      };
    });
    return {
      id: String(r.id),
      name: String(r.name),
      goal: r.goal as Routine['goal'],
      level: r.level as Routine['level'],
      estimatedMinutes: Number(r.estimated_minutes),
      equipmentIds: JSON.parse(String(r.equipment_ids_json)),
      items,
      notes: r.notes ? String(r.notes) : null,
      coverImageUrl: r.cover_image_url ? sanitizeImageUrl(String(r.cover_image_url)) : null,
      timesCompleted: Number(r.times_completed),
      lastCompletedAt: r.last_completed_at ? String(r.last_completed_at) : null,
      createdAt: String(r.created_at),
    };
  });
}

export function createRoutine(rt: Routine): Routine {
  const cleanCover = rt.coverImageUrl ? sanitizeImageUrl(rt.coverImageUrl) : null;
  getDb()
    .prepare(`
      INSERT INTO routines (
        id, name, goal, level, estimated_minutes, equipment_ids_json, items_json, notes, cover_image_url, times_completed, last_completed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      rt.id,
      rt.name,
      rt.goal,
      rt.level,
      rt.estimatedMinutes,
      JSON.stringify(rt.equipmentIds),
      JSON.stringify(rt.items),
      rt.notes ?? null,
      cleanCover,
      rt.timesCompleted,
      rt.lastCompletedAt ?? null,
      rt.createdAt
    );
  return { ...rt, coverImageUrl: cleanCover };
}

export function updateRoutine(id: string, patch: Partial<Routine>): Routine | null {
  const current = listRoutines().find((r) => r.id === id);
  if (!current) return null;
  const nextCover =
    patch.coverImageUrl !== undefined
      ? patch.coverImageUrl
        ? sanitizeImageUrl(patch.coverImageUrl)
        : null
      : current.coverImageUrl ?? null;
  const next = { ...current, ...patch, coverImageUrl: nextCover };
  getDb()
    .prepare(`
      UPDATE routines
      SET name = ?, goal = ?, level = ?, estimated_minutes = ?, equipment_ids_json = ?, items_json = ?, notes = ?, cover_image_url = ?, times_completed = ?, last_completed_at = ?
      WHERE id = ?
    `)
    .run(
      next.name,
      next.goal,
      next.level,
      next.estimatedMinutes,
      JSON.stringify(next.equipmentIds),
      JSON.stringify(next.items),
      next.notes ?? null,
      next.coverImageUrl ?? null,
      next.timesCompleted,
      next.lastCompletedAt ?? null,
      id
    );
  return next;
}

export function deleteRoutine(id: string): boolean {
  const res = getDb().prepare('DELETE FROM routines WHERE id = ?').run(id);
  return res.changes > 0;
}

export interface LastExerciseLogSummary {
  startedAt: string;
  perDumbbell?: boolean;
  sets: Array<{ reps: number; weightKg: number; durationSec?: number }>;
}

export function getLastExerciseLogs(): Record<string, LastExerciseLogSummary> {
  const rows = getDb()
    .prepare(
      `SELECT started_at, strength_logs_json
       FROM activities
       WHERE sport = 'strength' AND strength_logs_json IS NOT NULL
       ORDER BY started_at DESC
       LIMIT 60`
    )
    .all() as Array<{ started_at: string; strength_logs_json: string }>;

  const exLookup = new Map(listAllExercises().map((ex) => [ex.id, ex]));
  const result: Record<string, LastExerciseLogSummary> = {};
  for (const row of rows) {
    let logs: StrengthSetLog[] = [];
    try {
      logs = JSON.parse(row.strength_logs_json) as StrengthSetLog[];
    } catch {
      continue;
    }
    for (const ex of logs) {
      if (!ex?.exerciseId || result[ex.exerciseId]) continue;
      const completedSets = (ex.sets ?? [])
        .filter((s) => s.completed)
        .map((s) => ({
          reps: Number(s.reps) || 0,
          weightKg: Number(s.weightKg) || 0,
          ...(typeof s.durationSec === 'number' && s.durationSec > 0 ? { durationSec: s.durationSec } : {}),
        }));
      if (completedSets.length > 0) {
        const perDumbbell = resolveIsPerDumbbell(ex, exLookup.get(ex.exerciseId)?.perDumbbell);
        result[ex.exerciseId] = {
          startedAt: row.started_at,
          ...(perDumbbell ? { perDumbbell: true } : {}),
          sets: completedSets,
        };
      }
    }
  }
  return result;
}

// ===== SEGMENTS & EFFORTS =====

export function insertSegmentRow(db: Database.Database, seg: Segment) {
  db.prepare(`
    INSERT INTO segments (
      id, name, sport, category, distance_meters, elevation_gain, avg_grade_pct, max_grade_pct,
      start_lat, start_lon, end_lat, end_lon, polyline, points_json, source_activity_id, world_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    seg.id,
    seg.name,
    seg.sport,
    seg.category,
    seg.distanceMeters,
    seg.elevationGain,
    seg.avgGradePct,
    seg.maxGradePct,
    seg.startLat,
    seg.startLon,
    seg.endLat,
    seg.endLon,
    seg.polyline,
    JSON.stringify(seg.points ?? []),
    seg.sourceActivityId ?? null,
    seg.worldName ?? null,
    seg.createdAt
  );
}

export function insertSegmentEffortRow(db: Database.Database, eff: SegmentEffort) {
  db.prepare(`
    INSERT OR REPLACE INTO segment_efforts (
      id, segment_id, activity_id, duration_sec, avg_speed_ms, avg_hr, max_hr, avg_watts, avg_cadence, vam_mh, started_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    eff.id,
    eff.segmentId,
    eff.activityId,
    eff.durationSec,
    eff.avgSpeedMs,
    eff.avgHr ?? null,
    eff.maxHr ?? null,
    eff.avgWatts ?? null,
    eff.avgCadence ?? null,
    eff.vamMh ?? null,
    eff.startedAt
  );
}

function mapSegmentRow(r: Record<string, unknown>): Segment {
  return {
    id: String(r.id),
    name: String(r.name),
    sport: String(r.sport) as SportType,
    category: (r.category ? String(r.category) : 'custom') as Segment['category'],
    distanceMeters: Number(r.distance_meters),
    elevationGain: Number(r.elevation_gain),
    avgGradePct: Number(r.avg_grade_pct),
    maxGradePct: Number(r.max_grade_pct),
    startLat: Number(r.start_lat),
    startLon: Number(r.start_lon),
    endLat: Number(r.end_lat),
    endLon: Number(r.end_lon),
    polyline: String(r.polyline),
    points: r.points_json ? JSON.parse(String(r.points_json)) : [],
    sourceActivityId: r.source_activity_id ? String(r.source_activity_id) : null,
    worldName: r.world_name ? String(r.world_name) : null,
    createdAt: String(r.created_at),
    effortCount: r.effort_count != null ? Number(r.effort_count) : undefined,
    bestTimeSec: r.best_time_sec != null ? Number(r.best_time_sec) : null,
    bestEffortDate: r.best_effort_date ? String(r.best_effort_date) : null,
  };
}

export function listSegments(sport?: string): Segment[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (sport && sport !== 'all') {
    clauses.push('s.sport = ?');
    params.push(sport);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`
      SELECT
        s.*,
        COUNT(e.id) AS effort_count,
        MIN(e.duration_sec) AS best_time_sec,
        (SELECT e2.started_at FROM segment_efforts e2 WHERE e2.segment_id = s.id ORDER BY e2.duration_sec ASC LIMIT 1) AS best_effort_date
      FROM segments s
      LEFT JOIN segment_efforts e ON e.segment_id = s.id
      ${where}
      GROUP BY s.id
      ORDER BY effort_count DESC, s.created_at DESC
    `)
    .all(...params) as Record<string, unknown>[];

  return rows.map(mapSegmentRow);
}

export function getSegmentWithEfforts(id: string): { segment: Segment; efforts: SegmentEffort[] } | null {
  const db = getDb();
  const row = db
    .prepare(`
      SELECT
        s.*,
        COUNT(e.id) AS effort_count,
        MIN(e.duration_sec) AS best_time_sec
      FROM segments s
      LEFT JOIN segment_efforts e ON e.segment_id = s.id
      WHERE s.id = ?
      GROUP BY s.id
    `)
    .get(id) as Record<string, unknown> | undefined;

  if (!row) return null;

  const effRows = db
    .prepare(`
      SELECT e.*, s.name AS segment_name, s.distance_meters, s.elevation_gain, s.avg_grade_pct, a.title AS activity_title, a.sport
      FROM segment_efforts e
      JOIN segments s ON s.id = e.segment_id
      JOIN activities a ON a.id = e.activity_id
      WHERE e.segment_id = ?
      ORDER BY e.duration_sec ASC, e.started_at DESC
    `)
    .all(id) as Record<string, unknown>[];

  const bestSec = effRows.length > 0 ? Number(effRows[0].duration_sec) : 0;
  const efforts: SegmentEffort[] = effRows.map((e, idx) => ({
    id: String(e.id),
    segmentId: String(e.segment_id),
    segmentName: String(e.segment_name),
    segmentDistanceMeters: Number(e.distance_meters),
    segmentElevationGain: Number(e.elevation_gain),
    segmentAvgGradePct: Number(e.avg_grade_pct),
    activityId: String(e.activity_id),
    activityTitle: String(e.activity_title),
    startedAt: String(e.started_at),
    sport: String(e.sport) as SportType,
    durationSec: Number(e.duration_sec),
    avgSpeedMs: Number(e.avg_speed_ms),
    avgHr: e.avg_hr != null ? Number(e.avg_hr) : null,
    maxHr: e.max_hr != null ? Number(e.max_hr) : null,
    avgWatts: e.avg_watts != null ? Number(e.avg_watts) : null,
    avgCadence: e.avg_cadence != null ? Number(e.avg_cadence) : null,
    vamMh: e.vam_mh != null ? Number(e.vam_mh) : null,
    prRank: idx + 1,
    prDeltaSec: Number(e.duration_sec) - bestSec,
  }));

  return { segment: mapSegmentRow(row), efforts };
}

export function getActivitySegmentEfforts(activityId: string): SegmentEffort[] {
  const db = getDb();
  const rows = db
    .prepare(`
      SELECT
        e.*,
        s.name AS segment_name,
        s.distance_meters,
        s.elevation_gain,
        s.avg_grade_pct,
        s.polyline AS segment_polyline,
        a.title AS activity_title,
        a.sport,
        (SELECT COUNT(*) + 1 FROM segment_efforts e2 WHERE e2.segment_id = e.segment_id AND e2.duration_sec < e.duration_sec) AS pr_rank,
        (SELECT MIN(e3.duration_sec) FROM segment_efforts e3 WHERE e3.segment_id = e.segment_id) AS best_sec
      FROM segment_efforts e
      JOIN segments s ON s.id = e.segment_id
      JOIN activities a ON a.id = e.activity_id
      WHERE e.activity_id = ?
      ORDER BY pr_rank ASC, s.distance_meters DESC
    `)
    .all(activityId) as Record<string, unknown>[];

  return rows.map((e) => ({
    id: String(e.id),
    segmentId: String(e.segment_id),
    segmentName: String(e.segment_name),
    segmentDistanceMeters: Number(e.distance_meters),
    segmentElevationGain: Number(e.elevation_gain),
    segmentAvgGradePct: Number(e.avg_grade_pct),
    segmentPolyline: e.segment_polyline ? String(e.segment_polyline) : null,
    activityId: String(e.activity_id),
    activityTitle: String(e.activity_title),
    startedAt: String(e.started_at),
    sport: String(e.sport) as SportType,
    durationSec: Number(e.duration_sec),
    avgSpeedMs: Number(e.avg_speed_ms),
    avgHr: e.avg_hr != null ? Number(e.avg_hr) : null,
    maxHr: e.max_hr != null ? Number(e.max_hr) : null,
    avgWatts: e.avg_watts != null ? Number(e.avg_watts) : null,
    avgCadence: e.avg_cadence != null ? Number(e.avg_cadence) : null,
    vamMh: e.vam_mh != null ? Number(e.vam_mh) : null,
    prRank: Number(e.pr_rank),
    prDeltaSec: Number(e.duration_sec) - Number(e.best_sec ?? e.duration_sec),
  }));
}

export function createSegmentAndMatch(segment: Segment): { segment: Segment; matchedEfforts: number } {
  const db = getDb();
  insertSegmentRow(db, segment);

  const actRows = db
    .prepare('SELECT id, title, started_at, sport, world_name, points_json FROM activities WHERE sport = ? AND points_json IS NOT NULL')
    .all(segment.sport) as Array<Record<string, unknown>>;

  let matchedEfforts = 0;
  for (const r of actRows) {
    try {
      const pts = JSON.parse(String(r.points_json)) as ActivityPoint[];
      if (pts.length < 4) continue;
      const enriched = enrichPointsTelemetry(pts, segment.sport);
      const eff = matchPointsToSegment(
        {
          id: String(r.id),
          title: String(r.title),
          startedAt: String(r.started_at),
          sport: segment.sport,
          worldName: r.world_name ? String(r.world_name) : null,
        },
        enriched,
        segment
      );
      if (eff) {
        insertSegmentEffortRow(db, eff);
        matchedEfforts++;
      }
    } catch {
      // skip invalid points json
    }
  }

  const created = getSegmentWithEfforts(segment.id)?.segment ?? segment;
  return { segment: created, matchedEfforts };
}

export function deleteSegment(id: string): boolean {
  const res = getDb().prepare('DELETE FROM segments WHERE id = ?').run(id);
  return res.changes > 0;
}

// ===== APP SETTINGS & CUSTOM PALETTES (POR PERFIL) =====

function normalizeAppSettingsRow(row: Record<string, unknown> | undefined): AppSettings {
  if (!row) {
    return { ...DEFAULT_APP_SETTINGS };
  }
  const rawTheme = typeof row.theme === 'string' && VALID_THEMES.includes(row.theme as ThemeId)
    ? (row.theme as ThemeId)
    : DEFAULT_APP_SETTINGS.theme;

  let customPalettes: CustomPalette[] = [];
  if (typeof row.custom_palettes_json === 'string') {
    try {
      customPalettes = sanitizeCustomPalettes(JSON.parse(row.custom_palettes_json));
    } catch {
      customPalettes = [];
    }
  }

  const rawPaletteId = typeof row.custom_palette_id === 'string' ? row.custom_palette_id.trim() : '';
  const customPaletteId = rawPaletteId && customPalettes.some((p) => p.id === rawPaletteId) ? rawPaletteId : null;
  const dark = rawTheme === 'nocturno' && !customPaletteId ? true : Boolean(row.dark);
  const settingsVersion = typeof row.settings_version === 'number' && Number.isFinite(row.settings_version)
    ? Math.max(0, Math.floor(row.settings_version))
    : Number(row.settings_version ?? 0) || 0;

  return {
    theme: rawTheme,
    dark,
    customPalettes,
    customPaletteId,
    settingsVersion,
    settingsSyncProtocol: SETTINGS_SYNC_PROTOCOL,
  };
}

function writeAppSettings(db: Database.Database, account: AccountId, next: AppSettings): AppSettings {
  const enforced: AppSettings = {
    ...next,
    dark: next.theme === 'nocturno' && !next.customPaletteId ? true : Boolean(next.dark),
    customPaletteId:
      next.customPaletteId && next.customPalettes.some((p) => p.id === next.customPaletteId)
        ? next.customPaletteId
        : null,
    settingsSyncProtocol: SETTINGS_SYNC_PROTOCOL,
  };

  db.prepare(`
    UPDATE app_settings
    SET theme = ?, dark = ?, custom_palettes_json = ?, custom_palette_id = ?, settings_version = ?, updated_at = ?
    WHERE id = 1
  `).run(
    enforced.theme,
    enforced.dark ? 1 : 0,
    JSON.stringify(enforced.customPalettes),
    enforced.customPaletteId,
    enforced.settingsVersion,
    new Date().toISOString()
  );

  emitSettingsEvent(account, enforced);
  return enforced;
}

export function getAppSettings(account: AccountId = currentAccountId()): AppSettings {
  const db = getDb(account);
  const row = db.prepare('SELECT * FROM app_settings WHERE id = 1').get() as Record<string, unknown> | undefined;
  return normalizeAppSettingsRow(row);
}

export function updateAppSettings(
  patch: {
    theme?: unknown;
    dark?: unknown;
    customPalettes?: unknown;
    customPaletteId?: unknown;
  },
  account: AccountId = currentAccountId()
): AppSettings {
  const db = getDb(account);
  const current = getAppSettings(account);
  const next: AppSettings = {
    ...current,
    customPalettes: [...current.customPalettes],
  };

  if (typeof patch.theme === 'string' && VALID_THEMES.includes(patch.theme as ThemeId)) {
    next.theme = patch.theme as ThemeId;
  }
  if (typeof patch.dark === 'boolean') {
    next.dark = patch.dark;
  }
  if (patch.customPalettes !== undefined) {
    next.customPalettes = sanitizeCustomPalettes(patch.customPalettes);
  }
  if (patch.customPaletteId === null || patch.customPaletteId === '') {
    next.customPaletteId = null;
  } else if (typeof patch.customPaletteId === 'string') {
    const cleanId = patch.customPaletteId.trim();
    if (next.customPalettes.some((p) => p.id === cleanId)) {
      next.customPaletteId = cleanId;
    }
  }

  next.settingsVersion = current.settingsVersion + 1;
  return writeAppSettings(db, account, next);
}

export function upsertCustomPalette(
  paletteId: string,
  body: Record<string, unknown>,
  account: AccountId = currentAccountId()
): { settings: AppSettings; palette: CustomPalette } {
  const cleanId = paletteId.trim();
  if (!/^[a-zA-Z0-9_-]{1,90}$/.test(cleanId)) {
    throw new Error('Identificador de paleta inválido.');
  }

  const candidate =
    body.palette && typeof body.palette === 'object' && !Array.isArray(body.palette)
      ? (body.palette as Record<string, unknown>)
      : body;

  const db = getDb(account);
  const current = getAppSettings(account);
  const existing = current.customPalettes.find((p) => p.id === cleanId);
  const rawBase = typeof candidate.baseTheme === 'string' && VALID_THEMES.includes(candidate.baseTheme as ThemeId)
    ? (candidate.baseTheme as ThemeId)
    : existing?.baseTheme ?? current.theme ?? 'calido';
  const fallback = paletteColorsFromTheme(rawBase);
  const name = typeof candidate.name === 'string' && candidate.name.trim()
    ? candidate.name.trim().slice(0, 40)
    : existing?.name ?? 'Mi paleta';
  const createdAt = typeof candidate.createdAt === 'number' && Number.isFinite(candidate.createdAt)
    ? candidate.createdAt
    : existing?.createdAt ?? Date.now();

  const palette: CustomPalette = {
    id: cleanId,
    name,
    baseTheme: rawBase,
    light: sanitizePaletteColors(candidate.light, existing?.light ?? fallback.light),
    dark: sanitizePaletteColors(candidate.dark, existing?.dark ?? fallback.dark),
    createdAt,
  };

  if (!existing && current.customPalettes.length >= 24) {
    throw new Error('Ya hay 24 paletas personalizadas guardadas.');
  }

  const nextPalettes = existing
    ? current.customPalettes.map((p) => (p.id === cleanId ? palette : p))
    : [palette, ...current.customPalettes];

  const activate = body.activate !== false;
  const next = writeAppSettings(db, account, {
    ...current,
    theme: activate ? palette.baseTheme : current.theme,
    customPalettes: nextPalettes,
    customPaletteId: activate ? palette.id : current.customPaletteId,
    settingsVersion: current.settingsVersion + 1,
  });

  return { settings: next, palette };
}

export function deleteCustomPalette(
  paletteId: string,
  account: AccountId = currentAccountId()
): { settings: AppSettings; deleted: boolean } {
  const db = getDb(account);
  const current = getAppSettings(account);
  const nextPalettes = current.customPalettes.filter((p) => p.id !== paletteId);
  const deleted = nextPalettes.length !== current.customPalettes.length;

  if (!deleted) {
    return { settings: current, deleted: false };
  }

  const next = writeAppSettings(db, account, {
    ...current,
    customPalettes: nextPalettes,
    customPaletteId: current.customPaletteId === paletteId ? null : current.customPaletteId,
    settingsVersion: current.settingsVersion + 1,
  });

  return { settings: next, deleted: true };
}

