import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import { updateExerciseImage } from '@/lib/db';

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withAccount(req, async () => {
    try {
      const { id } = await context.params;
      const body = await req.json();
      if (!('imageUrl' in body)) {
        return NextResponse.json({ error: 'Falta el campo imageUrl' }, { status: 400 });
      }
      const rawUrl = body.imageUrl === null || body.imageUrl === '' ? null : String(body.imageUrl);
      const updated = updateExerciseImage(id, rawUrl);
      if (!updated) {
        return NextResponse.json({ error: 'Ejercicio no encontrado' }, { status: 404 });
      }
      return NextResponse.json({ exercise: updated });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Error al actualizar imagen del ejercicio' },
        { status: 400 }
      );
    }
  });
}
