import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createGear, listGear } from '@/lib/db';
import type { GearItem, SportType } from '@/types';

export async function GET() {
  return NextResponse.json({ gear: listGear() });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = String(body.name || '').trim();
    if (!name) return NextResponse.json({ error: 'Nombre obligatorio' }, { status: 400 });

    const item = createGear({
      id: `gear_${crypto.randomUUID().slice(0, 10)}`,
      name,
      brand: body.brand ? String(body.brand) : null,
      category: (body.category || 'running_shoes') as GearItem['category'],
      defaultForSport: body.defaultForSport ? (String(body.defaultForSport) as SportType) : null,
      initialKm: Math.max(0, Number(body.initialKm || 0)),
      maxKm: Math.max(50, Number(body.maxKm || 700)),
      active: body.active !== false,
      notes: body.notes ? String(body.notes) : null,
    });

    return NextResponse.json({ item, gear: listGear() }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error al crear material' }, { status: 400 });
  }
}
