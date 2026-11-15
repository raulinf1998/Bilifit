import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import { reloadAllActivitiesAndSegments } from '@/lib/reprocess';

export async function POST(req: NextRequest) {
  return withAccount(req, async () => {
    try {
      const body = (await req.json().catch(() => ({}))) as {
        reloadSources?: unknown;
        detectClimbs?: unknown;
        elevationFromGps?: unknown;
      };
      const reloadSources = typeof body.reloadSources === 'boolean' ? body.reloadSources : true;
      const detectClimbs = typeof body.detectClimbs === 'boolean' ? body.detectClimbs : true;
      // Altitud desde el GPS: activada por defecto, se puede apagar para un reload rápido
      const elevationFromGps = typeof body.elevationFromGps === 'boolean' ? body.elevationFromGps : true;

      const result = await reloadAllActivitiesAndSegments({
        reloadSources,
        detectClimbs,
        elevationFromGps,
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
