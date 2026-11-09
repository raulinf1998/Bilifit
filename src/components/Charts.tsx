'use client';

import { useState } from 'react';
import { formatDurationClock } from '@/lib/metrics';
import type { ActivityPoint, FitnessDayPoint } from '@/types';
import type { PowerZoneSummary } from '@/lib/metrics';

export function FitnessPMCChart({ data }: { data: FitnessDayPoint[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  if (!data || data.length === 0) return null;

  const w = 720;
  const h = 230;
  const padL = 36;
  const padR = 16;
  const padT = 18;
  const padB = 28;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const maxVal = Math.max(
    40,
    ...data.map((d) => Math.max(d.ctl, d.atl, d.tss * 0.55))
  );
  const minVal = Math.min(-25, ...data.map((d) => d.tsb));
  const range = maxVal - minVal || 1;

  const toX = (idx: number) => padL + (idx / Math.max(1, data.length - 1)) * innerW;
  const toY = (val: number) => padT + ((maxVal - val) / range) * innerH;
  const zeroY = toY(0);

  const ctlPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(d.ctl).toFixed(1)}`).join(' ');
  const atlPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(d.atl).toFixed(1)}`).join(' ');
  const tsbPath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(d.tsb).toFixed(1)}`).join(' ');

  const hovered = hoverIdx !== null ? data[hoverIdx] : data[data.length - 1];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-cyan-400" />
            <span style={{ color: 'var(--text-secondary)' }}>Forma Física (CTL):</span>
            <strong className="tabular-nums text-cyan-400">{hovered.ctl}</strong>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
            <span style={{ color: 'var(--text-secondary)' }}>Fatiga (ATL):</span>
            <strong className="tabular-nums text-amber-400">{hovered.atl}</strong>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
            <span style={{ color: 'var(--text-secondary)' }}>Frescura (TSB):</span>
            <strong className={`tabular-nums ${hovered.tsb >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {hovered.tsb > 0 ? `+${hovered.tsb}` : hovered.tsb}
            </strong>
          </span>
        </div>
        <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>
          {hovered.date} {hovered.tss > 0 ? `· Carga día: ${hovered.tss} TSS` : ''}
        </span>
      </div>

      <div className="relative w-full overflow-hidden">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          className="w-full h-56 select-none"
          onMouseLeave={() => setHoverIdx(null)}
        >
          {/* Grid lines */}
          {[0, 25, 50, 75].map((val) => {
            if (val > maxVal) return null;
            const y = toY(val);
            return (
              <g key={val}>
                <line x1={padL} y1={y} x2={w - padR} y2={y} stroke="rgba(148,163,184,0.12)" strokeDasharray="3 3" />
                <text x={4} y={y + 3} fontSize="10" fill="#64748b">
                  {val}
                </text>
              </g>
            );
          })}
          <line x1={padL} y1={zeroY} x2={w - padR} y2={zeroY} stroke="rgba(148,163,184,0.28)" />

          {/* Daily TSS bars */}
          {data.map((d, i) => {
            if (d.tss <= 0) return null;
            const barH = Math.max(2, zeroY - toY(Math.min(maxVal, d.tss * 0.55)));
            return (
              <rect
                key={d.date}
                x={toX(i) - 2}
                y={zeroY - barH}
                width={4}
                height={barH}
                rx={1.5}
                fill="rgba(252, 76, 2, 0.35)"
              />
            );
          })}

          <path d={tsbPath} fill="none" stroke="#10b981" strokeWidth={1.6} strokeOpacity={0.85} />
          <path d={atlPath} fill="none" stroke="#f59e0b" strokeWidth={2} />
          <path d={ctlPath} fill="none" stroke="#06b6d4" strokeWidth={2.6} />

          {hoverIdx !== null && (
            <g>
              <line
                x1={toX(hoverIdx)}
                y1={padT}
                x2={toX(hoverIdx)}
                y2={h - padB}
                stroke="rgba(248,250,252,0.3)"
                strokeDasharray="2 2"
              />
              <circle cx={toX(hoverIdx)} cy={toY(hovered.ctl)} r={4} fill="#06b6d4" />
              <circle cx={toX(hoverIdx)} cy={toY(hovered.atl)} r={3.5} fill="#f59e0b" />
            </g>
          )}

          {/* X-axis dates */}
          {[0, Math.floor(data.length / 3), Math.floor((data.length * 2) / 3), data.length - 1].map((idx) => (
            <text
              key={idx}
              x={toX(idx)}
              y={h - 6}
              fontSize="10"
              textAnchor="middle"
              fill="#64748b"
            >
              {data[idx]?.date.slice(5)}
            </text>
          ))}

          {/* Invisible hit columns */}
          {data.map((d, i) => {
            const colW = innerW / data.length;
            return (
              <rect
                key={d.date}
                x={toX(i) - colW / 2}
                y={0}
                width={Math.max(4, colW)}
                height={h}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)}
              />
            );
          })}
        </svg>
      </div>
    </div>
  );
}

