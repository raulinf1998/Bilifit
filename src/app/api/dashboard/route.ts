import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import {
  getAthleteProfile,
  listActivities,
  listGear,
  listHomeEquipment,
  listMountainRoutes,
  listRoutines,
} from '@/lib/db';
import { calculatePMC } from '@/lib/metrics';
import { getHuaweiStatus } from '@/lib/huawei-sync';
import { getMyWhooshStatus } from '@/lib/mywhoosh-sync';
import { getStravaStatus } from '@/lib/strava';

export async function GET(req: NextRequest) {
  return withAccount(req, () => {
    const profile = getAthleteProfile();
    const activities = listActivities();
    const pmc = calculatePMC(activities, 90);
    const latestPmc = pmc[pmc.length - 1] ?? { ctl: 0, atl: 0, tsb: 0, tss: 0, date: '' };

    const now = Date.now();
    const weekMs = 7 * 86400 * 1000;
    const monthMs = 30 * 86400 * 1000;

    const thisWeek = activities.filter((a) => now - Date.parse(a.startedAt) <= weekMs);
    const thisMonth = activities.filter((a) => now - Date.parse(a.startedAt) <= monthMs);

    const weekDistanceKm = Math.round((thisWeek.reduce((s, a) => s + a.distanceMeters, 0) / 1000) * 10) / 10;
    const weekDurationHours = Math.round((thisWeek.reduce((s, a) => s + a.durationSec, 0) / 3600) * 10) / 10;
    const weekElevationM = Math.round(thisWeek.reduce((s, a) => s + a.elevationGain, 0));
    const weekTss = thisWeek.reduce((s, a) => s + a.tss, 0);

    const monthBySport = {
      running: thisMonth.filter((a) => a.sport === 'running').length,
      trail: thisMonth.filter((a) => a.sport === 'trail').length,
      mywhoosh: thisMonth.filter((a) => a.sport === 'mywhoosh').length,
      cycling: thisMonth.filter((a) => a.sport === 'cycling').length,
      mountain: thisMonth.filter((a) => a.sport === 'mountain').length,
      walking: thisMonth.filter((a) => a.sport === 'walking').length,
      strength: thisMonth.filter((a) => a.sport === 'strength').length,
    };

    const weeklyBuckets: Array<{
      label: string;
      runningHours: number;
      trailHours: number;
      mywhooshHours: number;
      cyclingHours: number;
      mountainHours: number;
      walkingHours: number;
      strengthHours: number;
      totalKm: number;
      totalTss: number;
    }> = [];

    for (let w = 7; w >= 0; w--) {
      const startTs = now - (w + 1) * weekMs;
      const endTs = now - w * weekMs;
      const items = activities.filter((a) => {
        const ts = Date.parse(a.startedAt);
        return ts > startTs && ts <= endTs;
      });

      const d = new Date(endTs);
      const label = `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
      const hoursFor = (sport: string) =>
        Math.round((items.filter((i) => i.sport === sport).reduce((s, i) => s + i.durationSec, 0) / 3600) * 100) / 100;

      weeklyBuckets.push({
        label,
        runningHours: hoursFor('running'),
        trailHours: hoursFor('trail'),
        mywhooshHours: hoursFor('mywhoosh'),
        cyclingHours: hoursFor('cycling'),
        mountainHours: hoursFor('mountain'),
        walkingHours: hoursFor('walking'),
        strengthHours: hoursFor('strength'),
        totalKm: Math.round((items.reduce((s, i) => s + i.distanceMeters, 0) / 1000) * 10) / 10,
        totalTss: items.reduce((s, i) => s + i.tss, 0),
      });
    }

    return NextResponse.json({
      profile,
      summary: {
        totalActivities: activities.length,
        weekSessions: thisWeek.length,
        weekDistanceKm,
        weekDurationHours,
        weekElevationM,
        weekTss,
        fitnessCtl: latestPmc.ctl,
        fatigueAtl: latestPmc.atl,
        formTsb: latestPmc.tsb,
        monthBySport,
      },
      pmc,
      weeklyBuckets,
      recentActivities: activities.slice(0, 8),
      gear: listGear(),
      ownedEquipmentCount: listHomeEquipment().filter((e) => e.owned).length,
      routinesCount: listRoutines().length,
      pendingRoutesCount: listMountainRoutes().filter((r) => r.status === 'pending').length,
      strava: getStravaStatus(),
      mywhoosh: getMyWhooshStatus(),
      huawei: getHuaweiStatus(),
    });
  });
}
