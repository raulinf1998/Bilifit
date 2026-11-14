'use client';

import { useMemo, useState } from 'react';
import {
  Activity as ActivityIcon,
  Flame,
  HeartPulse,
  Layers,
  MapPin,
  Timer,
} from 'lucide-react';
import { formatDistanceKm, sportColor, sportLabel } from '@/lib/metrics';
import {
  filterActivitiesByIsoRange,
  formatMetricValue,
  metricAxisHint,
  metricValueOf,
  RANGE_METRICS,
  statsForBuckets,
  summarizeActivities,
  type RangeMetric,
  type ResolvedTimeRange,
} from '@/lib/time-range';
import type { Activity, SportType } from '@/types';

interface RangeSummaryProps {
  range: ResolvedTimeRange;
  activities: Activity[];
  onPickBucket: (bucketKey: string) => void;
}

const SPORT_ORDER: SportType[] = ['running', 'trail', 'mywhoosh', 'cycling', 'mountain', 'walking', 'strength'];
const CHART_HEIGHT = 132;

export function RangeSummary({ range, activities, onPickBucket }: RangeSummaryProps) {
  const [metric, setMetric] = useState<RangeMetric>('time');

  const selectedActivities = useMemo(
    () => filterActivitiesByIsoRange(activities, range.selectedStart || null, range.selectedEnd || null),
    [activities, range.selectedStart, range.selectedEnd]
  );
  const selected = useMemo(() => summarizeActivities(selectedActivities), [selectedActivities]);
  const bucketStats = useMemo(() => statsForBuckets(activities, range.buckets), [activities, range.buckets]);

  const values = bucketStats.map((stat) => metricValueOf(stat, metric));
  const maxValue = Math.max(1, ...values);
  const withData = values.filter((value) => value > 0).length;
  const average = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const averageY = (Math.min(average, maxValue) / maxValue) * (CHART_HEIGHT - 18);

  const statCards = [
    { icon: ActivityIcon, label: 'Sesiones', value: String(selected.sessions) },
    {
      icon: MapPin,
      label: 'Distancia',
      value: selected.distanceMeters > 0 ? formatDistanceKm(selected.distanceMeters) : '—',
    },
    {
      icon: Flame,
      label: 'Calorías',
      value: selected.calories > 0 ? `${selected.calories} kcal` : '—',
    },
    { icon: HeartPulse, label: 'FC media', value: selected.avgHr ? `${selected.avgHr} ppm` : '—' },
    {
      icon: Layers,
      label: 'Desnivel +',
      value: selected.elevationGain > 0 ? `${selected.elevationGain} m` : '—',
    },
    { icon: Timer, label: 'Carga', value: `${Math.round(selected.tss)} TSS` },
  ];

  return (
    <div className="card-surface p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: 'var(--text-muted)' }}>
            {range.mode === 'all' ? 'Total del historial' : 'Total del periodo'}
          </div>
          <div className="text-4xl sm:text-5xl font-bold font-display tabular-nums leading-tight">
            {formatMetricValue('time', selected.durationSec)}
          </div>
          <div className="text-xs mt-1 capitalize" style={{ color: 'var(--text-secondary)' }}>
            {range.selectedLabel}
            {selected.volumeKg > 0 && ` · Volumen ${Math.round(selected.volumeKg)} kg`}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {SPORT_ORDER.filter((sport) => selected.bySport[sport] > 0).map((sport) => (
            <span
              key={sport}
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums"
              style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
              title={`${selected.bySport[sport]} × ${sportLabel(sport)}`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: sportColor(sport) }} />
              {sportLabel(sport)} {selected.bySport[sport]}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {statCards.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border px-3 py-2.5 flex items-center gap-2.5"
            style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-card-elevated)' }}
          >
            <stat.icon className="h-4 w-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                {stat.label}
              </div>
              <div className="text-sm font-bold tabular-nums truncate">{stat.value}</div>
            </div>
          </div>
        ))}
      </div>

      {range.buckets.length > 0 && (
        <div className="space-y-2 pt-3 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1">
              {RANGE_METRICS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setMetric(option.id)}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold border transition-colors ${
                    metric === option.id ? 'bg-primary text-onprimary border-primary' : 'text-ink2 hover:bg-sunken'
                  }`}
                  style={metric !== option.id ? { borderColor: 'var(--border-subtle)' } : undefined}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
              {metricAxisHint(metric)} máx {formatMetricValue(metric, maxValue, { compact: true })} · media{' '}
              {formatMetricValue(metric, average, { compact: true })}
              {withData !== range.buckets.length && ` · ${withData}/${range.buckets.length} con datos`}
            </div>
          </div>

          <div className="relative flex gap-1 sm:gap-1.5" style={{ height: CHART_HEIGHT }}>
            <div
              className="absolute left-0 right-0 z-10 border-t border-dashed pointer-events-none"
              style={{ bottom: 18 + averageY, borderColor: 'rgb(var(--ink-3))', opacity: 0.5 }}
              aria-hidden
            >
              <span
                className="absolute right-0 -top-2 rounded px-1 text-[9px] font-semibold"
                style={{ background: 'rgb(var(--surface))', color: 'var(--text-muted)' }}
              >
                Media
              </span>
            </div>

            {bucketStats.map((stat) => {
              const value = metricValueOf(stat, metric);
              const barHeight = value > 0 ? Math.max(6, (value / maxValue) * (CHART_HEIGHT - 18)) : 2;
              const isSelected = stat.bucket.key === range.selectedKey;
              const dimmed = range.selectedKey !== 'all' && !isSelected;
              return (
                <button
                  key={stat.bucket.key}
                  type="button"
                  onClick={() => onPickBucket(stat.bucket.key)}
                  title={`${stat.bucket.label} · ${formatMetricValue(metric, value, { compact: true })} · ${
                    stat.sessions
                  } ${stat.sessions === 1 ? 'sesión' : 'sesiones'}`}
                  className="group relative flex-1 min-w-0 h-full flex flex-col items-center justify-end gap-1 rounded-lg hover:bg-sunken/60 transition-colors"
                >
                  <span
                    className="text-[9px] tabular-nums opacity-0 group-hover:opacity-100 transition-opacity truncate max-w-full px-0.5"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {value > 0 ? formatMetricValue(metric, value, { compact: true }) : ''}
                  </span>
                  <span
                    className="w-full rounded-t-md transition-all"
                    style={{
                      height: barHeight,
                      background: dimmed ? 'rgb(var(--primary) / 0.3)' : 'rgb(var(--primary))',
                    }}
                  />
                  <span
                    className={`text-[10px] tabular-nums leading-none pb-1 ${isSelected ? 'font-bold' : ''}`}
                    style={{ color: isSelected ? 'var(--text-primary)' : 'var(--text-muted)' }}
                  >
                    {stat.bucket.label}
                    {stat.bucket.caption ? ` ${stat.bucket.caption}` : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
