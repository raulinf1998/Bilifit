import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import { getStravaStatus, saveStravaClientCredentials } from '@/lib/strava';

export async function GET(req: NextRequest) {
  return withAccount(req, () => NextResponse.json({ status: getStravaStatus(req) }));
}

export async function POST(req: NextRequest) {
  return withAccount(req, async () => {
    try {
      const body = await req.json();
      const clientId = String(body.clientId || '').trim();
      const clientSecret = String(body.clientSecret || '').trim();
      if (!clientId || !clientSecret) {
        return NextResponse.json({ error: 'Introduce Client ID y Client Secret de Strava.' }, { status: 400 });
      }
      saveStravaClientCredentials(clientId, clientSecret);
      return NextResponse.json({ status: getStravaStatus(req) });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Error al guardar credenciales' }, { status: 400 });
    }
  });
}
