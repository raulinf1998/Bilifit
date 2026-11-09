import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DEFAULT_EXERCISES, DEFAULT_HOME_EQUIPMENT } from '@/lib/home-workouts';
import { buildSeedActivityRows, SEED_GEAR, SEED_PROFILE, SEED_ROUTES, SEED_ROUTINES } from '@/lib/seed';
import type {
  Activity,
  ActivityDetail,
  ActivityPoint,
  AthleteProfile,
  Exercise,
  GearItem,
  HomeEquipment,
  MountainRoute,
  Routine,
  SportType,
  StrengthSetLog,
} from '@/types';

let dbInstance: Database.Database | null = null;

function getDbPath(): string {
  const configured = process.env.BILIFIT_DB_PATH;
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.join(/*turbopackIgnore: true*/ process.cwd(), configured);
  }
  return path.join(process.cwd(), 'data', 'bilifit.db');
}

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;

  const dbPath = getDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  initSchema(db);
  seedIfEmpty(db);

  dbInstance = db;
  return dbInstance;
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
  `);
}

function seedIfEmpty(db: Database.Database) {
  const profileCount = db.prepare('SELECT COUNT(*) as c FROM athlete_profile').get() as { c: number };
  if (profileCount.c === 0) {
    db.prepare(`
      INSERT INTO athlete_profile (id, name, weight_kg, ftp_watts, max_hr, resting_hr, lthr, weekly_target_hours, weekly_target_km)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      SEED_PROFILE.name,
      SEED_PROFILE.weightKg,
      SEED_PROFILE.ftpWatts,
      SEED_PROFILE.maxHr,
      SEED_PROFILE.restingHr,
      SEED_PROFILE.lthr,
      SEED_PROFILE.weeklyTargetHours,
      SEED_PROFILE.weeklyTargetKm
    );
  }

  const stravaCount = db.prepare('SELECT COUNT(*) as c FROM strava_config').get() as { c: number };
  if (stravaCount.c === 0) {
    db.prepare('INSERT INTO strava_config (id) VALUES (1)').run();
  }

  const eqCount = db.prepare('SELECT COUNT(*) as c FROM home_equipment').get() as { c: number };
  if (eqCount.c === 0) {
    const stmt = db.prepare(`
      INSERT INTO home_equipment (id, name, category, description, owned, details, is_custom)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `);
    const insertMany = db.transaction(() => {
      for (const eq of DEFAULT_HOME_EQUIPMENT) {
        stmt.run(eq.id, eq.name, eq.category, eq.description, eq.owned ? 1 : 0, eq.details ?? null);
      }
    });
    insertMany();
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
        points_json, strength_logs_json, total_volume_kg, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    createdAt: String(row.created_at),
  };
}

