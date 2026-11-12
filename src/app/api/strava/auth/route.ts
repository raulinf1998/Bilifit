import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import { buildStravaAuthorizeUrl } from '@/lib/strava';

export async function GET(req: NextRequest) {
  return withAccount(req, (account) => {
    try {
      const url = new URL(buildStravaAuthorizeUrl(req));
      const state = `${account}.${crypto.randomBytes(12).toString('hex')}`;
      url.searchParams.set('state', state);

      const finalUrl = url.toString();
      const res =
        req.nextUrl.searchParams.get('format') === 'json'
          ? NextResponse.json({ url: finalUrl })
          : NextResponse.redirect(finalUrl);

      res.cookies.set('bilifit_strava_oauth_state', state, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 600,
      });
      return res;
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Credenciales Strava no configuradas' },
        { status: 400 }
      );
    }
  });
}
