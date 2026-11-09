import { NextRequest, NextResponse } from 'next/server';
import { buildStravaAuthorizeUrl } from '@/lib/strava';

export async function GET(req: NextRequest) {
  try {
    const url = buildStravaAuthorizeUrl(req);
    if (req.nextUrl.searchParams.get('format') === 'json') {
      return NextResponse.json({ url });
    }
    return NextResponse.redirect(url);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Credenciales Strava no configuradas' },
      { status: 400 }
    );
  }
}
