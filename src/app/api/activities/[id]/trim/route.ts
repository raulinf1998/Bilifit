import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import {
  previewActivityTrim,
  resolveTrimSpecFromInput,
  type TrimInputSpec,
  type TrimMode,
  type TrimUnit,
} from '@/lib/activity-trim';
import { getActivityById, trimActivity } from '@/lib/db';

const VALID_MODES = new Set<TrimMode>(['start', 'end', 'middle', 'range']);
const VALID_UNITS = new Set<TrimUnit>(['km', 'sec']);

function parseTrimInput(body: Record<string, unknown>): TrimInputSpec {
  const mode = String(body.mode ?? '') as TrimMode;
  if (!VALID_MODES.has(mode)) {
    throw new Error('Modo de recorte no válido. Usa start, end, middle o range.');
  }

  const unit: TrimUnit = VALID_UNITS.has(body.unit as TrimUnit) ? (body.unit as TrimUnit) : 'sec';
  const toOptNum = (v: unknown): number | undefined => {
    if (v === null || v === undefined || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  return {
    mode,
    unit,
    fromKm: toOptNum(body.fromKm),
    toKm: toOptNum(body.toKm),
    fromSec: toOptNum(body.fromSec),
    toSec: toOptNum(body.toSec),
    cutSec: toOptNum(body.cutSec),
    cutStartSec: toOptNum(body.cutStartSec),
    cutEndSec: toOptNum(body.cutEndSec),
    startSec: toOptNum(body.startSec),
    endSec: toOptNum(body.endSec),
  };
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withAccount(req, async () => {
    const { id } = await context.params;
    try {
      const body = (await req.json()) as Record<string, unknown>;
      const input = parseTrimInput(body);
      const activity = getActivityById(id);
      if (!activity) {
        return NextResponse.json({ error: 'Actividad no encontrada' }, { status: 404 });
      }

      const spec = resolveTrimSpecFromInput(activity.points, input);
      const fallbackRatio =
        activity.durationSec > 0 && activity.movingTimeSec > 0
          ? Math.min(1, activity.movingTimeSec / activity.durationSec)
          : 1;
      const preview = previewActivityTrim(activity.points, activity.sport, spec, fallbackRatio);
      if (!preview.valid) {
        return NextResponse.json({ error: preview.error || 'Rango de recorte no válido', preview }, { status: 400 });
      }

      if (body.previewOnly === true) {
        return NextResponse.json({ preview });
      }

      const result = trimActivity(id, spec);
      if (!result) {
        return NextResponse.json({ error: 'Actividad no encontrada' }, { status: 404 });
      }
      return NextResponse.json({ activity: result.activity, preview: result.preview });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'No se pudo recortar la actividad' },
        { status: 400 }
      );
    }
  });
}
