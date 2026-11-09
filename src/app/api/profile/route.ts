import { NextRequest, NextResponse } from 'next/server';
import { getAthleteProfile, updateAthleteProfile } from '@/lib/db';

export async function GET() {
  return NextResponse.json({ profile: getAthleteProfile() });
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const updated = updateAthleteProfile({
      name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : undefined,
      weightKg: typeof body.weightKg === 'number' && body.weightKg > 25 ? body.weightKg : undefined,
      ftpWatts: typeof body.ftpWatts === 'number' && body.ftpWatts > 50 ? Math.round(body.ftpWatts) : undefined,
      maxHr: typeof body.maxHr === 'number' && body.maxHr > 100 ? Math.round(body.maxHr) : undefined,
      restingHr: typeof body.restingHr === 'number' && body.restingHr > 25 ? Math.round(body.restingHr) : undefined,
      lthr: typeof body.lthr === 'number' && body.lthr > 80 ? Math.round(body.lthr) : undefined,
      weeklyTargetHours: typeof body.weeklyTargetHours === 'number' && body.weeklyTargetHours > 0 ? body.weeklyTargetHours : undefined,
      weeklyTargetKm: typeof body.weeklyTargetKm === 'number' && body.weeklyTargetKm >= 0 ? body.weeklyTargetKm : undefined,
    });
    return NextResponse.json({ profile: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error al actualizar el perfil' },
      { status: 400 }
    );
  }
}
