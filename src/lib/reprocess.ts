import { computeSessionExtras, enrichActivityLaps, enrichPointsTelemetry } from '@/lib/analytics';
import { resolveActivityTitle } from '@/lib/activity-naming';
import {
  backfillMismatchedSubSports,
  backfillMyWhooshWorlds,
  backfillSplitTrailActivities,
  backfillWalkingActivities,
  getAthleteProfile,
  getDb,
  insertSegmentEffortRow,
  insertSegmentRow,
  listSegments,
} from '@/lib/db';
import { getHuaweiStatus, syncHuaweiActivities } from '@/lib/huawei-sync';
import {
  calculateNormalizedPower,
  defaultSubSportForSport,
  estimateActivityTSS,
  isMismatchedSubSport,
} from '@/lib/metrics';
import { isMyWhooshContext, resolveMyWhooshWorldForActivity } from '@/lib/mywhoosh-maps';
import { getMyWhooshStatus, syncMyWhooshActivities } from '@/lib/mywhoosh-sync';
import { computeElevationGainLoss, decodePolyline, encodePolyline, haversineMeters } from '@/lib/polyline';
import { buildSegmentFromRange, detectClimbCandidates, matchPointsToSegment } from '@/lib/segments';
import { getStravaStatus, syncStravaActivities } from '@/lib/strava';
import type { Activity, ActivityPoint, Segment, SportType } from '@/types';

export interface SourceReloadSummary {
  status: 'ok' | 'skipped' | 'error';
  imported: number;
  updated: number;
  skipped: number;
  error?: string;
}

export interface ReloadActivitiesResult {
  ok: true;
  totalActivities: number;
  reprocessedActivities: number;
  sources: {
    huawei: SourceReloadSummary;
    mywhoosh: SourceReloadSummary;
    strava: SourceReloadSummary;
  };
  segments: {
    before: number;
    created: number;
    total: number;
    effortsMatched: number;
    activitiesMatched: number;
  };
}

export interface ReloadActivitiesOptions {
  reloadSources?: boolean;
  detectClimbs?: boolean;
  maxSourceItems?: number;
  fetchImpl?: typeof fetch;
}

function estimateMovingTimeFromPoints(points: ActivityPoint[], durationSec: number): number | null {
  if (points.length < 2 || durationSec <= 0) return null;
  let moving = 0;
  let validDtSum = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const dt = cur.t - prev.t;
    if (dt <= 0 || dt > 60) continue;
    validDtSum += dt;

    let stepSpd: number | undefined;
    if (
      typeof prev.lat === 'number' &&
      typeof prev.lon === 'number' &&
      typeof cur.lat === 'number' &&
      typeof cur.lon === 'number'
    ) {
      stepSpd = haversineMeters(prev.lat, prev.lon, cur.lat, cur.lon) / dt;
    } else if (typeof cur.dist === 'number' && typeof prev.dist === 'number' && cur.dist >= prev.dist) {
      stepSpd = (cur.dist - prev.dist) / dt;
    }

    const spd = stepSpd !== undefined ? stepSpd : typeof cur.speed === 'number' ? cur.speed : undefined;
    const watts = cur.watts ?? 0;
    if ((spd !== undefined && spd > 0.35) || watts > 15) {
      moving += dt;
    }
  }

  if (validDtSum < 10 || moving <= 0) return null;
  // Solo ajustar si al menos hay una pausa real detectada (>= 5s)
  const paused = validDtSum - moving;
  if (paused < 5) return durationSec;
  return Math.max(1, Math.min(durationSec, Math.round(moving)));
}

function nearestPointDistM(points: ActivityPoint[], lat: number, lon: number): { distM: number; gapM: number } {
  let bestGap = Infinity;
  let bestDist = 0;
  for (const p of points) {
    if (typeof p.lat !== 'number' || typeof p.lon !== 'number') continue;
    const d = haversineMeters(p.lat, p.lon, lat, lon);
    if (d < bestGap) {
      bestGap = d;
      bestDist = p.dist ?? 0;
    }
  }
  return { distM: bestDist, gapM: bestGap };
}