export interface WeeklyBucket {
  label: string;
  runningHours: number;
  mywhooshHours: number;
  cyclingHours: number;
  mountainHours: number;
  strengthHours: number;
  totalKm: number;
  totalTss: number;
}

export function WeeklyVolumeChart({ buckets }: { buckets: WeeklyBucket[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  if (!buckets || buckets.length === 0) return null;

  const totals = buckets.map(
    (b) => b.runningHours + b.mywhooshHours + b.cyclingHours + b.mountainHours + b.strengthHours
  );
  const maxHours = Math.max(4, ...totals);
  const hovered = hoverIdx !== null ? buckets[hoverIdx] : buckets[buckets.length - 1];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-[#fc4c02]" /> Correr
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-cyan-400" /> MyWhoosh
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-emerald-400" /> Montaña
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-purple-400" /> Casa
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-blue-400" /> Bici Ext.
          </span>
        </div>
        <span className="tabular-nums font-medium" style={{ color: 'var(--text-secondary)' }}>
          Sem {hovered.label}: {(hovered.runningHours + hovered.mywhooshHours + hovered.cyclingHours + hovered.mountainHours + hovered.strengthHours).toFixed(1)}h · {hovered.totalKm} km · {hovered.totalTss} TSS
        </span>
      </div>

      <div className="grid grid-cols-8 gap-2 sm:gap-3 items-end h-44 pt-4">
        {buckets.map((b, i) => {
          const sum = b.runningHours + b.mywhooshHours + b.cyclingHours + b.mountainHours + b.strengthHours;
          const pct = (val: number) => `${Math.max(0, (val / maxHours) * 100)}%`;
          return (
            <div
              key={b.label}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              className="flex flex-col items-center h-full justify-end group cursor-pointer"
            >
              <div className="text-[10px] tabular-nums mb-1 opacity-75 group-hover:opacity-100" style={{ color: 'var(--text-secondary)' }}>
                {sum > 0 ? `${sum.toFixed(1)}h` : ''}
              </div>
              <div
                className="w-full max-w-[38px] flex flex-col-reverse rounded-t-md overflow-hidden transition-transform group-hover:scale-105"
                style={{ height: '130px', background: 'rgba(148,163,184,0.08)' }}
              >
                {b.runningHours > 0 && <div style={{ height: pct(b.runningHours), background: '#fc4c02' }} />}
                {b.mywhooshHours > 0 && <div style={{ height: pct(b.mywhooshHours), background: '#06b6d4' }} />}
                {b.cyclingHours > 0 && <div style={{ height: pct(b.cyclingHours), background: '#3b82f6' }} />}
                {b.mountainHours > 0 && <div style={{ height: pct(b.mountainHours), background: '#10b981' }} />}
                {b.strengthHours > 0 && <div style={{ height: pct(b.strengthHours), background: '#a855f7' }} />}
              </div>
              <span className="text-[10px] mt-1.5 tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {b.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TelemetryChart({
  points,
  onHoverPoint,
}: {
  points: ActivityPoint[];
  onHoverPoint?: (pt: ActivityPoint | null) => void;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  if (!points || points.length < 3) return null;

  const hasEle = points.some((p) => typeof p.ele === 'number');
  const hasWatts = points.some((p) => typeof p.watts === 'number');
  const hasHr = points.some((p) => typeof p.hr === 'number');

  const w = 780;
  const h = 220;
  const padL = 42;
  const padR = 16;
  const padT = 16;
  const padB = 26;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const minEle = hasEle ? Math.min(...points.map((p) => p.ele ?? 0)) : 0;
  const maxEle = hasEle ? Math.max(...points.map((p) => p.ele ?? 0)) : 100;
  const eleRange = Math.max(10, maxEle - minEle);

  const maxWatts = hasWatts ? Math.max(150, ...points.map((p) => p.watts ?? 0)) : 300;
  const minHr = hasHr ? Math.min(90, ...points.filter((p) => p.hr).map((p) => p.hr!)) : 90;
  const maxHr = hasHr ? Math.max(170, ...points.filter((p) => p.hr).map((p) => p.hr!)) : 195;

  const toX = (idx: number) => padL + (idx / (points.length - 1)) * innerW;
  const eleY = (e: number) => padT + ((maxEle - e) / eleRange) * innerH;
  const wattsY = (wt: number) => padT + ((maxWatts - wt) / maxWatts) * innerH;
  const hrY = (hr: number) => padT + ((maxHr - hr) / Math.max(20, maxHr - minHr)) * innerH;

  const eleLine = hasEle
    ? points
        .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${eleY(p.ele ?? minEle).toFixed(1)}`)
        .join(' ')
    : '';
  const eleArea = hasEle
    ? `${eleLine} L ${toX(points.length - 1).toFixed(1)} ${padT + innerH} L ${padL} ${padT + innerH} Z`
    : '';

  const wattsLine = hasWatts
    ? points
        .filter((p) => typeof p.watts === 'number')
        .map((p, i) => {
          const origIdx = points.indexOf(p);
          return `${i === 0 ? 'M' : 'L'} ${toX(origIdx).toFixed(1)} ${wattsY(p.watts!).toFixed(1)}`;
        })
        .join(' ')
    : '';

  const hrLine = hasHr
    ? points
        .filter((p) => typeof p.hr === 'number')
        .map((p, i) => {
          const origIdx = points.indexOf(p);
          return `${i === 0 ? 'M' : 'L'} ${toX(origIdx).toFixed(1)} ${hrY(p.hr!).toFixed(1)}`;
        })
        .join(' ')
    : '';

  const hovered = hoverIdx !== null ? points[hoverIdx] : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-4">
          {hasEle && (
            <span className="flex items-center gap-1.5 text-emerald-400">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              Altitud {hovered?.ele !== undefined ? `${hovered.ele} m` : `${Math.round(minEle)}-${Math.round(maxEle)} m`}
            </span>
          )}
          {hasWatts && (
            <span className="flex items-center gap-1.5 text-cyan-400">
              <span className="h-2.5 w-2.5 rounded-full bg-cyan-400" />
              Potencia {hovered?.watts !== undefined ? `${hovered.watts} W` : ''}
            </span>
          )}
          {hasHr && (
            <span className="flex items-center gap-1.5 text-rose-400">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
              Pulso {hovered?.hr !== undefined ? `${hovered.hr} ppm` : ''}
            </span>
          )}
        </div>
        {hovered && (
          <span className="tabular-nums font-medium" style={{ color: 'var(--text-secondary)' }}>
            Tiempo {formatDurationClock(hovered.t)}
            {hovered.dist ? ` · ${(hovered.dist / 1000).toFixed(2)} km` : ''}
            {hovered.cad ? ` · ${hovered.cad} rpm/spm` : ''}
          </span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full h-56 select-none cursor-crosshair"
        onMouseLeave={() => {
          setHoverIdx(null);
          onHoverPoint?.(null);
        }}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const relX = ((e.clientX - rect.left) / rect.width) * w;
          const pct = Math.min(1, Math.max(0, (relX - padL) / innerW));
          const idx = Math.min(points.length - 1, Math.round(pct * (points.length - 1)));
          setHoverIdx(idx);
          onHoverPoint?.(points[idx]);
        }}
      >
        <line x1={padL} y1={padT} x2={w - padR} y2={padT} stroke="rgba(148,163,184,0.12)" />
        <line x1={padL} y1={padT + innerH / 2} x2={w - padR} y2={padT + innerH / 2} stroke="rgba(148,163,184,0.12)" />
        <line x1={padL} y1={padT + innerH} x2={w - padR} y2={padT + innerH} stroke="rgba(148,163,184,0.22)" />

        {hasEle && (
          <>
            <path d={eleArea} fill="rgba(16, 185, 129, 0.14)" />
            <path d={eleLine} fill="none" stroke="#10b981" strokeWidth={1.8} />
            <text x={4} y={padT + 8} fontSize="10" fill="#10b981">
              {Math.round(maxEle)}m
            </text>
            <text x={4} y={padT + innerH} fontSize="10" fill="#64748b">
              {Math.round(minEle)}m
            </text>
          </>
        )}

        {hasWatts && <path d={wattsLine} fill="none" stroke="#06b6d4" strokeWidth={1.9} />}
        {hasHr && <path d={hrLine} fill="none" stroke="#f43f5e" strokeWidth={1.7} strokeOpacity={0.85} />}

        {hoverIdx !== null && (
          <line
            x1={toX(hoverIdx)}
            y1={padT}
            x2={toX(hoverIdx)}
            y2={padT + innerH}
            stroke="rgba(248,250,252,0.45)"
            strokeDasharray="3 3"
          />
        )}

        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const idx = Math.round(f * (points.length - 1));
          return (
            <text key={f} x={toX(idx)} y={h - 6} fontSize="10" textAnchor="middle" fill="#64748b">
              {formatDurationClock(points[idx]?.t ?? 0)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

export function PowerZonesChart({ zones }: { zones: PowerZoneSummary[] }) {
  const totalSec = zones.reduce((s, z) => s + z.seconds, 0) || 1;
  return (
    <div className="space-y-2.5">
      {zones.map((z) => {
        const pct = Math.round((z.seconds / totalSec) * 100);
        return (
          <div key={z.zone} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="font-bold w-6" style={{ color: z.color }}>
                  {z.zone}
                </span>
                <span>{z.name}</span>
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  ({z.range})
                </span>
              </div>
              <span className="tabular-nums font-medium">
                {Math.round(z.seconds / 60)}m ({pct}%)
              </span>
            </div>
            <div className="h-2 w-full rounded-full overflow-hidden" style={{ background: 'var(--bg-muted)' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: z.color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
