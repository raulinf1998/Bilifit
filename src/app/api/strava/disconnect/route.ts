import { NextRequest, NextResponse } from 'next/server';
import { clearStravaTokens, getStravaStatus } from '@/lib/strava';

export async function POST(req: NextRequest) {
  clearStravaTokens();
  return NextResponse.json({ ok: true, status: getStravaStatus(req) });
}