function isSameOrOverlappingClimbSegment(
  candidate: Segment,
  candStartDistM: number,
  candEndDistM: number,
  candidateActivity: Pick<Activity, 'id' | 'title' | 'startedAt' | 'sport' | 'worldName'>,
  candidatePoints: ActivityPoint[],
  existingSegments: Segment[]
): boolean {
  for (const existing of existingSegments) {
    if (existing.sport !== candidate.sport) continue;
    if ((existing.worldName ?? null) !== (candidate.worldName ?? null)) continue;

    const startGap = haversineMeters(candidate.startLat, candidate.startLon, existing.startLat, existing.startLon);
    const endGap = haversineMeters(candidate.endLat, candidate.endLon, existing.endLat, existing.endLon);
    const ratio = existing.distanceMeters > 0 ? candidate.distanceMeters / existing.distanceMeters : 1;

    if (startGap <= 220 && endGap <= 220 && ratio >= 0.65 && ratio <= 1.55) {
      return true;
    }

    if (existing.category === 'climb') {
      const matched = matchPointsToSegment(candidateActivity, candidatePoints, existing);
      if (matched) {
        const windowPoints = candidatePoints.filter(
          (p) => (p.dist ?? 0) >= candStartDistM - 400 && (p.dist ?? 0) <= candEndDistM + 400
        );
        const searchPoints = windowPoints.length >= 2 ? windowPoints : candidatePoints;
        const sNear = nearestPointDistM(searchPoints, existing.startLat, existing.startLon);
        const eNear = nearestPointDistM(searchPoints, existing.endLat, existing.endLon);
        const exStart = Math.min(sNear.distM, eNear.distM);
        const exEnd = Math.max(sNear.distM, eNear.distM);
        const overlap = Math.max(0, Math.min(candEndDistM, exEnd) - Math.max(candStartDistM, exStart));
        const minLen = Math.min(candidate.distanceMeters, existing.distanceMeters);
        if (minLen > 0 && overlap / minLen >= 0.45) {
          return true;
        }
      }
    }
  }
  return false;
}

