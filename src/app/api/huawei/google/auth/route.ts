import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getGoogleDriveAuthUrl } from '@/lib/huawei-sync';

function baseUrlFromReq(req: NextRequest): string {
  const proto = req.headers.get('x-forwarded-proto') || (req.nextUrl.protocol ? req.nextUrl.protocol.replace(':', '') : 'http');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

export async function GET(req: NextRequest) {
  try {
    const origin = baseUrlFromReq(req);
    const state = crypto.randomBytes(16).toString('hex');
    const url = getGoogleDriveAuthUrl(origin, state);

    const res =
      req.nextUrl.searchParams.get('format') === 'json'
        ? NextResponse.json({ url })
        : NextResponse.redirect(url);

    res.cookies.set('bilifit_google_oauth_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    });
    return res;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Credenciales de Google Drive no configuradas.' },
      { status: 400 }
    );
  }
}
