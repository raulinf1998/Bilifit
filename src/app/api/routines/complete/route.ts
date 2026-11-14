import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import { createActivity, getAthleteProfile, listAllExercises, listRoutines, updateRoutine } from '@/lib/db';
import { calculateStrengthSetVolumeKg, resolveIsPerDumbbell } from '@/lib/home-workouts';
import { estimateActivityTSS } from '@/lib/metrics';
import { MAX_TRACKED_SESSION_SEC, resolveSessionDurationSec, sumTimedSetSec } from '@/lib/session-clock';
import { sanitizeImageList } from '@/lib/uploads';
import type { StrengthSetLog } from '@/types';

export async function POST(req: NextRequest) {
  return withAccount(req, async () => {
    try {
      const body = await req.json();
      const title = String(body.title || 'Rutina de Fuerza en Casa').trim();
      const rpe = Math.min(10, Math.max(1, Number(body.rpe || 7)));
      const rawLogs: StrengthSetLog[] = Array.isArray(body.strengthLogs) ? body.strengthLogs : [];

      const exerciseLookup = new Map(listAllExercises().map((ex) => [ex.id, ex]));
      let totalVolumeKg = 0;
      const strengthLogs: StrengthSetLog[] = rawLogs
        .map((ex) => {
          const perDumbbell = resolveIsPerDumbbell(ex, exerciseLookup.get(ex.exerciseId)?.perDumbbell);
          const completedSets = (ex.sets ?? []).filter((s) => Boolean(s?.completed));
          for (const s of completedSets) {
            totalVolumeKg += calculateStrengthSetVolumeKg(s, perDumbbell);
          }
          return {
            ...ex,
            sets: completedSets,
            ...(perDumbbell ? { perDumbbell: true } : typeof ex.perDumbbell === 'boolean' ? { perDumbbell: ex.perDumbbell } : {}),
          };
        })
        .filter((ex) => ex.sets.length > 0);

      // La duración es la medida por el cronómetro de la sesión; sólo si no llega
      // una medición se usa el trabajo temporalizado de las series. No se rellena
      // con una duración supuesta (antes: 30 min por defecto y 2 min de mínimos).
      const durationSec = resolveSessionDurationSec({
        reportedSec: body.durationSec,
        timedSetSec: sumTimedSetSec(strengthLogs),
      });

      const profile = getAthleteProfile();
      const tss = estimateActivityTSS(
        {
          sport: 'strength',
          durationSec,
          movingTimeSec: durationSec,
          rpe,
        },
        profile
      );

      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      // La sesión empieza cuando se abrió el reproductor, no cuando se guardó:
      // así la duración y el día de la calendarización coinciden con lo hecho.
      const reportedStartMs = Number(body.startedAtMs);
      const startedAtIso =
        Number.isFinite(reportedStartMs) &&
        reportedStartMs > 0 &&
        reportedStartMs <= nowMs &&
        nowMs - reportedStartMs <= MAX_TRACKED_SESSION_SEC * 1000
          ? new Date(reportedStartMs).toISOString()
          : nowIso;
      const routineId = body.routineId ? String(body.routineId) : null;
      const activity = createActivity({
        id: `act_home_${crypto.randomUUID().slice(0, 10)}`,
        externalId: null,
        source: 'bilifit_home',
        sport: 'strength',
        subSport: 'Rutina en Casa',
        title,
        description: body.notes
          ? String(body.notes)
          : `Sesión en casa completada (${strengthLogs.length} ${strengthLogs.length === 1 ? 'ejercicio' : 'ejercicios'} · ${Math.round(totalVolumeKg)} kg movidos).`,
        startedAt: startedAtIso,
        durationSec,
        movingTimeSec: durationSec,
        distanceMeters: 0,
        elevationGain: 0,
        elevationLoss: 0,
        avgSpeedMs: null,
        maxSpeedMs: null,
        avgHr: body.avgHr ? Math.round(Number(body.avgHr)) : null,
        maxHr: null,
        avgWatts: null,
        normalizedPower: null,
        maxWatts: null,
        avgCadence: null,
        calories: Math.round((durationSec / 60) * 6.8),
        tss,
        rpe,
        gearId: null,
        worldName: null,
        polyline: null,
        startLat: null,
        startLon: null,
        points: [],
        strengthLogs,
        // Vincula la sesión con su rutina: es lo que permite precargar los valores
        // de la última sesión del mismo tipo al repetir el entreno.
        routineId,
        totalVolumeKg: Math.round(totalVolumeKg),
        doneTogether: Boolean(body.doneTogether),
        images: sanitizeImageList(body.images),
        createdAt: nowIso,
      });

      if (routineId) {
        const rt = listRoutines().find((r) => r.id === routineId);
        if (rt) {
          updateRoutine(rt.id, {
            timesCompleted: rt.timesCompleted + 1,
            lastCompletedAt: nowIso,
          });
        }
      }

      return NextResponse.json({ activity }, { status: 201 });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Error al registrar sesión' }, { status: 400 });
    }
  });
}
