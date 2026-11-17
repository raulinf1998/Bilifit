export const MAX_ACTIVITY_DURATION_SEC = 7 * 24 * 60 * 60;
export type DurationFields = { hours: string; minutes: string; seconds: string };

export function splitActivityDuration(totalSeconds: number): DurationFields {
  const total = Math.max(0, Math.round(totalSeconds));
  return { hours: String(Math.floor(total / 3600)), minutes: String(Math.floor(total % 3600 / 60)), seconds: String(total % 60) };
}

/** Devuelve null cuando los campos no representan una duración entera válida. */
export function parseActivityDuration(fields: DurationFields): number | null {
  if (![fields.hours, fields.minutes, fields.seconds].every((value) => /^\d+$/.test(value))) return null;
  const hours = Number(fields.hours), minutes = Number(fields.minutes), seconds = Number(fields.seconds);
  const total = hours * 3600 + minutes * 60 + seconds;
  if (!Number.isSafeInteger(total) || minutes > 59 || seconds > 59 || total > MAX_ACTIVITY_DURATION_SEC) return null;
  return total;
}
