import { NextResponse } from 'next/server';
import { disconnectMyWhoosh } from '@/lib/mywhoosh-sync';

export async function POST() {
  const status = disconnectMyWhoosh();
  return NextResponse.json({ ok: true, status });
}