export function listActivities(filters?: { sport?: string; q?: string; limit?: number }): Activity[] {
  const db = getDb();
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters?.sport && filters.sport !== 'all') {
    clauses.push('a.sport = ?');
    params.push(filters.sport);
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

  return {
    ...mapActivityRow(row),
    points,
    strengthLogs,
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

  db.prepare(`
    INSERT INTO activities (
      id, external_id, source, sport, sub_sport, title, description, started_at,
      duration_sec, moving_time_sec, distance_meters, elevation_gain, elevation_loss,
      avg_speed_ms, max_speed_ms, avg_hr, max_hr, avg_watts, normalized_power, max_watts,
      avg_cadence, calories, tss, rpe, gear_id, world_name, polyline, start_lat, start_lon,
      points_json, strength_logs_json, total_volume_kg, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.id,
    input.externalId ?? null,
    input.source,
    input.sport,
    input.subSport ?? null,
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
    JSON.stringify(input.points ?? []),
    JSON.stringify(input.strengthLogs ?? []),
    input.totalVolumeKg ?? null,
    input.createdAt
  );

  return getActivityById(input.id)!;
}

export function findDuplicateActivity(startedAt: string, sport: SportType, distanceMeters: number, externalId?: string | null): boolean {
  const db = getDb();
  if (externalId) {
    const byExt = db.prepare('SELECT id FROM activities WHERE external_id = ?').get(externalId);
    if (byExt) return true;
  }
  const ts = Date.parse(startedAt);
  if (!Number.isFinite(ts)) return false;
  const minIso = new Date(ts - 180_000).toISOString();
  const maxIso = new Date(ts + 180_000).toISOString();
  const rows = db
    .prepare('SELECT id, distance_meters FROM activities WHERE sport = ? AND started_at BETWEEN ? AND ?')
    .all(sport, minIso, maxIso) as Array<{ id: string; distance_meters: number }>;
  return rows.some((r) => Math.abs(r.distance_meters - distanceMeters) < 250);
}

export function updateActivity(
  id: string,
  patch: Partial<{ title: string; sport: SportType; subSport: string | null; description: string | null; rpe: number | null; gearId: string | null; worldName: string | null }>
): ActivityDetail | null {
  const existing = getActivityById(id);
  if (!existing) return null;

  getDb()
    .prepare(`
      UPDATE activities
      SET title = ?, sport = ?, sub_sport = ?, description = ?, rpe = ?, gear_id = ?, world_name = ?
      WHERE id = ?
    `)
    .run(
      patch.title ?? existing.title,
      patch.sport ?? existing.sport,
      patch.subSport !== undefined ? patch.subSport : existing.subSport ?? null,
      patch.description !== undefined ? patch.description : existing.description ?? null,
      patch.rpe !== undefined ? patch.rpe : existing.rpe ?? null,
      patch.gearId !== undefined ? patch.gearId : existing.gearId ?? null,
      patch.worldName !== undefined ? patch.worldName : existing.worldName ?? null,
      id
    );

  return getActivityById(id);
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
  const rows = getDb()
    .prepare('SELECT * FROM custom_exercises ORDER BY name ASC')
    .all() as Record<string, unknown>[];

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
    isCustom: true,
  }));

  return [...custom, ...DEFAULT_EXERCISES];
}

export function createCustomExercise(ex: Omit<Exercise, 'isCustom'>): Exercise {
  getDb()
    .prepare(`
      INSERT INTO custom_exercises (
        id, name, muscle_group, secondary_muscles_json, required_equipment_json,
        difficulty, pattern, sport_benefit_json, default_sets, default_reps, rest_seconds, instructions
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      ex.instructions
    );
  return { ...ex, isCustom: true };
}

export function listRoutines(): Routine[] {
  const rows = getDb()
    .prepare('SELECT * FROM routines ORDER BY created_at DESC')
    .all() as Record<string, unknown>[];

  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    goal: r.goal as Routine['goal'],
    level: r.level as Routine['level'],
    estimatedMinutes: Number(r.estimated_minutes),
    equipmentIds: JSON.parse(String(r.equipment_ids_json)),
    items: JSON.parse(String(r.items_json)),
    notes: r.notes ? String(r.notes) : null,
    timesCompleted: Number(r.times_completed),
    lastCompletedAt: r.last_completed_at ? String(r.last_completed_at) : null,
    createdAt: String(r.created_at),
  }));
}

export function createRoutine(rt: Routine): Routine {
  getDb()
    .prepare(`
      INSERT INTO routines (
        id, name, goal, level, estimated_minutes, equipment_ids_json, items_json, notes, times_completed, last_completed_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      rt.timesCompleted,
      rt.lastCompletedAt ?? null,
      rt.createdAt
    );
  return rt;
}

export function updateRoutine(id: string, patch: Partial<Routine>): Routine | null {
  const current = listRoutines().find((r) => r.id === id);
  if (!current) return null;
  const next = { ...current, ...patch };
  getDb()
    .prepare(`
      UPDATE routines
      SET name = ?, goal = ?, level = ?, estimated_minutes = ?, equipment_ids_json = ?, items_json = ?, notes = ?, times_completed = ?, last_completed_at = ?
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
