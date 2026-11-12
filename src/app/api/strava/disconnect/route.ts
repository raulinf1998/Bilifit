import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import { clearStravaTokens, getStravaStatus } from '@/lib/strava';

export async function POST(req: NextRequest) {
  return withAccount(req, () => {
    clearStravaTokens();
    return NextResponse.json({ ok: true, status: getStravaStatus(req) });
  });
}
