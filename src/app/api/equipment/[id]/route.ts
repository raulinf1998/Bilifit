import { NextRequest, NextResponse } from 'next/server';
import { deleteCustomEquipment, listHomeEquipment, toggleHomeEquipment } from '@/lib/db';

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await req.json();
  const updated = toggleHomeEquipment(id, Boolean(body.owned), body.details);
  if (!updated) return NextResponse.json({ error: 'Material no encontrado' }, { status: 404 });
  return NextResponse.json({ item: updated, equipment: listHomeEquipment() });
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const ok = deleteCustomEquipment(id);
  if (!ok) {
    return NextResponse.json({ error: 'Solo se pueden eliminar materiales personalizados' }, { status: 400 });
  }
  return NextResponse.json({ ok: true, equipment: listHomeEquipment() });
}