export async function reloadAllActivitiesAndSegments(
  options: ReloadActivitiesOptions = {}
): Promise<ReloadActivitiesResult> {
  const reloadSources = options.reloadSources ?? true;
  const detectClimbs = options.detectClimbs ?? true;
  const maxSourceItems = Math.max(10, Math.min(500, options.maxSourceItems ?? 500));

  const sources: ReloadActivitiesResult['sources'] = {
    huawei: { status: 'skipped', imported: 0, updated: 0, skipped: 0 },
    mywhoosh: { status: 'skipped', imported: 0, updated: 0, skipped: 0 },
    strava: { status: 'skipped', imported: 0, updated: 0, skipped: 0 },
  };

  // 1. Recargar y refrescar actividades desde las fuentes conectadas (si aplica)
  if (reloadSources) {
    const hwStatus = getHuaweiStatus();
    const hwReady = Boolean(
      (hwStatus.googleConnected && hwStatus.driveFolderId) ||
      (hwStatus.watchDirExists && hwStatus.watchDirFileCount > 0)
    );
    if (hwReady) {
      try {
        const res = await syncHuaweiActivities({
          mode: 'auto',
          limit: maxSourceItems,
          maxPages: 25,
          retryFailed: true,
          refreshExisting: true,
          fetchImpl: options.fetchImpl,
        });
        sources.huawei = {
          status: 'ok',
          imported: res.imported,
          updated: res.updated ?? 0,
          skipped: res.skipped,
          ...(res.errors.length > 0 ? { error: res.errors.slice(0, 2).join(' | ') } : {}),
        };
      } catch (err) {
        sources.huawei = {
          status: 'error',
          imported: 0,
          updated: 0,
          skipped: 0,
          error: err instanceof Error ? err.message : 'Error recargando Huawei Health',
        };
      }
    }

    const mwStatus = getMyWhooshStatus();
    if (mwStatus.connected) {
      try {
        const res = await syncMyWhooshActivities({
          limit: maxSourceItems,
          syncAll: true,
          retryFailed: true,
          refreshExisting: true,
          fetchImpl: options.fetchImpl,
        });
        sources.mywhoosh = {
          status: 'ok',
          imported: res.imported,
          updated: res.updated ?? 0,
          skipped: res.skipped,
          ...(res.errors.length > 0 ? { error: res.errors.slice(0, 2).join(' | ') } : {}),
        };
      } catch (err) {
        sources.mywhoosh = {
          status: 'error',
          imported: 0,
          updated: 0,
          skipped: 0,
          error: err instanceof Error ? err.message : 'Error recargando MyWhoosh',
        };
      }
    }

    const stravaStatus = getStravaStatus();
    if (stravaStatus.connected) {
      try {
        const res = await syncStravaActivities(Math.min(50, maxSourceItems), true, true);
        sources.strava = {
          status: 'ok',
          imported: res.imported,
          updated: res.updated,
          skipped: res.skipped,
        };
      } catch (err) {
        sources.strava = {
          status: 'error',
          imported: 0,
          updated: 0,
          skipped: 0,
          error: err instanceof Error ? err.message : 'Error recargando Strava',
        };
      }
    }
  }

  // 2. Reprocesar todas las actividades existentes en la base de datos
  const db = getDb();
  backfillWalkingActivities(db);
  backfillSplitTrailActivities(db);
  backfillMismatchedSubSports(db);
  backfillMyWhooshWorlds(db);

  const profile = getAthleteProfile();
  const rows = db
    .prepare('SELECT * FROM activities ORDER BY started_at DESC')
    .all() as Array<Record<string, unknown>>;

  const gpsActivities: Array<{
    activity: Pick<Activity, 'id' | 'title' | 'startedAt' | 'sport' | 'worldName'>;
    points: ActivityPoint[];
  }> = [];

  const updateActivityStmt = db.prepare(`
    UPDATE activities
    SET sub_sport = ?,
        title = ?,
        moving_time_sec = ?,
        elevation_gain = ?,
        elevation_loss = ?,
        avg_speed_ms = ?,
        max_speed_ms = ?,
        normalized_power = ?,
        tss = ?,
        world_name = ?,
        polyline = ?,
        start_lat = ?,
        start_lon = ?,
        points_json = ?,
        laps_json = ?,
        extras_json = ?
    WHERE id = ?
  `);

  let reprocessedActivities = 0;

  const reprocessTx = db.transaction(() => {
    for (const row of rows) {
      const id = String(row.id);
      const sport = String(row.sport) as SportType;
      const startedAt = String(row.started_at);
      const durationSec = Math.max(0, Number(row.duration_sec ?? 0));
      let movingTimeSec = Math.max(0, Number(row.moving_time_sec ?? 0));
      const distanceMeters = Math.max(0, Number(row.distance_meters ?? 0));
      let elevationGain = Math.max(0, Number(row.elevation_gain ?? 0));
      let elevationLoss = Math.max(0, Number(row.elevation_loss ?? 0));
      const avgHr = row.avg_hr != null ? Number(row.avg_hr) : null;
      const avgWatts = row.avg_watts != null ? Number(row.avg_watts) : null;
      const rpe = row.rpe != null ? Number(row.rpe) : null;

      let rawPoints: ActivityPoint[] = [];
      try {
        if (row.points_json) rawPoints = JSON.parse(String(row.points_json));
      } catch {
        rawPoints = [];
      }

      let rawExtras: Activity['extras'] = null;
      try {
        if (row.extras_json) rawExtras = JSON.parse(String(row.extras_json));
      } catch {
        rawExtras = null;
      }

      let rawLaps: Activity['laps'] = [];
      try {
        if (row.laps_json) rawLaps = JSON.parse(String(row.laps_json));
      } catch {
        rawLaps = [];
      }

      const enrichedPoints = rawPoints.length > 0 ? enrichPointsTelemetry(rawPoints, sport) : [];
      const coords: Array<[number, number]> = enrichedPoints
        .filter((p): p is ActivityPoint & { lat: number; lon: number } => typeof p.lat === 'number' && typeof p.lon === 'number')
        .map((p) => [p.lat, p.lon]);

      const rawSubSport = row.sub_sport ? String(row.sub_sport) : null;
      const nextSubSport =
        rawSubSport && !isMismatchedSubSport(sport, rawSubSport)
          ? rawSubSport
          : defaultSubSportForSport(sport);

      const rawTitle = String(row.title ?? '');
      const nextTitle = resolveActivityTitle(rawTitle, sport, startedAt);

      let nextWorldName = row.world_name ? String(row.world_name) : null;
      if (!nextWorldName && (sport === 'mywhoosh' || isMyWhooshContext({
        sport,
        subSport: nextSubSport,
        worldName: null,
        title: nextTitle,
        deviceName: rawExtras?.deviceName ?? null,
      }))) {
        const polyCoords = coords.length > 0 ? coords : row.polyline ? decodePolyline(String(row.polyline)) : [];
        nextWorldName =
          resolveMyWhooshWorldForActivity({
            worldName: null,
            title: nextTitle,
            sport,
            subSport: nextSubSport,
            deviceName: rawExtras?.deviceName ?? null,
            coords: polyCoords,
          })?.world.name ?? null;
      }

      if (movingTimeSec <= 0 || movingTimeSec > durationSec) {
        const est = estimateMovingTimeFromPoints(enrichedPoints, durationSec);
        movingTimeSec = est ?? durationSec;
      } else if (movingTimeSec === durationSec && enrichedPoints.length >= 4) {
        const est = estimateMovingTimeFromPoints(enrichedPoints, durationSec);
        if (est && est < durationSec) {
          movingTimeSec = est;
        }
      }

      if (elevationGain === 0 && elevationLoss === 0 && enrichedPoints.length >= 2) {
        const eleCalc = computeElevationGainLoss(enrichedPoints);
        elevationGain = eleCalc.gain;
        elevationLoss = eleCalc.loss;
      }

      const nextPolyline =
        row.polyline && String(row.polyline).trim()
          ? String(row.polyline)
          : coords.length >= 2
            ? encodePolyline(coords)
            : null;
      const nextStartLat = row.start_lat != null ? Number(row.start_lat) : coords[0]?.[0] ?? null;
      const nextStartLon = row.start_lon != null ? Number(row.start_lon) : coords[0]?.[1] ?? null;

      let avgSpeedMs = row.avg_speed_ms != null ? Number(row.avg_speed_ms) : null;
      if ((avgSpeedMs === null || avgSpeedMs <= 0) && distanceMeters > 0 && durationSec > 0) {
        avgSpeedMs = Math.round((distanceMeters / durationSec) * 100) / 100;
      }

      let maxSpeedMs = row.max_speed_ms != null ? Number(row.max_speed_ms) : null;
      if (maxSpeedMs === null && enrichedPoints.length > 0) {
        const speeds = enrichedPoints
          .map((p) => p.speed)
          .filter((v): v is number => typeof v === 'number' && v > 0 && v < 40);
        if (speeds.length > 0) maxSpeedMs = Math.round(Math.max(...speeds) * 100) / 100;
      }

      const np =
        (row.normalized_power != null ? Number(row.normalized_power) : null) ??
        (enrichedPoints.length > 10 ? calculateNormalizedPower(enrichedPoints) : null);

      const nextTss =
        avgHr || avgWatts || np
          ? estimateActivityTSS(
              {
                sport,
                durationSec,
                movingTimeSec,
                avgWatts,
                normalizedPower: np,
                avgHr,
                rpe,
                elevationGain,
              },
              profile
            )
          : Number(row.tss ?? 0);

      const excludePausedTime = Boolean(row.exclude_paused_time);
      const nextLaps = enrichActivityLaps(rawLaps, enrichedPoints, {
        durationSec,
        movingTimeSec,
        excludePausedTime,
      });

      const nextExtras = computeSessionExtras(
        {
          sport,
          durationSec,
          movingTimeSec,
          distanceMeters,
          elevationGain,
          avgSpeedMs,
          avgHr,
          avgWatts,
          normalizedPower: np,
          excludePausedTime,
          extras: rawExtras,
        },
        enrichedPoints
      );

      updateActivityStmt.run(
        nextSubSport,
        nextTitle,
        movingTimeSec,
        elevationGain,
        elevationLoss,
        avgSpeedMs,
        maxSpeedMs,
        np,
        nextTss,
        nextWorldName,
        nextPolyline,
        nextStartLat,
        nextStartLon,
        JSON.stringify(enrichedPoints),
        JSON.stringify(nextLaps),
        JSON.stringify(nextExtras),
        id
      );

      reprocessedActivities++;

      if (coords.length >= 4) {
        gpsActivities.push({
          activity: {
            id,
            title: nextTitle,
            startedAt,
            sport,
            worldName: nextWorldName,
          },
          points: enrichedPoints,
        });
      }
    }
  });
  reprocessTx();

  // 3. Detectar nuevos segmentos en subidas y re-emparejar todas las actividades contra todos los segmentos
  const knownSegments = listSegments();
  const segmentsBefore = knownSegments.length;
  let segmentsCreated = 0;
  let effortsMatched = 0;
  const matchedActivityIds = new Set<string>();

  const segmentsTx = db.transaction(() => {
    if (detectClimbs) {
      for (const item of gpsActivities) {
        const candidates = detectClimbCandidates(item.points);
        for (let i = 0; i < candidates.length; i++) {
          const c = candidates[i];
          const seg = buildSegmentFromRange({
            activity: item.activity,
            points: item.points,
            startDistM: c.startDistM,
            endDistM: c.endDistM,
            name: `${item.activity.title.slice(0, 32)} · Subida (+${c.elevationGain} m)`,
            category: 'climb',
          });
          if (!seg) continue;

          if (
            isSameOrOverlappingClimbSegment(
              seg,
              c.startDistM,
              c.endDistM,
              item.activity,
              item.points,
              knownSegments
            )
          ) {
            continue;
          }

          insertSegmentRow(db, seg);
          knownSegments.push(seg);
          segmentsCreated++;
        }
      }
    }

    db.prepare('DELETE FROM segment_efforts').run();
    for (const seg of knownSegments) {
      for (const item of gpsActivities) {
        if (item.activity.sport !== seg.sport) continue;
        const eff = matchPointsToSegment(item.activity, item.points, seg);
        if (eff) {
          insertSegmentEffortRow(db, eff);
          effortsMatched++;
          matchedActivityIds.add(item.activity.id);
        }
      }
    }
  });
  segmentsTx();

  return {
    ok: true,
    totalActivities: rows.length,
    reprocessedActivities,
    sources,
    segments: {
      before: segmentsBefore,
      created: segmentsCreated,
      total: knownSegments.length,
      effortsMatched,
      activitiesMatched: matchedActivityIds.size,
    },
  };
}
