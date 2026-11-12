import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import { syncStravaActivities } from '@/lib/strava';

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get('hub.mode');
  const token = req.nextUrl.searchParams.get('hub.verify_token');
  const challenge = req.nextUrl.searchParams.get('hub.challenge');
  const expected = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN || 'bilifit_webhook_token';

  if (mode === 'subscribe' && token === expected && challenge) {
    return NextResponse.json({ 'hub.challenge': challenge });
  }
  return NextResponse.json({ error: 'Token de verificación inválido' }, { status: 403 });
}

export async function POST(req: NextRequest) {
  return withAccount(req, async () => {
    try {
      const payload = (await req.json()) as { object_type?: string; aspect_type?: string };
      if (payload.object_type === 'activity' && (payload.aspect_type === 'create' || payload.aspect_type === 'update')) {
        syncStravaActivities(5, true).catch(() => undefined);
      }
      return NextResponse.json({ received: true });
    } catch {
      return NextResponse.json({ received: true });
    }
  });
}
