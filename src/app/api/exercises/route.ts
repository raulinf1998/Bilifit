import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import { createCustomExercise, listAllExercises, listHomeEquipment } from '@/lib/db';
import { isExerciseCompatible } from '@/lib/home-workouts';
import { sanitizeImageUrl } from '@/lib/uploads';
import type { Exercise } from '@/types';

export async function GET(req: NextRequest) {
  return withAccount(req, () => {
    const onlyOwned = req.nextUrl.searchParams.get('onlyOwned') === '1';
    const muscle = req.nextUrl.searchParams.get('muscle');
    const eqParam = req.nextUrl.searchParams.get('equipmentIds');

    const all = listAllExercises();
    const ownedIds = eqParam
      ? eqParam.split(',').filter(Boolean)
      : listHomeEquipment()
          .filter((e) => e.owned)
          .map((e) => e.id);

    const ownedSet = new Set(ownedIds);

    const filtered = all.filter((ex) => {
      if (onlyOwned && !isExerciseCompatible(ex, ownedSet)) return false;
      if (muscle && muscle !== 'all' && ex.muscleGroup !== muscle) return false;
      return true;
    });

    return NextResponse.json({ exercises: filtered, ownedEquipmentIds: ownedIds });
  });
}

export async function POST(req: NextRequest) {
  return withAccount(req, async () => {
    try {
      const body = await req.json();
      const name = String(body.name || '').trim();
      if (!name) return NextResponse.json({ error: 'Nombre obligatorio' }, { status: 400 });

      const ex = createCustomExercise({
        id: `ex_custom_${crypto.randomUUID().slice(0, 8)}`,
        name,
        muscleGroup: (body.muscleGroup || 'full_body') as Exercise['muscleGroup'],
        secondaryMuscles: Array.isArray(body.secondaryMuscles) ? body.secondaryMuscles : [],
        requiredEquipment: Array.isArray(body.requiredEquipment) ? body.requiredEquipment : [],
        difficulty: (body.difficulty || 'intermedio') as Exercise['difficulty'],
        pattern: (body.pattern || 'empuje') as Exercise['pattern'],
        sportBenefit: Array.isArray(body.sportBenefit) && body.sportBenefit.length > 0 ? body.sportBenefit : ['general'],
        defaultSets: Math.max(1, Number(body.defaultSets || 3)),
        defaultReps: String(body.defaultReps || '10-12'),
        restSeconds: Math.max(15, Number(body.restSeconds || 60)),
        instructions: String(body.instructions || 'Ejecución controlada manteniendo técnica limpia.'),
        imageUrl: body.imageUrl ? sanitizeImageUrl(body.imageUrl) : null,
        perDumbbell: Boolean(body.perDumbbell),
      });

      return NextResponse.json({ exercise: ex }, { status: 201 });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Error al crear ejercicio' }, { status: 400 });
    }
  });
}
