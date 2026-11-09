import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createActivity, findDuplicateActivity, getAthleteProfile } from '@/lib/db';
import { estimateActivityTSS } from '@/lib/metrics';
import { parseUploadedActivityFile } from '@/lib/parsers';
import type { SportType } from '@/types';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll('files') as File[];
    const single = formData.get('file') as File | null;
    if (single) files.push(single);

    const sportOverride = formData.get('sportOverride') ? String(formData.get('sportOverride')) as SportType : null;

    if (files.length === 0) {
      return NextResponse.json({ error: 'Adjunta al menos un archivo .fit, .gpx, .tcx o .zip' }, { status: 400 });
    }

    const profile = getAthleteProfile();
    const importedActivities = [];
    let skipped = 0;
    const errors: string[] = [];

    for (const file of files) {
      const arrayBuf = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      const parsed = await parseUploadedActivityFile(file.name, buffer);
      errors.push(...parsed.errors);

      for (const act of parsed.activities) {
        const finalSport = sportOverride ?? act.sport;
        if (findDuplicateActivity(act.startedAt, finalSport, act.distanceMeters, act.externalId)) {
          skipped++;
          continue;
        }

        const tss = estimateActivityTSS(
          {
            sport: finalSport,
            durationSec: act.durationSec,
            movingTimeSec: act.movingTimeSec,
            avgWatts: act.avgWatts ?? null,
            normalizedPower: act.normalizedPower ?? null,
            avgHr: act.avgHr ?? null,
            elevationGain: act.elevationGain,
          },
          profile
        );

        const created = createActivity({
          id: `act_${crypto.randomUUID().slice(0, 12)}`,
          externalId: act.externalId ?? null,
          source: act.source,
          sport: finalSport,
          subSport: act.subSport ?? null,
          title: act.title,
          description: act.description ?? null,
          startedAt: act.startedAt,
          durationSec: act.durationSec,
          movingTimeSec: act.movingTimeSec,
          distanceMeters: act.distanceMeters,
          elevationGain: act.elevationGain,
          elevationLoss: act.elevationLoss,
          avgSpeedMs: act.avgSpeedMs ?? null,
          maxSpeedMs: act.maxSpeedMs ?? null,
          avgHr: act.avgHr ?? null,
          maxHr: act.maxHr ?? null,
          avgWatts: act.avgWatts ?? null,
          normalizedPower: act.normalizedPower ?? null,
          maxWatts: act.maxWatts ?? null,
          avgCadence: act.avgCadence ?? null,
          calories: act.calories ?? Math.round((act.durationSec / 60) * 10),
          tss,
          rpe: null,
          gearId: null,
          worldName: act.worldName ?? null,
          polyline: act.polyline ?? null,
          startLat: act.startLat ?? null,
          startLon: act.startLon ?? null,
          points: act.points,
          strengthLogs: [],
          totalVolumeKg: null,
          createdAt: new Date().toISOString(),
        });

        importedActivities.push(created);
      }
    }

    return NextResponse.json({
      imported: importedActivities.length,
      skipped,
      activities: importedActivities,
      errors,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error al importar archivos' },
      { status: 500 }
    );
  }
}
