import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import { deleteRoutine, updateRoutine } from '@/lib/db';
import { sanitizeImageUrl } from '@/lib/uploads';
import type { RoutineExerciseItem } from '@/types';

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withAccount(req, async () => {
    const { id } = await context.params;
    const body = await req.json();
    const patch = { ...body };
    if ('coverImageUrl' in patch) {
      patch.coverImageUrl = patch.coverImageUrl ? sanitizeImageUrl(patch.coverImageUrl) : null;
    }
    if (Array.isArray(patch.items)) {
      patch.items = patch.items.map((item: RoutineExerciseItem) => ({
        ...item,
        ...(typeof item.perDumbbell === 'boolean' ? { perDumbbell: item.perDumbbell } : {}),
        imageUrl: item.imageUrl ? sanitizeImageUrl(item.imageUrl) : null,
      }));
    }
    const updated = updateRoutine(id, patch);
    if (!updated) return NextResponse.json({ error: 'Rutina no encontrada' }, { status: 404 });
    return NextResponse.json({ routine: updated });
  });
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withAccount(req, async () => {
    const { id } = await context.params;
    const ok = deleteRoutine(id);
    if (!ok) return NextResponse.json({ error: 'Rutina no encontrada' }, { status: 404 });
    return NextResponse.json({ ok: true });
  });
}
