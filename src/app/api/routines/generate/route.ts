import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import { listAllExercises, listHomeEquipment } from '@/lib/db';
import { generateHomeRoutine, getAlternativeExercises } from '@/lib/home-workouts';
import type { RoutineGoal } from '@/types';

export async function POST(req: NextRequest) {
  return withAccount(req, async () => {
    try {
      const body = await req.json();
      const exercisePool = listAllExercises();
      const equipmentIds: string[] = Array.isArray(body.equipmentIds)
        ? body.equipmentIds
        : listHomeEquipment()
            .filter((e) => e.owned)
            .map((e) => e.id);

      if (body.alternativesFor) {
        const alternatives = getAlternativeExercises(
          String(body.alternativesFor),
          equipmentIds,
          Array.isArray(body.excludeIds) ? body.excludeIds : [],
          exercisePool
        );
        return NextResponse.json({ alternatives: alternatives.slice(0, 12) });
      }

      const plan = generateHomeRoutine({
        goal: (body.goal || 'fuerza_general') as RoutineGoal,
        level: body.level || 'intermedio',
        durationMin: Number(body.durationMin || 30),
        availableEquipmentIds: equipmentIds,
        exercisePool,
        variationSeed: typeof body.variationSeed === 'number' ? body.variationSeed : Math.floor(Math.random() * 1000),
      });

      return NextResponse.json({ plan });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Error al generar rutina' }, { status: 400 });
    }
  });
}
