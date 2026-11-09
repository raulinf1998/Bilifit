import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  const row = getDb().prepare('SELECT COUNT(*) as activities FROM activities').get() as { activities: number };
  return NextResponse.json({ ok: true, service: 'bilifit', activities: row.activities });
}
