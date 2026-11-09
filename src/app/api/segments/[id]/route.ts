import { NextRequest, NextResponse } from 'next/server';
import { deleteSegment, getSegmentWithEfforts } from '@/lib/db';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = getSegmentWithEfforts(id);
  if (!data) {
    return NextResponse.json({ error: 'Segmento no encontrado' }, { status: 404 });
  }
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = deleteSegment(id);
  if (!ok) {
    return NextResponse.json({ error: 'Segmento no encontrado' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
