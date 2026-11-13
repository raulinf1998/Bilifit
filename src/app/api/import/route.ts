import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import { resolveActivityTitle } from '@/lib/activity-naming';
import { createActivity, findDuplicateActivity, getAthleteProfile } from '@/lib/db';
import { defaultSubSportForSport, estimateActivityTSS } from '@/lib/metrics';
import { parseUploadedActivityBatch } from '@/lib/parsers';
import type { SportType } from '@/types';

export async function POST(req: NextRequest) {
  return withAccount(req, async () => {
    try {
      const formData = await req.formData();
      const files = formData.getAll('files') as File[];
      const single = formData.get('file') as File | null;
      if (single) files.push(single);

      const sportOverride = formData.get('sportOverride') ? (String(formData.get('sportOverride')) as SportType) : null;

      if (files.length === 0) {
        return NextResponse.json({ error: 'Adjunta al menos un archivo .fit, .gpx, .tcx o .zip' }, { status: 400 });
      }

      const profile = getAthleteProfile();
      const importedActivities = [];
      let skipped = 0;
      const errors: string[] = [];

      const loadedFiles = await Promise.all(
        files.map(async (file) => ({
          fileName: file.name,
          buffer: Buffer.from(await file.arrayBuffer()),
        }))
      );

      const parsed = await parseUploadedActivityBatch(loadedFiles);
      errors.push(...parsed.errors);

      for (const act of parsed.activities) {
        const finalSport = sportOverride ?? act.sport;
        const finalSubSport =
          sportOverride && sportOverride !== act.sport
            ? defaultSubSportForSport(sportOverride)
            : act.subSport ?? null;
        if (findDuplicateActivity(act.startedAt, finalSport, act.distanceMeters, act.externalId)) {
          skipped++;
          continue;
        }

        const isHuawei = Boolean(
          act.externalId?.startsWith('huawei_') ||
            act.extras?.originApp?.toLowerCase().includes('huawei') ||
            act.extras?.deviceName?.toLowerCase().includes('huawei')
        );

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
          source: isHuawei ? 'huawei' : act.source,
          sport: finalSport,
          subSport: finalSubSport,
          title: resolveActivityTitle(act.title, finalSport, act.startedAt),
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
          laps: act.laps ?? [],
          extras: act.extras ?? null,
          createdAt: new Date().toISOString(),
        });

        importedActivities.push(created);
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
  });
}
