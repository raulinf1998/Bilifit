import { NextRequest, NextResponse } from 'next/server';
import { getMyWhooshStatus, updateMyWhooshSyncPreferences } from '@/lib/mywhoosh-sync';

export async function GET() {
  return NextResponse.json({ status: getMyWhooshStatus() });
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as { autoSyncEnabled?: unknown; syncIntervalMin?: unknown };
    const status = updateMyWhooshSyncPreferences({
      autoSyncEnabled: typeof body.autoSyncEnabled === 'boolean' ? body.autoSyncEnabled : undefined,
      syncIntervalMin: typeof body.syncIntervalMin === 'number' ? body.syncIntervalMin : undefined,
    });
    return NextResponse.json({ ok: true, status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'No se pudieron actualizar las preferencias de MyWhoosh.' },
      { status: 400 }
    );
  }
}
