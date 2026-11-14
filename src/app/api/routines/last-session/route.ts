import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import { getLastStrengthSessionPrefill, listRoutines } from '@/lib/db';

/**
 * GET /api/routines/last-session?routineId=rt_x&title=Nombre
 *
 * Devuelve las series completadas de la última sesión de ese mismo tipo de
 * entrenamiento, para precargar repeticiones y peso al repetir el entreno.
 * `title` es el respaldo para planes generados que no se han guardado como
 * rutina y para sesiones anteriores a vincular rutina_id.
 */
export async function GET(req: NextRequest) {
  return withAccount(req, async () => {
    const params = new URL(req.url).searchParams;
    const routineId = params.get('routineId');
    let title = params.get('title');

    if (routineId && !title) {
      const rt = listRoutines().find((r) => r.id === routineId);
      title = rt?.name ?? null;
    }

    if (!routineId && !title) {
      return NextResponse.json({ error: 'Falta routineId o title' }, { status: 400 });
    }

    const prefill = getLastStrengthSessionPrefill({ routineId, title });
    return NextResponse.json({ prefill });
  });
}
