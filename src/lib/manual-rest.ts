import type { ActivityLap } from '@/types';

/** La identidad incluye datos estables del segmento para no aplicar una selección a otro al reimportar. */
export function restLapKey(lap: ActivityLap, index: number): string {
  return JSON.stringify([index, lap.lapNumber, lap.startDistM, lap.endDistM, lap.distanceMeters, lap.durationSec]);
}

export function resolveManualRests(laps: ActivityLap[] | undefined, storedKeys: unknown): { keys: string[]; durationSec: number; distanceMeters: number } {
  const wanted = new Set(Array.isArray(storedKeys) ? storedKeys.filter((k): k is string => typeof k === 'string') : []);
  const keys: string[] = [];
  let durationSec = 0;
  let distanceMeters = 0;
  (laps ?? []).forEach((lap, index) => {
    const key = restLapKey(lap, index);
    if (wanted.has(key) && Number.isFinite(lap.durationSec) && lap.durationSec > 0 && Number.isFinite(lap.distanceMeters) && lap.distanceMeters >= 0) {
      keys.push(key);
      durationSec += lap.durationSec;
      distanceMeters += lap.distanceMeters;
    }
  });
  return { keys, durationSec, distanceMeters };
}
