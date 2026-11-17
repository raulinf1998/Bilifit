import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import { getActivityById, listActivities } from '@/lib/db';
import { computeSportRecords } from '@/lib/running-records';
import type { ActivityDetail, SportType } from '@/types';

export async function GET(req: NextRequest) {
  return withAccount(req, () => {
    const type = req.nextUrl.searchParams.get('type');
    const sports: SportType[] = type === 'cycling' ? ['cycling', 'mywhoosh'] : type === 'mountain' ? ['mountain', 'trail'] : [];
    if (!sports.length) return NextResponse.json({ error: 'Deporte no válido' }, { status: 400 });
    const details = sports.flatMap((sport) => listActivities({ sport }).map((activity) => getActivityById(activity.id)))
      .filter((activity): activity is ActivityDetail => activity !== null);
    return NextResponse.json({ records: computeSportRecords(details, sports, { minSpeed: 0.35, maxSpeed: type === 'cycling' ? 35 : 10 }) });
  });
}
