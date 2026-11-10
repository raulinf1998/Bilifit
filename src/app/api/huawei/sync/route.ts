import { NextRequest, NextResponse } from 'next/server';
import { getHuaweiStatus, syncHuaweiActivities } from '@/lib/huawei-sync';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      mode?: 'auto' | 'folder' | 'drive';
      limit?: number;
      maxPages?: number;
      retryFailed?: boolean;
    };

    const result = await syncHuaweiActivities({
      mode: body.mode === 'folder' || body.mode === 'drive' ? body.mode : 'auto',
      limit: typeof body.limit === 'number' ? body.limit : 50,
      maxPages: typeof body.maxPages === 'number' ? body.maxPages : 10,
      retryFailed: typeof body.retryFailed === 'boolean' ? body.retryFailed : true,
    });

    return NextResponse.json({
      ok: true,
      ...result,
      status: getHuaweiStatus(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Error al sincronizar Huawei Health.',
        status: getHuaweiStatus(),
      },
      { status: 400 }
    );
  }
}
