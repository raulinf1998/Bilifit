import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import { disconnectGoogleDrive } from '@/lib/huawei-sync';

export async function POST(req: NextRequest) {
  return withAccount(req, () => {
    const status = disconnectGoogleDrive();
    return NextResponse.json({ ok: true, status });
  });
}
