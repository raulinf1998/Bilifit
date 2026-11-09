import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createActivity, getAthleteProfile, listActivities } from '@/lib/db';
import { estimateActivityTSS } from '@/lib/metrics';
import type { SportType } from '@/types';

export async function GET(req: NextRequest) {
  const sport = req.nextUrl.searchParams.get('sport') ?? undefined;
  const q = req.nextUrl.searchParams.get('q') ?? undefined;
  const limitStr = req.nextUrl.searchParams.get('limit');
  const limit = limitStr ? Number(limitStr) : undefined;

  const activities = listActivities({ sport, q, limit: limit && Number.isFinite(limit) ? limit : undefined });
  return NextResponse.json({ activities });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sport = (body.sport || 'running') as SportType;
    const title = String(body.title || '').trim();
    if (!title) {
      return NextResponse.json({ error: 'El título es obligatorio' }, { status: 400 });
    }

    const profile = getAthleteProfile();
    const durationSec = Math.max(60, Math.round(Number(body.durationMin || 45) * 60));
    const distanceMeters = Math.max(0, Math.round(Number(body.distanceKm || 0) * 1000));
    const elevationGain = Math.max(0, Math.round(Number(body.elevationGain || 0)));
    const avgHr = body.avgHr ? Math.round(Number(body.avgHr)) : null;
    const avgWatts = body.avgWatts ? Math.round(Number(body.avgWatts)) : null;
    const rpe = body.rpe ? Number(body.rpe) : 6;
    const startedAt = body.startedAt ? new Date(body.startedAt).toISOString() : new Date().toISOString();

    const tss = estimateActivityTSS(
      {
        sport,
        durationSec,
        movingTimeSec: durationSec,
        avgWatts,
        normalizedPower: avgWatts,
        avgHr,
        rpe,
        elevationGain,
      },
      profile
    );

    const avgSpeedMs = distanceMeters > 0 && durationSec > 0 ? Math.round((distanceMeters / durationSec) * 100) / 100 : null;

    const activity = createActivity({
      id: `act_${crypto.randomUUID().slice(0, 12)}`,
      externalId: null,
      source: 'manual',
      sport,
      subSport: body.subSport ? String(body.subSport) : null,
      title,
      description: body.description ? String(body.description) : null,
      startedAt,
      durationSec,
      movingTimeSec: durationSec,
      distanceMeters,
      elevationGain,
      elevationLoss: Math.max(0, Math.round(Number(body.elevationLoss || elevationGain))),
      avgSpeedMs,
      maxSpeedMs: avgSpeedMs ? Math.round(avgSpeedMs * 1.25 * 100) / 100 : null,
      avgHr,
      maxHr: avgHr ? Math.min(profile.maxHr, avgHr + 18) : null,
      avgWatts,
      normalizedPower: avgWatts,
      maxWatts: avgWatts ? Math.round(avgWatts * 1.4) : null,
      avgCadence: body.avgCadence ? Math.round(Number(body.avgCadence)) : null,
      calories: Math.round((durationSec / 60) * (sport === 'strength' ? 6.5 : 10)),
      tss,
      rpe,
      gearId: body.gearId || null,
      worldName: body.worldName || null,
      polyline: null,
      startLat: null,
      startLon: null,
      points: [],
      strengthLogs: Array.isArray(body.strengthLogs) ? body.strengthLogs : [],
      totalVolumeKg: body.totalVolumeKg ? Number(body.totalVolumeKg) : null,
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({ activity }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'No se pudo crear la actividad' },
      { status: 400 }
    );
  }
}
