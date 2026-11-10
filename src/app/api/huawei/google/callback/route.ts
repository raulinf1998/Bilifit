import { NextRequest, NextResponse } from 'next/server';
import { exchangeGoogleDriveCode } from '@/lib/huawei-sync';

function baseUrlFromReq(req: NextRequest): string {
  const proto = req.headers.get('x-forwarded-proto') || (req.nextUrl.protocol ? req.nextUrl.protocol.replace(':', '') : 'http');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const error = req.nextUrl.searchParams.get('error');
  const state = req.nextUrl.searchParams.get('state');
  const expectedState = req.cookies.get('bilifit_google_oauth_state')?.value;
  const base = baseUrlFromReq(req);

  if (error || !code) {
    return NextResponse.redirect(`${base}/strava?huawei_error=${encodeURIComponent(error || 'missing_code')}`);
  }

  if (!state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(`${base}/strava?huawei_error=${encodeURIComponent('invalid_oauth_state')}`);
  }

  try {
    await exchangeGoogleDriveCode(code, base);
    const res = NextResponse.redirect(`${base}/strava?huawei_connected=1`);
    res.cookies.delete('bilifit_google_oauth_state');
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'google_oauth_failed';
    return NextResponse.redirect(`${base}/strava?huawei_error=${encodeURIComponent(msg)}`);
  }
}
