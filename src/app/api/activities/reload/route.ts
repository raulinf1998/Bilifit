import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import { reloadAllActivitiesAndSegments } from '@/lib/reprocess';

export async function POST(req: NextRequest) {
  return withAccount(req, async () => {
    try {
      const body = (await req.json().catch(() => ({}))) as {
        reloadSources?: unknown;
        detectClimbs?: unknown;
      };
      const reloadSources = typeof body.reloadSources === 'boolean' ? body.reloadSources : true;
      const detectClimbs = typeof body.detectClimbs === 'boolean' ? body.detectClimbs : true;

      const result = await reloadAllActivitiesAndSegments({
        reloadSources,
        detectClimbs,
      });

      return NextResponse.json(result);
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Error recargando actividades y segmentos' },
        { status: 500 }
      );
    }
  });
}
