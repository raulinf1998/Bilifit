'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  addMonthsLocal,
  buildMonthGrid,
  isNextDisabled,
  localDayKey,
  monthTitle,
  parseDayKey,
  RANGE_MODES,
  resolveRange,
  shiftAnchorKey,
  startOfMonthLocal,
  todayKey,
  type RangeMode,
  type ResolvedTimeRange,
} from '@/lib/time-range';

export interface CalendarDayStat {
  sessions: number;
  minutes: number;
}

interface TimeRangeSelectorProps {
  mode: RangeMode;
  anchorKey: string;
  range: ResolvedTimeRange;
  loadDayStats: (fromIso: string, toIso: string) => Promise<Record<string, CalendarDayStat>>;
  onModeChange: (mode: RangeMode) => void;
  onAnchorChange: (anchorKey: string) => void;
}

export function TimeRangeSelector({
  mode,
  anchorKey,
  range,
  loadDayStats,
  onModeChange,
  onAnchorChange,
}: TimeRangeSelectorProps) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarAnchor, setCalendarAnchor] = useState(() => parseDayKey(anchorKey) ?? new Date());
  const [dayStats, setDayStats] = useState<Record<string, CalendarDayStat>>({});
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!calendarOpen) return;
    let cancelled = false;
    const start = startOfMonthLocal(calendarAnchor);
    const end = addMonthsLocal(start, 1);
    loadDayStats(start.toISOString(), end.toISOString())
      .then((stats) => {
        if (!cancelled) setDayStats(stats);
      })
      .catch(() => {
        if (!cancelled) setDayStats({});
      });
    return () => {
      cancelled = true;
    };
  }, [calendarOpen, calendarAnchor, loadDayStats]);

  useEffect(() => {
    if (!calendarOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setCalendarOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCalendarOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [calendarOpen]);

  useEffect(() => {
    if (calendarOpen) {
      setCalendarAnchor(parseDayKey(anchorKey) ?? new Date());
    }
  }, [calendarOpen, anchorKey]);

  const grid = useMemo(() => buildMonthGrid(calendarAnchor), [calendarAnchor]);
  const maxDayMinutes = useMemo(
    () => Object.values(dayStats).reduce((max, stat) => Math.max(max, stat.minutes), 0),
    [dayStats]
  );
  const currentRange = resolveRange(mode, todayKey());
  const isCurrentPeriod = currentRange.selectedKey === range.selectedKey;

  return (
    <div className="card-surface p-3 sm:p-4 space-y-3" ref={wrapperRef}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Franja de tiempo"
          className="flex items-center gap-1 rounded-full border p-1 self-start"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-card-elevated)' }}
        >
          {RANGE_MODES.map((item) => {
            const active = mode === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                title={item.hint}
                onClick={() => onModeChange(item.id)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors ${
                  active ? 'bg-primary text-onprimary shadow-sm' : 'text-ink2 hover:bg-sunken'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {mode !== 'all' && (
            <>
              <button
                type="button"
                onClick={() => onAnchorChange(shiftAnchorKey(mode, anchorKey, -1))}
                className="h-9 w-9 rounded-xl border flex items-center justify-center hover:bg-sunken"
                style={{ borderColor: 'var(--border-subtle)' }}
                aria-label="Periodo anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onAnchorChange(shiftAnchorKey(mode, anchorKey, 1))}
                disabled={isNextDisabled(mode, anchorKey)}
                className="h-9 w-9 rounded-xl border flex items-center justify-center hover:bg-sunken disabled:opacity-40"
                style={{ borderColor: 'var(--border-subtle)' }}
                aria-label="Periodo siguiente"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setCalendarOpen((v) => !v)}
            aria-expanded={calendarOpen}
            className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors min-h-[36px] ${
              calendarOpen ? 'bg-primary/10 border-primary/40' : 'hover:bg-sunken'
            }`}
            style={!calendarOpen ? { borderColor: 'var(--border-subtle)' } : undefined}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            <span className="capitalize">{range.windowLabel}</span>
          </button>
          {mode !== 'all' && !isCurrentPeriod && (
            <button
              type="button"
              onClick={() => onAnchorChange(todayKey())}
              className="rounded-xl border px-3 py-1.5 text-xs font-semibold hover:bg-sunken min-h-[36px]"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              Hoy
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
        <span className="font-semibold capitalize" style={{ color: 'var(--text-secondary)' }}>
          {range.selectedLabel}
        </span>
        {mode !== 'all' && (
          <span style={{ color: 'var(--text-muted)' }}>
            · Ventana del gráfico: {range.windowLabel} · Pulsa una barra o un día del calendario para
            cambiar de franja
          </span>
        )}
        {mode === 'all' && (
          <span style={{ color: 'var(--text-muted)' }}>
            · Resumen mensual de los últimos 12 meses · Pulsa una barra para ir a ese mes
          </span>
        )}
      </div>

      {calendarOpen && (
        <div
          role="dialog"
          aria-label="Seleccionar día del calendario"
          className="rounded-2xl border p-3 sm:p-4 space-y-3 animate-fade-in"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-card-elevated)' }}
        >
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setCalendarAnchor((d) => addMonthsLocal(d, -1))}
              className="h-8 w-8 rounded-lg border flex items-center justify-center hover:bg-sunken"
              style={{ borderColor: 'var(--border-subtle)' }}
              aria-label="Mes anterior"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="text-sm font-bold capitalize">{monthTitle(calendarAnchor)}</div>
            <button
              type="button"
              onClick={() => setCalendarAnchor((d) => addMonthsLocal(d, 1))}
              className="h-8 w-8 rounded-lg border flex items-center justify-center hover:bg-sunken"
              style={{ borderColor: 'var(--border-subtle)' }}
              aria-label="Mes siguiente"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase" style={{ color: 'var(--text-muted)' }}>
            {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((initial, idx) => (
              <span key={`${initial}-${idx}`}>{initial}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {grid.flat().map((cell) => {
              const stat = dayStats[cell.key];
              const selected = mode === 'all' ? cell.isToday : cell.key === anchorKey;
              const heat =
                stat && maxDayMinutes > 0 ? Math.min(1, Math.max(0.12, stat.minutes / maxDayMinutes)) : 0;
              return (
                <button
                  key={cell.key}
                  type="button"
                  onClick={() => {
                    onAnchorChange(cell.key);
                    setCalendarOpen(false);
                  }}
                  title={
                    stat
                      ? `${stat.sessions} ${stat.sessions === 1 ? 'sesión' : 'sesiones'} · ${Math.round(stat.minutes)} min`
                      : 'Sin actividades'
                  }
                  className={`relative aspect-square rounded-xl text-xs font-semibold transition-colors ${
                    cell.inMonth ? '' : 'opacity-40'
                  } ${selected ? 'ring-2 ring-primary' : 'hover:bg-sunken'}`}
                  style={{
                    background: heat > 0 ? `rgb(var(--primary) / ${0.12 + heat * 0.55})` : undefined,
                    color: heat > 0.6 ? 'rgb(var(--on-primary))' : undefined,
                  }}
                >
                  {cell.day}
                  {stat && (
                    <span
                      className="absolute bottom-1 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full"
                      style={{ background: 'currentColor', opacity: 0.75 }}
                    />
                  )}
                  {cell.isToday && !selected && (
                    <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-accent" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            <span>
              {mode === 'day'
                ? 'El día elegido marca el resumen y el listado.'
                : mode === 'week'
                  ? 'Cualquier día marcado selecciona su semana.'
                  : mode === 'month'
                    ? 'Cualquier día marcado selecciona su mes.'
                    : 'El calendario resaltará el día elegido en la barra mensual.'}
            </span>
            <button
              type="button"
              onClick={() => {
                onAnchorChange(todayKey());
                setCalendarAnchor(new Date());
              }}
              className="rounded-lg border px-2.5 py-1 font-semibold hover:bg-sunken shrink-0"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              Ir a hoy ({localDayKey(new Date())})
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
