import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import { getActivityById, listActivities } from '@/lib/db';
import { computeRunningRecords } from '@/lib/running-records';
import type { ActivityDetail } from '@/types';

export async function GET(req: NextRequest) {
  return withAccount(req, () => {
    const activities = listActivities({ sport: 'running' });
    const details = activities.map((activity) => getActivityById(activity.id)).filter((activity): activity is ActivityDetail => activity !== null);
    return NextResponse.json({ activities, records: computeRunningRecords(details) });
  });
}
