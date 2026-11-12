import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import { disconnectMyWhoosh } from '@/lib/mywhoosh-sync';

export async function POST(req: NextRequest) {
  return withAccount(req, () => {
    const status = disconnectMyWhoosh();
    return NextResponse.json({ ok: true, status });
  });
}
