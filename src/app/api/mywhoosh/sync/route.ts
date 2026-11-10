import { NextRequest, NextResponse } from 'next/server';
import { getMyWhooshStatus, syncMyWhooshActivities } from '@/lib/mywhoosh-sync';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      limit?: number;
      maxPages?: number;
      syncAll?: boolean;
      retryFailed?: boolean;
    };

    const result = await syncMyWhooshActivities({
      limit: typeof body.limit === 'number' ? body.limit : 30,
      maxPages: typeof body.maxPages === 'number' ? body.maxPages : 5,
      syncAll: Boolean(body.syncAll),
      retryFailed: typeof body.retryFailed === 'boolean' ? body.retryFailed : true,
    });

    return NextResponse.json({
      ok: true,
      ...result,
      status: getMyWhooshStatus(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Error al sincronizar con MyWhoosh.',
        status: getMyWhooshStatus(),
      },
      { status: 400 }
    );
  }
}
