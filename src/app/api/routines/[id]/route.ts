import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import { deleteRoutine, updateRoutine } from '@/lib/db';

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withAccount(req, async () => {
    const { id } = await context.params;
    const body = await req.json();
    const updated = updateRoutine(id, body);
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
