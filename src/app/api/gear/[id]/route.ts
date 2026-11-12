import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import { deleteGear, updateGear } from '@/lib/db';

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withAccount(req, async () => {
    const { id } = await context.params;
    const body = await req.json();
    const updated = updateGear(id, body);
    if (!updated) return NextResponse.json({ error: 'Equipamiento no encontrado' }, { status: 404 });
    return NextResponse.json({ item: updated });
  });
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withAccount(req, async () => {
    const { id } = await context.params;
    const ok = deleteGear(id);
    if (!ok) return NextResponse.json({ error: 'Equipamiento no encontrado' }, { status: 404 });
    return NextResponse.json({ ok: true });
  });
}
