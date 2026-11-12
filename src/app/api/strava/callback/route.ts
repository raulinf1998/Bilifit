import { NextRequest, NextResponse } from 'next/server';
import { getAccountFromRequest, runWithAccount } from '@/lib/account-context';
import { ACCOUNT_COOKIE_NAME, normalizeAccountId } from '@/lib/accounts';
import { exchangeStravaCode } from '@/lib/strava';

function baseUrlFromReq(req: NextRequest): string {
  const proto = req.headers.get('x-forwarded-proto') || (req.nextUrl.protocol ? req.nextUrl.protocol.replace(':', '') : 'http');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const error = req.nextUrl.searchParams.get('error');
  const state = req.nextUrl.searchParams.get('state');
  const base = baseUrlFromReq(req);

  if (error || !code) {
    return NextResponse.redirect(`${base}/strava?error=${encodeURIComponent(error || 'missing_code')}`);
  }

  const statePrefix = state && state.includes('.') ? state.split('.')[0] : null;
  const targetAccount = normalizeAccountId(statePrefix) ?? getAccountFromRequest(req);

  try {
    await runWithAccount(targetAccount, () => exchangeStravaCode(code));
    const res = NextResponse.redirect(`${base}/strava?connected=1`);
    res.cookies.delete('bilifit_strava_oauth_state');
    res.cookies.set(ACCOUNT_COOKIE_NAME, targetAccount, {
      path: '/',
      maxAge: 31536000,
      sameSite: 'lax',
    });
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'oauth_failed';
    return NextResponse.redirect(`${base}/strava?error=${encodeURIComponent(msg)}`);
  }
}
