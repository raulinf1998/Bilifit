import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import { createActivity, getAthleteProfile, listRoutines, updateRoutine } from '@/lib/db';
import { estimateActivityTSS } from '@/lib/metrics';
import type { StrengthSetLog } from '@/types';

export async function POST(req: NextRequest) {
  return withAccount(req, async () => {
    try {
      const body = await req.json();
      const title = String(body.title || 'Rutina de Fuerza en Casa').trim();
      const durationSec = Math.max(120, Math.round(Number(body.durationSec || 1800)));
      const rpe = Math.min(10, Math.max(1, Number(body.rpe || 7)));
      const strengthLogs: StrengthSetLog[] = Array.isArray(body.strengthLogs) ? body.strengthLogs : [];

      let totalVolumeKg = 0;
      for (const ex of strengthLogs) {
        for (const s of ex.sets) {
          if (s.completed) {
            totalVolumeKg += (Number(s.reps) || 0) * (Number(s.weightKg) || 0);
          }
        }
      }

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
          : `Sesión en casa completada (${strengthLogs.length} ejercicios · ${Math.round(totalVolumeKg)} kg movidos).`,
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
