import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import { syncStravaActivities } from '@/lib/strava';

export async function POST(req: NextRequest) {
  return withAccount(req, async () => {
    try {
      const body = await req.json().catch(() => ({}));
      const limit = typeof body.limit === 'number' ? body.limit : 30;
      const result = await syncStravaActivities(limit, true);
      return NextResponse.json({ ok: true, ...result });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Error al sincronizar con Strava' },
        { status: 400 }
      );
    }
  });
}
