import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import { assignGearToActivities, listGear } from '@/lib/db';
import { GEAR_SPORT_OPTIONS, defaultGearSports } from '@/lib/gear-scope';
import type { SportType } from '@/types';

function isoBound(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? new Date(ts).toISOString() : null;
}

/**
 * POST /api/gear/:id/assign
 *
 * Reparte el material entre las actividades de unos deportes dentro de una franja de
 * fechas — o lo quita de ellas. Con `dryRun: true` sólo cuenta, que es lo que usa la
 * vista previa del diálogo antes de aceptar.
 *
 * body: { sports?: SportType[], from?: string, to?: string, onlyWithoutGear?: boolean,
 *         mode?: 'assign' | 'unassign', dryRun?: boolean }
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withAccount(req, async () => {
    try {
      const { id } = await context.params;
      const gear = listGear().find((g) => g.id === id);
      if (!gear) return NextResponse.json({ error: 'Material no encontrado' }, { status: 404 });

      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const mode: 'assign' | 'unassign' = body.mode === 'unassign' ? 'unassign' : 'assign';
      const sports = Array.isArray(body.sports)
        ? body.sports.filter((s): s is SportType => typeof s === 'string' && (GEAR_SPORT_OPTIONS as string[]).includes(s))
        : defaultGearSports(gear);
      // Sin deportes no se puede dejar: repartiría las zapatillas también entre las
      // sesiones de fuerza
      if (sports.length === 0) {
        return NextResponse.json({ error: 'Elige al menos un deporte' }, { status: 400 });
      }

      const result = assignGearToActivities(id, {
        mode,
        sports,
        from: isoBound(body.from),
        to: isoBound(body.to),
        onlyWithoutGear: body.onlyWithoutGear === true,
        dryRun: body.dryRun === true,
      });

      const gearAfter = listGear();
      const item = gearAfter.find((g) => g.id === id) ?? null;
      const affectedKm = Math.round((result.distanceMeters / 1000) * 10) / 10;
      const currentTotalKm = item ? Math.round((item.initialKm + item.trackedKm) * 10) / 10 : 0;
      // En seco, lo que sumaría (o quitaría) la operación aún no está en `trackedKm`
      const projectedTotalKm = result.dryRun
        ? Math.max(0, Math.round((currentTotalKm + (mode === 'unassign' ? -affectedKm : affectedKm)) * 10) / 10)
        : currentTotalKm;

      return NextResponse.json({
        result,
        item,
        gear: gearAfter,
        affectedKm,
        projectedTotalKm,
        overMax: item ? projectedTotalKm > item.maxKm : false,
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'No se pudo aplicar el material' },
        { status: 400 }
      );
    }
  });
}
