import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import { createMountainRoute, listMountainRoutes } from '@/lib/db';
import { parseUploadedActivityFile } from '@/lib/parsers';
import { computeElevationGainLoss } from '@/lib/polyline';
import type { MountainRoute } from '@/types';

export async function GET(req: NextRequest) {
  return withAccount(req, () => NextResponse.json({ routes: listMountainRoutes() }));
}

export async function POST(req: NextRequest) {
  return withAccount(req, async () => {
    try {
      const contentType = req.headers.get('content-type') || '';
      if (contentType.includes('multipart/form-data')) {
        const formData = await req.formData();
        const file = formData.get('file') as File | null;
        if (!file) {
          return NextResponse.json({ error: 'Adjunta un archivo GPX o FIT de la ruta.' }, { status: 400 });
        }
        const region = String(formData.get('region') || 'Montaña');
        const difficulty = (formData.get('difficulty') || 'Moderada') as MountainRoute['difficulty'];
        const customName = String(formData.get('name') || '').trim();
        const notes = formData.get('notes') ? String(formData.get('notes')) : null;

        const buf = Buffer.from(await file.arrayBuffer());
        const parsed = await parseUploadedActivityFile(file.name, buf);
        const act = parsed.activities[0];
        if (!act) {
          return NextResponse.json({ error: parsed.errors[0] || 'No se pudo leer el track GPS.' }, { status: 400 });
        }

        const ele = computeElevationGainLoss(act.points);
        const route = createMountainRoute({
          id: `route_${crypto.randomUUID().slice(0, 10)}`,
          name: customName || act.title,
          region,
          difficulty,
          sport: act.sport === 'cycling' ? 'cycling' : 'mountain',
          distanceMeters: act.distanceMeters,
          elevationGain: act.elevationGain || ele.gain,
          elevationLoss: act.elevationLoss || ele.loss,
          maxEle: ele.maxEle,
          minEle: ele.minEle,
          estimatedTimeSec: act.durationSec > 60 ? act.durationSec : Math.round((act.distanceMeters / 1000) * 1000 + ele.gain * 4),
          status: 'pending',
          notes,
          polyline: act.polyline ?? null,
          points: act.points,
          createdAt: new Date().toISOString(),
        });

        return NextResponse.json({ route }, { status: 201 });
      }

      const body = await req.json();
      const name = String(body.name || '').trim();
      if (!name) return NextResponse.json({ error: 'El nombre es obligatorio' }, { status: 400 });

      const route = createMountainRoute({
        id: `route_${crypto.randomUUID().slice(0, 10)}`,
        name,
        region: String(body.region || 'Montaña'),
        difficulty: (body.difficulty || 'Moderada') as MountainRoute['difficulty'],
        sport: body.sport === 'cycling' ? 'cycling' : 'mountain',
        distanceMeters: Math.round(Number(body.distanceKm || 10) * 1000),
        elevationGain: Math.round(Number(body.elevationGain || 500)),
        elevationLoss: Math.round(Number(body.elevationLoss || body.elevationGain || 500)),
        maxEle: Math.round(Number(body.maxEle || 1200)),
        minEle: Math.round(Number(body.minEle || 400)),
        estimatedTimeSec: Math.round(Number(body.estimatedMinutes || 180) * 60),
        status: 'pending',
        notes: body.notes ? String(body.notes) : null,
        polyline: null,
        points: [],
        createdAt: new Date().toISOString(),
      });
      return NextResponse.json({ route }, { status: 201 });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Error al guardar ruta' }, { status: 400 });
    }
  });
}
