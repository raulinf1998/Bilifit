import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createRoutine, listRoutines } from '@/lib/db';
import type { Routine } from '@/types';

export async function GET() {
  return NextResponse.json({ routines: listRoutines() });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = String(body.name || '').trim();
    if (!name || !Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: 'La rutina necesita nombre y al menos un ejercicio.' }, { status: 400 });
    }

    const routine: Routine = {
      id: `rt_${crypto.randomUUID().slice(0, 10)}`,
      name,
      goal: body.goal || 'fuerza_general',
      level: body.level || 'intermedio',
      estimatedMinutes: Number(body.estimatedMinutes || 35),
      equipmentIds: Array.isArray(body.equipmentIds) ? body.equipmentIds : [],
      items: body.items,
      notes: body.notes ? String(body.notes) : null,
      timesCompleted: 0,
      lastCompletedAt: null,
      createdAt: new Date().toISOString(),
    };

    createRoutine(routine);
    return NextResponse.json({ routine }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error al guardar rutina' }, { status: 400 });
  }
}
