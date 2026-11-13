import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import { createActivity, getAthleteProfile, listAllExercises, listRoutines, updateRoutine } from '@/lib/db';
import { calculateStrengthSetVolumeKg, resolveIsPerDumbbell } from '@/lib/home-workouts';
import { estimateActivityTSS } from '@/lib/metrics';
import { sanitizeImageList } from '@/lib/uploads';
import type { StrengthSetLog } from '@/types';

export async function POST(req: NextRequest) {
  return withAccount(req, async () => {
    try {
      const body = await req.json();
      const title = String(body.title || 'Rutina de Fuerza en Casa').trim();
      const durationSec = Math.max(120, Math.round(Number(body.durationSec || 1800)));
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

      const nowIso = new Date().toISOString();
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
        startedAt: nowIso,
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
        totalVolumeKg: Math.round(totalVolumeKg),
        doneTogether: Boolean(body.doneTogether),
        images: sanitizeImageList(body.images),
        createdAt: nowIso,
      });

      if (body.routineId) {
        const rt = listRoutines().find((r) => r.id === body.routineId);
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
