import { NextRequest, NextResponse } from 'next/server';
import { connectMyWhooshAccount, syncMyWhooshActivities } from '@/lib/mywhoosh-sync';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      email?: string;
      password?: string;
      rememberPassword?: boolean;
      autoSyncEnabled?: boolean;
      syncIntervalMin?: number;
      useEnv?: boolean;
      syncNow?: boolean;
    };

    let status = await connectMyWhooshAccount({
      email: body.email,
      password: body.password,
      rememberPassword: Boolean(body.rememberPassword),
      autoSyncEnabled: typeof body.autoSyncEnabled === 'boolean' ? body.autoSyncEnabled : undefined,
      syncIntervalMin: typeof body.syncIntervalMin === 'number' ? body.syncIntervalMin : undefined,
      useEnv: Boolean(body.useEnv),
    });

    let syncResult = null;
    if (body.syncNow) {
      try {
        syncResult = await syncMyWhooshActivities({ limit: 30, maxPages: 5, retryFailed: true });
        const { getMyWhooshStatus } = await import('@/lib/mywhoosh-sync');
        status = getMyWhooshStatus();
      } catch (syncErr) {
        return NextResponse.json({
          ok: true,
          status,
          syncError: syncErr instanceof Error ? syncErr.message : 'Conectado, pero falló la primera sincronización.',
        });
      }
    }

    return NextResponse.json({ ok: true, status, syncResult });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'No se pudo conectar con MyWhoosh.' },
      { status: 400 }
    );
  }
}
