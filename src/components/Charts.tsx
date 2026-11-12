'use client';

import { useState } from 'react';
import { formatDurationClock, formatPaceMinKm, formatSpeedKmh } from '@/lib/metrics';
import type { ActivityPoint, FitnessDayPoint, SportType, ZoneBucket } from '@/types';
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
  trailHours?: number;
  mywhooshHours: number;
  cyclingHours: number;
  mountainHours: number;
  walkingHours?: number;
  strengthHours: number;
  totalKm: number;
  totalTss: number;
}

export function WeeklyVolumeChart({ buckets }: { buckets: WeeklyBucket[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  if (!buckets || buckets.length === 0) return null;

  const bucketTotal = (b: WeeklyBucket) =>
    b.runningHours +
    (b.trailHours ?? 0) +
    b.mywhooshHours +
    b.cyclingHours +
    b.mountainHours +
    (b.walkingHours ?? 0) +
    b.strengthHours;

  const totals = buckets.map(bucketTotal);
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
            <span className="h-2.5 w-2.5 rounded-sm bg-lime-400" /> Trail
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-emerald-400" /> Senderismo
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-cyan-400" /> MyWhoosh
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-amber-400" /> Caminar
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-purple-400" /> Casa
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-blue-400" /> Bici Ext.
          </span>
        </div>
        <span className="tabular-nums font-medium" style={{ color: 'var(--text-secondary)' }}>
          Sem {hovered.label}: {bucketTotal(hovered).toFixed(1)}h · {hovered.totalKm} km · {hovered.totalTss} TSS
        </span>
      </div>

      <div className="grid grid-cols-8 gap-2 sm:gap-3 items-end h-44 pt-4">
        {buckets.map((b, i) => {
          const sum = bucketTotal(b);
          const trailH = b.trailHours ?? 0;
          const walkingH = b.walkingHours ?? 0;
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
                {trailH > 0 && <div style={{ height: pct(trailH), background: '#84cc16' }} />}
                {b.mywhooshHours > 0 && <div style={{ height: pct(b.mywhooshHours), background: '#06b6d4' }} />}
                {b.cyclingHours > 0 && <div style={{ height: pct(b.cyclingHours), background: '#3b82f6' }} />}
                {b.mountainHours > 0 && <div style={{ height: pct(b.mountainHours), background: '#10b981' }} />}
                {walkingH > 0 && <div style={{ height: pct(walkingH), background: '#f59e0b' }} />}
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
  sport = 'running',
  onHoverPoint,
}: {
  points: ActivityPoint[];
  sport?: SportType;
  onHoverPoint?: (pt: ActivityPoint | null) => void;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [xAxisMode, setXAxisMode] = useState<'time' | 'dist'>('dist');
  const [showEle, setShowEle] = useState(true);
  const [showPace, setShowPace] = useState(true);
  const [showHr, setShowHr] = useState(true);
  const [showWatts, setShowWatts] = useState(true);
  const [showCad, setShowCad] = useState(false);

  if (!points || points.length < 3) return null;

  const isPaceSport =
    sport === 'running' || sport === 'trail' || sport === 'mountain' || sport === 'walking';
  const hasEle = points.some((p) => typeof p.ele === 'number');
  const hasSpeed = points.some((p) => typeof p.speed === 'number' && p.speed > 0.3);
  const hasWatts = points.some((p) => typeof p.watts === 'number');
  const hasHr = points.some((p) => typeof p.hr === 'number');
  const hasCad = points.some((p) => typeof p.cad === 'number' && p.cad > 0);
  const hasDist = (points[points.length - 1]?.dist ?? 0) > 100;

  const w = 780;
  const h = 250;
  const padL = 44;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const minEle = hasEle ? Math.min(...points.map((p) => p.ele ?? 0)) : 0;
  const maxEle = hasEle ? Math.max(...points.map((p) => p.ele ?? 0)) : 100;
  const eleRange = Math.max(10, maxEle - minEle);

  const speeds = points.map((p) => p.speed ?? 0).filter((s) => s > 0.3 && s < 30);
  const minSpd = speeds.length > 0 ? Math.min(...speeds) : 1;
  const maxSpd = speeds.length > 0 ? Math.max(minSpd + 0.5, ...speeds) : 10;

  const maxWatts = hasWatts ? Math.max(150, ...points.map((p) => p.watts ?? 0)) : 300;
  const minHr = hasHr ? Math.min(90, ...points.filter((p) => p.hr).map((p) => p.hr!)) : 90;
  const maxHr = hasHr ? Math.max(170, ...points.filter((p) => p.hr).map((p) => p.hr!)) : 195;
  const minCad = hasCad ? Math.min(...points.filter((p) => p.cad).map((p) => p.cad!)) : 40;
  const maxCad = hasCad ? Math.max(minCad + 20, ...points.filter((p) => p.cad).map((p) => p.cad!)) : 200;

  const maxDist = Math.max(1, points[points.length - 1]?.dist ?? 1);
  const maxTime = Math.max(1, points[points.length - 1]?.t ?? 1);
  const toX = (idx: number) => {
    if (xAxisMode === 'dist' && hasDist) {
      return padL + ((points[idx]?.dist ?? 0) / maxDist) * innerW;
    }
    return padL + ((points[idx]?.t ?? 0) / maxTime) * innerW;
  };

  const eleY = (e: number) => padT + ((maxEle - e) / eleRange) * innerH;
  const spdY = (s: number) => padT + ((maxSpd - s) / Math.max(0.5, maxSpd - minSpd)) * innerH;
  const wattsY = (wt: number) => padT + ((maxWatts - wt) / maxWatts) * innerH;
  const hrY = (hr: number) => padT + ((maxHr - hr) / Math.max(20, maxHr - minHr)) * innerH;
  const cadY = (c: number) => padT + ((maxCad - c) / Math.max(20, maxCad - minCad)) * innerH;

  const buildPath = (filterFn: (p: ActivityPoint) => boolean, yFn: (p: ActivityPoint) => number) => {
    let d = '';
    let started = false;
    for (let i = 0; i < points.length; i++) {
      if (!filterFn(points[i])) continue;
      d += `${started ? 'L' : 'M'} ${toX(i).toFixed(1)} ${yFn(points[i]).toFixed(1)} `;
      started = true;
    }
    return d.trim();
  };

  const eleLine = hasEle ? buildPath((p) => typeof p.ele === 'number', (p) => eleY(p.ele!)) : '';
  const eleArea = hasEle && eleLine
    ? `${eleLine} L ${toX(points.length - 1).toFixed(1)} ${padT + innerH} L ${padL} ${padT + innerH} Z`
    : '';
  const speedLine = hasSpeed ? buildPath((p) => typeof p.speed === 'number' && p.speed > 0.3, (p) => spdY(p.speed!)) : '';
  const wattsLine = hasWatts ? buildPath((p) => typeof p.watts === 'number', (p) => wattsY(p.watts!)) : '';
  const hrLine = hasHr ? buildPath((p) => typeof p.hr === 'number', (p) => hrY(p.hr!)) : '';
  const cadLine = hasCad ? buildPath((p) => typeof p.cad === 'number' && p.cad > 0, (p) => cadY(p.cad!)) : '';

  const hovered = hoverIdx !== null ? points[hoverIdx] : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          {hasEle && (
            <button
              type="button"
              onClick={() => setShowEle((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-opacity ${
                showEle ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' : 'opacity-45 border-slate-700'
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Altitud {hovered?.ele !== undefined ? `${hovered.ele} m` : `${Math.round(minEle)}-${Math.round(maxEle)}m`}
            </button>
          )}
          {hasSpeed && (
            <button
              type="button"
              onClick={() => setShowPace((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-opacity ${
                showPace ? 'border-[#fc4c02]/40 bg-[#fc4c02]/10 text-[#fc4c02]' : 'opacity-45 border-slate-700'
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-[#fc4c02]" />
              {isPaceSport ? 'Ritmo' : 'Vel.'}{' '}
              {hovered?.speed !== undefined
                ? isPaceSport
                  ? formatPaceMinKm(hovered.speed)
                  : formatSpeedKmh(hovered.speed)
                : ''}
            </button>
          )}
          {hasHr && (
            <button
              type="button"
              onClick={() => setShowHr((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-opacity ${
                showHr ? 'border-rose-500/40 bg-rose-500/10 text-rose-400' : 'opacity-45 border-slate-700'
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-rose-400" />
              Pulso {hovered?.hr !== undefined ? `${hovered.hr} ppm` : ''}
            </button>
          )}
          {hasWatts && (
            <button
              type="button"
              onClick={() => setShowWatts((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-opacity ${
                showWatts ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-400' : 'opacity-45 border-slate-700'
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-cyan-400" />
              Potencia {hovered?.watts !== undefined ? `${hovered.watts} W` : ''}
            </button>
          )}
          {hasCad && (
            <button
              type="button"
              onClick={() => setShowCad((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-opacity ${
                showCad ? 'border-purple-500/40 bg-purple-500/10 text-purple-400' : 'opacity-45 border-slate-700'
              }`}
            >
              <span className="h-2 w-2 rounded-full bg-purple-400" />
              Cadencia {hovered?.cad !== undefined ? `${hovered.cad}` : ''}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {hasDist && (
            <div className="inline-flex rounded-lg border overflow-hidden text-[11px]" style={{ borderColor: 'var(--border-subtle)' }}>
              <button
                type="button"
                onClick={() => setXAxisMode('dist')}
                className={`px-2 py-0.5 ${xAxisMode === 'dist' ? 'bg-[#fc4c02] text-white' : ''}`}
              >
                Km
              </button>
              <button
                type="button"
                onClick={() => setXAxisMode('time')}
                className={`px-2 py-0.5 ${xAxisMode === 'time' ? 'bg-[#fc4c02] text-white' : ''}`}
              >
                Tiempo
              </button>
            </div>
          )}
        </div>
      </div>

      {hovered && (
        <div
          className="rounded-lg px-3 py-1.5 text-xs tabular-nums flex flex-wrap gap-x-4 gap-y-1 border"
          style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
        >
          <span><strong>Tiempo:</strong> {formatDurationClock(hovered.t)}</span>
          {typeof hovered.dist === 'number' && <span><strong>Dist:</strong> {(hovered.dist / 1000).toFixed(2)} km</span>}
          {typeof hovered.speed === 'number' && hovered.speed > 0.3 && (
            <span className="text-[#fc4c02]">
              <strong>{isPaceSport ? 'Ritmo:' : 'Vel:'}</strong>{' '}
              {isPaceSport ? formatPaceMinKm(hovered.speed) : formatSpeedKmh(hovered.speed)}
            </span>
          )}
          {typeof hovered.grade === 'number' && <span><strong>Pendiente:</strong> {hovered.grade > 0 ? `+${hovered.grade}` : hovered.grade}%</span>}
          {typeof hovered.cad === 'number' && hovered.cad > 0 && <span><strong>Cad:</strong> {hovered.cad} {isPaceSport ? 'spm' : 'rpm'}</span>}
          {typeof hovered.temp === 'number' && <span><strong>Temp:</strong> {hovered.temp} °C</span>}
        </div>
      )}

      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full h-60 select-none cursor-crosshair"
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

        {hasEle && showEle && (
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

        {hasSpeed && showPace && <path d={speedLine} fill="none" stroke="#fc4c02" strokeWidth={1.8} strokeOpacity={0.92} />}
        {hasWatts && showWatts && <path d={wattsLine} fill="none" stroke="#06b6d4" strokeWidth={1.9} />}
        {hasHr && showHr && <path d={hrLine} fill="none" stroke="#f43f5e" strokeWidth={1.6} strokeOpacity={0.85} />}
        {hasCad && showCad && <path d={cadLine} fill="none" stroke="#a855f7" strokeWidth={1.5} strokeOpacity={0.8} />}

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
          const label =
            xAxisMode === 'dist' && hasDist
              ? `${((points[idx]?.dist ?? 0) / 1000).toFixed(1)} km`
              : formatDurationClock(points[idx]?.t ?? 0);
          return (
            <text key={f} x={toX(idx)} y={h - 6} fontSize="10" textAnchor="middle" fill="#64748b">
              {label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

export function ZoneBarsChart({ zones }: { zones: ZoneBucket[] }) {
  if (!zones || zones.length === 0) return null;
  return (
    <div className="space-y-2.5">
      {zones.map((z) => (
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
              {Math.floor(z.seconds / 60)}m {z.seconds % 60}s ({z.percent}%)
            </span>
          </div>
          <div className="h-2 w-full rounded-full overflow-hidden" style={{ background: 'var(--bg-muted)' }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${z.percent}%`, background: z.color }} />
          </div>
        </div>
      ))}
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
