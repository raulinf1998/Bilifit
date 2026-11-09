import { NextRequest, NextResponse } from 'next/server';
import { exchangeStravaCode } from '@/lib/strava';

function baseUrlFromReq(req: NextRequest): string {
  const proto = req.headers.get('x-forwarded-proto') || (req.nextUrl.protocol ? req.nextUrl.protocol.replace(':', '') : 'http');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const error = req.nextUrl.searchParams.get('error');
  const base = baseUrlFromReq(req);

  if (error || !code) {
    return NextResponse.redirect(`${base}/strava?error=${encodeURIComponent(error || 'missing_code')}`);
  }

  try {
    await exchangeStravaCode(code);
    return NextResponse.redirect(`${base}/strava?connected=1`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'oauth_failed';
    return NextResponse.redirect(`${base}/strava?error=${encodeURIComponent(msg)}`);
  }
}
