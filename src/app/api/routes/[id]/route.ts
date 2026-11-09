import { NextRequest, NextResponse } from 'next/server';
import { deleteMountainRoute, listMountainRoutes, updateMountainRoute } from '@/lib/db';
import { generateGpxString } from '@/lib/parsers/gpx';

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const route = listMountainRoutes().find((r) => r.id === id);
  if (!route) return NextResponse.json({ error: 'Ruta no encontrada' }, { status: 404 });

  if (req.nextUrl.searchParams.get('format') === 'gpx') {
    const gpx = generateGpxString(route.name, route.points, 'hiking');
    return new NextResponse(gpx, {
      status: 200,
      headers: {
        'Content-Type': 'application/gpx+xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${route.id}.gpx"`,
      },
    });
  }
  return NextResponse.json({ route });
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await req.json();
  const updated = updateMountainRoute(id, body);
  if (!updated) return NextResponse.json({ error: 'Ruta no encontrada' }, { status: 404 });
  return NextResponse.json({ route: updated });
}

export async function DELETE(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const ok = deleteMountainRoute(id);
  if (!ok) return NextResponse.json({ error: 'Ruta no encontrada' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
