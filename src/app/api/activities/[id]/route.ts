import { NextRequest, NextResponse } from 'next/server';
import { deleteActivity, getActivityById, updateActivity } from '@/lib/db';
import { computePowerCurve } from '@/lib/metrics';
import { generateGpxString } from '@/lib/parsers/gpx';

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const activity = getActivityById(id);
  if (!activity) {
    return NextResponse.json({ error: 'Actividad no encontrada' }, { status: 404 });
  }

  if (req.nextUrl.searchParams.get('format') === 'gpx') {
    const gpx = generateGpxString(activity.title, activity.points, activity.sport);
    return new NextResponse(gpx, {
      status: 200,
      headers: {
        'Content-Type': 'application/gpx+xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${activity.id}.gpx"`,
      },
    });
  }

  const powerCurve = activity.avgWatts ? computePowerCurve(activity.points) : [];
  return NextResponse.json({ activity: { ...activity, powerCurve } });
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const body = await req.json();
    const updated = updateActivity(id, {
      title: typeof body.title === 'string' ? body.title.trim() : undefined,
      sport: body.sport,
      subSport: body.subSport,
      description: body.description,
      rpe: typeof body.rpe === 'number' ? body.rpe : undefined,
      gearId: body.gearId,
      worldName: body.worldName,
    });
    if (!updated) {
      return NextResponse.json({ error: 'Actividad no encontrada' }, { status: 404 });
    }
    return NextResponse.json({ activity: updated });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error al actualizar' }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const ok = deleteActivity(id);
  if (!ok) {
    return NextResponse.json({ error: 'Actividad no encontrada' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
