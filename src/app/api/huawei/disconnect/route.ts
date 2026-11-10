import { NextResponse } from 'next/server';
import { disconnectGoogleDrive } from '@/lib/huawei-sync';

export async function POST() {
  const status = disconnectGoogleDrive();
  return NextResponse.json({ ok: true, status });
}
