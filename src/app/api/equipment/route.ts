import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import { createCustomEquipment, listHomeEquipment, toggleHomeEquipment } from '@/lib/db';
import type { HomeEquipment } from '@/types';

export async function GET(req: NextRequest) {
  return withAccount(req, () => NextResponse.json({ equipment: listHomeEquipment() }));
}

export async function POST(req: NextRequest) {
  return withAccount(req, async () => {
    try {
      const body = await req.json();
      if (body.id && typeof body.owned === 'boolean') {
        const updated = toggleHomeEquipment(String(body.id), body.owned, body.details);
        if (!updated) return NextResponse.json({ error: 'Material no encontrado' }, { status: 404 });
        return NextResponse.json({ item: updated, equipment: listHomeEquipment() });
      }

      const name = String(body.name || '').trim();
      if (!name) return NextResponse.json({ error: 'El nombre del material es obligatorio' }, { status: 400 });

      const item = createCustomEquipment({
        id: `eq_${crypto.randomUUID().slice(0, 8)}`,
        name,
        category: (body.category || 'peso_libre') as HomeEquipment['category'],
        description: String(body.description || 'Material personalizado en casa'),
        owned: body.owned !== false,
        details: body.details ? String(body.details) : null,
      });

      return NextResponse.json({ item, equipment: listHomeEquipment() }, { status: 201 });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Error con material' }, { status: 400 });
    }
  });
}
