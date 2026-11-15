import type { GearItem, SportType } from '@/types';

/**
 * Deportes en los que tiene sentido repartir cada tipo de material. Es una pista para
 * premarcar el diálogo de «Aplicar a sesiones», no una restricción: se puede marcar
 * cualquier otro deporte de la lista.
 */
export const GEAR_CATEGORY_SPORTS: Record<GearItem['category'], SportType[]> = {
  running_shoes: ['running', 'walking'],
  trail_shoes: ['trail', 'mountain'],
  road_bike: ['cycling'],
  mtb_bike: ['cycling', 'trail'],
  indoor_trainer: ['mywhoosh'],
};

/** Deportes entre los que se puede elegir (los que registran distancia útil para km de material). */
export const GEAR_SPORT_OPTIONS: SportType[] = ['running', 'trail', 'mountain', 'walking', 'cycling', 'mywhoosh'];

/** Los que sugiere una ficha de material: su categoría más el deporte por defecto, si lo tiene. */
export function defaultGearSports(gear: Pick<GearItem, 'category' | 'defaultForSport'>): SportType[] {
  const base = GEAR_CATEGORY_SPORTS[gear.category] ?? [];
  const list = gear.defaultForSport ? [...new Set([...base, gear.defaultForSport])] : base;
  return list.filter((s) => GEAR_SPORT_OPTIONS.includes(s));
}

/** Fecha de `<input type="date">` -> límite ISO por el inicio del día (hora local). */
export function dayStartIso(date: string | null): string | null {
  if (!date) return null;
  const d = new Date(`${date}T00:00:00`);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** Fecha de `<input type="date">` -> límite ISO por el final del día (hora local). */
export function dayEndIso(date: string | null): string | null {
  if (!date) return null;
  const d = new Date(`${date}T23:59:59.999`);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function shiftMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  d.setMonth(d.getMonth() + months);
  return d;
}

function toDateInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export type GearRangePreset = { id: string; label: string; from: string | null; to: string | null };

/** Atajos de franja, pensados para «las sesiones de estas zapatillas en marzo». */
export function gearRangePresets(today = new Date()): GearRangePreset[] {
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const quarterStart = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1);
  return [
    { id: 'month', label: 'Este mes', from: toDateInputValue(monthStart), to: toDateInputValue(today) },
    {
      id: '30d',
      label: 'Últimos 30 días',
      from: toDateInputValue(new Date(today.getTime() - 29 * 864e5)),
      to: toDateInputValue(today),
    },
    { id: 'quarter', label: 'Este trimestre', from: toDateInputValue(quarterStart), to: toDateInputValue(today) },
    {
      id: '3m',
      label: 'Últimos 3 meses',
      from: toDateInputValue(shiftMonths(monthStart, -2)),
      to: toDateInputValue(today),
    },
    { id: 'all', label: 'Todo el historial', from: null, to: null },
  ];
}
