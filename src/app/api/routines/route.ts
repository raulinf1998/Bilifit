import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import { createRoutine, getLastExerciseLogs, listRoutines } from '@/lib/db';
import { sanitizeImageUrl } from '@/lib/uploads';
import type { Routine, RoutineExerciseItem } from '@/types';

export async function GET(req: NextRequest) {
  return withAccount(req, () =>
    NextResponse.json({
      routines: listRoutines(),
      lastExerciseLogs: getLastExerciseLogs(),
    })
  );
}

export async function POST(req: NextRequest) {
  return withAccount(req, async () => {
    try {
      const body = await req.json();
      const name = String(body.name || '').trim();
      if (!name || !Array.isArray(body.items) || body.items.length === 0) {
        return NextResponse.json({ error: 'La rutina necesita nombre y al menos un ejercicio.' }, { status: 400 });
      }

      const sanitizedItems: RoutineExerciseItem[] = body.items.map((item: RoutineExerciseItem) => ({
        ...item,
        ...(item.imageUrl ? { imageUrl: sanitizeImageUrl(item.imageUrl) } : {}),
      }));

      const routine: Routine = {
        id: `rt_${crypto.randomUUID().slice(0, 10)}`,
        name,
        goal: body.goal || 'fuerza_general',
        level: body.level || 'intermedio',
        estimatedMinutes: Number(body.estimatedMinutes || 35),
        equipmentIds: Array.isArray(body.equipmentIds) ? body.equipmentIds : [],
        items: sanitizedItems,
        notes: body.notes ? String(body.notes) : null,
        coverImageUrl: body.coverImageUrl ? sanitizeImageUrl(body.coverImageUrl) : null,
        timesCompleted: 0,
        lastCompletedAt: null,
        createdAt: new Date().toISOString(),
      };

      createRoutine(routine);
      return NextResponse.json({ routine }, { status: 201 });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Error al guardar rutina' }, { status: 400 });
    }
  });
}
