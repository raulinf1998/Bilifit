import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import { createSegmentAndMatch, getActivityById, listSegments } from '@/lib/db';
import { buildSegmentFromRange, detectClimbCandidates } from '@/lib/segments';

export async function GET(req: NextRequest) {
  return withAccount(req, () => {
    const sport = req.nextUrl.searchParams.get('sport') ?? 'all';
    const segments = listSegments(sport);
    return NextResponse.json({ segments });
  });
}

export async function POST(req: NextRequest) {
  return withAccount(req, async () => {
    try {
      const body = await req.json();
      const activityId = String(body.activityId || '');
      if (!activityId) {
        return NextResponse.json({ error: 'activityId es obligatorio' }, { status: 400 });
      }

      const activity = getActivityById(activityId);
      if (!activity) {
        return NextResponse.json({ error: 'Actividad no encontrada' }, { status: 404 });
      }

      if (body.autoDetectClimbs) {
        const candidates = detectClimbCandidates(activity.points);
        if (candidates.length === 0) {
          return NextResponse.json({
            created: [],
            message: 'No se detectaron subidas significativas (>45 m desnivel y >3% pendiente) en esta actividad.',
          });
        }

        const created = [];
        let totalMatched = 0;
        for (let i = 0; i < candidates.length; i++) {
          const c = candidates[i];
          const seg = buildSegmentFromRange({
            activity,
            points: activity.points,
            startDistM: c.startDistM,
            endDistM: c.endDistM,
            name: `${activity.title.slice(0, 32)} · Subida ${i + 1} (+${c.elevationGain} m)`,
            category: 'climb',
          });
          if (!seg) continue;
          const res = createSegmentAndMatch(seg);
          created.push(res.segment);
          totalMatched += res.matchedEfforts;
        }

        return NextResponse.json({ created, matchedEfforts: totalMatched }, { status: 201 });
      }

      const name = String(body.name || '').trim();
      const startDistM = Number(body.startDistM ?? 0);
      const endDistM = Number(body.endDistM ?? 0);
      if (!name) {
        return NextResponse.json({ error: 'El nombre del segmento es obligatorio' }, { status: 400 });
      }
      if (!Number.isFinite(startDistM) || !Number.isFinite(endDistM) || endDistM - startDistM < 100) {
        return NextResponse.json({ error: 'El tramo del segmento debe tener al menos 100 metros.' }, { status: 400 });
      }

      const seg = buildSegmentFromRange({
        activity,
        points: activity.points,
        startDistM,
        endDistM,
        name,
        category: body.category,
      });
      if (!seg) {
        return NextResponse.json({ error: 'No hay suficientes puntos GPS en ese tramo.' }, { status: 400 });
      }

      const res = createSegmentAndMatch(seg);
      return NextResponse.json(res, { status: 201 });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Error creando segmento' },
        { status: 500 }
      );
    }
  });
}
