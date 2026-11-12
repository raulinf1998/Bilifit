'use client';

import Link from 'next/link';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Award, Flag, Mountain, Trash2, Trophy } from 'lucide-react';
import ActivityMap from '@/components/ActivityMap';
import { SportBadge } from '@/components/SportBadge';
import { formatDurationClock, formatPaceMinKm, formatSpeedKmh, sportColor } from '@/lib/metrics';
import type { Segment, SegmentEffort, SportType } from '@/types';

const CATEGORY_LABELS: Record<Segment['category'], string> = {
  climb: 'Subida / Puerto',
  sprint: 'Sprint',
  flat: 'Llano',
  custom: 'Personalizado',
};

function SegmentsContent() {
  const searchParams = useSearchParams();
  const initialId = searchParams.get('id');

  const [segments, setSegments] = useState<Segment[]>([]);
  const [sportFilter, setSportFilter] = useState<'all' | SportType>('all');
  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  const [selectedSegment, setSelectedSegment] = useState<Segment | null>(null);
  const [efforts, setEfforts] = useState<SegmentEffort[]>([]);

  const loadList = useCallback(async () => {
    const res = await fetch(`/api/segments?sport=${sportFilter}`).then((r) => r.json());
    const list: Segment[] = res.segments ?? [];
    setSegments(list);
    if (list.length > 0 && (!selectedId || !list.some((s) => s.id === selectedId))) {
      setSelectedId(list[0].id);
    } else if (list.length === 0) {
      setSelectedId(null);
      setSelectedSegment(null);
      setEfforts([]);
    }
  }, [sportFilter, selectedId]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    if (!selectedId) return;
    fetch(`/api/segments/${selectedId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.segment) {
          setSelectedSegment(data.segment);
          setEfforts(data.efforts ?? []);
        }
      });
  }, [selectedId]);

  async function handleDeleteSegment(id: string) {
    await fetch(`/api/segments/${id}`, { method: 'DELETE' });
    setSelectedId(null);
    await loadList();
  }

  const isPace = selectedSegment
    ? selectedSegment.sport === 'running' ||
      selectedSegment.sport === 'trail' ||
      selectedSegment.sport === 'mountain' ||
      selectedSegment.sport === 'walking'
    : false;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
            <Flag className="h-6 w-6 text-amber-400" />
            Segmentos y Clasificación Histórica (PRs)
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Comparativa automática entre todas tus pasadas por subidas, rectas de series y circuitos de MyWhoosh.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {[
            { id: 'all', label: 'Todos' },
            { id: 'running', label: 'Correr' },
            { id: 'trail', label: 'Trail Running' },
            { id: 'mountain', label: 'Senderismo' },
            { id: 'walking', label: 'Caminar' },
            { id: 'mywhoosh', label: 'MyWhoosh' },
            { id: 'cycling', label: 'Ciclismo' },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setSportFilter(f.id as 'all' | SportType)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                sportFilter === f.id ? 'bg-[#fc4c02] text-white' : 'border hover:bg-slate-500/10'
              }`}
              style={sportFilter !== f.id ? { borderColor: 'var(--border-subtle)' } : undefined}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Lista izquierda de segmentos */}
        <div className="lg:col-span-5 space-y-2.5">
          {segments.length === 0 ? (
            <div className="card-surface p-6 text-xs text-center" style={{ color: 'var(--text-muted)' }}>
              No hay segmentos para este deporte. Entra en cualquier actividad con GPS y pulsa{' '}
              <strong>Auto-detectar subidas</strong> o <strong>Crear segmento</strong>.
            </div>
          ) : (
            segments.map((seg) => {
              const active = seg.id === selectedId;
              return (
                <button
                  key={seg.id}
                  type="button"
                  onClick={() => setSelectedId(seg.id)}
                  className={`w-full text-left card-surface p-4 space-y-2 transition-all ${
                    active ? 'border-amber-400 ring-1 ring-amber-400/40' : 'hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <SportBadge sport={seg.sport} />
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300">
                      {CATEGORY_LABELS[seg.category]}
                    </span>
                  </div>
                  <div className="font-bold text-sm">{seg.name}</div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    <span>
                      {(seg.distanceMeters / 1000).toFixed(2)} km · +{seg.elevationGain} m ({seg.avgGradePct}%)
                    </span>
                    <span className="font-semibold text-amber-300">
                      {seg.effortCount ?? 0} pasadas · PR {seg.bestTimeSec ? formatDurationClock(seg.bestTimeSec) : '--'}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Detalle derecho + Mapa + Leaderboard */}
        <div className="lg:col-span-7 space-y-5">
          {selectedSegment ? (
            <>
              <div className="card-surface p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <SportBadge sport={selectedSegment.sport} />
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300">
                        {CATEGORY_LABELS[selectedSegment.category]}
                      </span>
                    </div>
                    <h2 className="text-xl font-bold">{selectedSegment.name}</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteSegment(selectedSegment.id)}
                    className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Eliminar
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs tabular-nums">
                  <div className="card-elevated p-3">
                    <div style={{ color: 'var(--text-muted)' }}>Distancia</div>
                    <div className="text-base font-bold mt-0.5">{(selectedSegment.distanceMeters / 1000).toFixed(2)} km</div>
                  </div>
                  <div className="card-elevated p-3">
                    <div style={{ color: 'var(--text-muted)' }}>Desnivel +</div>
                    <div className="text-base font-bold text-emerald-400 mt-0.5">+{selectedSegment.elevationGain} m</div>
                  </div>
                  <div className="card-elevated p-3">
                    <div style={{ color: 'var(--text-muted)' }}>Pendiente media</div>
                    <div className="text-base font-bold mt-0.5">{selectedSegment.avgGradePct}%</div>
                  </div>
                  <div className="card-elevated p-3">
                    <div style={{ color: 'var(--text-muted)' }}>Mejor marca (PR)</div>
                    <div className="text-base font-bold text-amber-300 mt-0.5">
                      {efforts[0] ? formatDurationClock(efforts[0].durationSec) : '--'}
                    </div>
                  </div>
                </div>

                <ActivityMap
                  polyline={selectedSegment.polyline}
                  sport={selectedSegment.sport}
                  worldName={selectedSegment.worldName}
                  title={selectedSegment.name}
                  color={sportColor(selectedSegment.sport)}
                  defaultLayer={selectedSegment.sport === 'mountain' || selectedSegment.sport === 'trail' ? 'topo' : 'osm'}
                  heightClass="h-64"
                />
              </div>

              <div className="card-surface p-5 space-y-3">
                <h3 className="text-base font-bold flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-amber-400" />
                  Clasificación Histórica ({efforts.length} esfuerzos)
                </h3>

                {efforts.length === 0 ? (
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Aún no hay pasadas registradas para este segmento.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left border-b" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>
                          <th className="py-2 px-2">#</th>
                          <th className="py-2 px-2">Fecha y Actividad</th>
                          <th className="py-2 px-2">Tiempo</th>
                          <th className="py-2 px-2">{isPace ? 'Ritmo' : 'Vel.'}</th>
                          <th className="py-2 px-2">Potencia</th>
                          <th className="py-2 px-2">FC</th>
                          <th className="py-2 px-2">VAM</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                        {efforts.map((ef, idx) => (
                          <tr key={ef.id} className="tabular-nums hover:bg-slate-500/5">
                            <td className="py-2.5 px-2 font-bold">
                              {idx === 0 ? (
                                <span className="inline-flex items-center gap-1 text-amber-300">
                                  <Award className="h-3.5 w-3.5" /> 1
                                </span>
                              ) : (
                                idx + 1
                              )}
                            </td>
                            <td className="py-2.5 px-2">
                              <Link href={`/actividades/${ef.activityId}`} className="font-medium hover:text-[#fc4c02] hover:underline">
                                {ef.activityTitle ?? 'Actividad'}
                              </Link>
                              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                {ef.startedAt
                                  ? new Date(ef.startedAt).toLocaleDateString('es-ES', {
                                      day: '2-digit',
                                      month: 'short',
                                      year: 'numeric',
                                    })
                                  : '--'}
                              </div>
                            </td>
                            <td className="py-2.5 px-2 font-bold text-amber-300">
                              {formatDurationClock(ef.durationSec)}
                            </td>
                            <td className="py-2.5 px-2 font-semibold">
                              {isPace ? formatPaceMinKm(ef.avgSpeedMs) : formatSpeedKmh(ef.avgSpeedMs)}
                            </td>
                            <td className="py-2.5 px-2 text-cyan-400">
                              {ef.avgWatts ? `${ef.avgWatts} W` : '--'}
                            </td>
                            <td className="py-2.5 px-2 text-rose-400">
                              {ef.avgHr ? `${ef.avgHr} ppm` : '--'}
                            </td>
                            <td className="py-2.5 px-2 text-emerald-400">
                              {ef.vamMh ? (
                                <span className="inline-flex items-center gap-1">
                                  <Mountain className="h-3 w-3" /> {ef.vamMh} m/h
                                </span>
                              ) : (
                                '--'
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function SegmentsPage() {
  return (
    <Suspense fallback={<div className="card-surface p-8 text-sm">Cargando segmentos...</div>}>
      <SegmentsContent />
    </Suspense>
  );
}
