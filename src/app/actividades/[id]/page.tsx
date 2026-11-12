'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity as ActivityIcon,
  ArrowLeft,
  Award,
  Compass,
  Download,
  Flag,
  Flame,
  Gauge,
  Globe,
  HeartPulse,
  Mountain,
  Plus,
  Save,
  Sparkles,
  Thermometer,
  Timer,
  Trash2,
  Zap,
} from 'lucide-react';
import ActivityMap from '@/components/ActivityMap';
import { PowerZonesChart, TelemetryChart, ZoneBarsChart } from '@/components/Charts';
import { SportBadge } from '@/components/SportBadge';
import {
  defaultSubSportForSport,
  formatDistanceKm,
  formatDuration,
  formatDurationClock,
  formatPaceMinKm,
  formatSpeedKmh,
  getCogganPowerZones,
  sportColor,
} from '@/lib/metrics';
import { isMyWhooshContext, MYWHOOSH_WORLDS, resolveMyWhooshWorldForActivity } from '@/lib/mywhoosh-maps';
import { decodePolyline } from '@/lib/polyline';
import type { ActivityDetail, ActivityPoint, AthleteProfile, GearItem, SportType } from '@/types';

type AnalysisTab = 'splits' | 'efforts' | 'zones' | 'terrain';

export default function ActivityDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [activity, setActivity] = useState<ActivityDetail | null>(null);
  const [profile, setProfile] = useState<AthleteProfile | null>(null);
  const [gear, setGear] = useState<GearItem[]>([]);
  const [hoverPoint, setHoverPoint] = useState<ActivityPoint | null>(null);
  const [highlightPolyline, setHighlightPolyline] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const [title, setTitle] = useState('');
  const [sport, setSport] = useState<SportType>('running');
  const [worldName, setWorldName] = useState('');
  const [gearId, setGearId] = useState('');
  const [rpe, setRpe] = useState(6);
  const [description, setDescription] = useState('');

  // Tabs análisis profundo
  const [activeTab, setActiveTab] = useState<AnalysisTab>('splits');
  const [splitView, setSplitView] = useState<'km' | 'laps'>('km');

  // Creador de segmentos
  const [showSegmentCreator, setShowSegmentCreator] = useState(false);
  const [segName, setSegName] = useState('');
  const [segCategory, setSegCategory] = useState<'climb' | 'sprint' | 'flat' | 'custom'>('climb');
  const [segStartKm, setSegStartKm] = useState(0);
  const [segEndKm, setSegEndKm] = useState(1);
  const [segStatus, setSegStatus] = useState<string | null>(null);
  const [segBusy, setSegBusy] = useState(false);

  const loadAll = useCallback(async () => {
    const [actRes, profRes, gearRes] = await Promise.all([
      fetch(`/api/activities/${params.id}`).then((r) => (r.ok ? r.json() : null)),
      fetch('/api/profile').then((r) => r.json()),
      fetch('/api/gear').then((r) => r.json()),
    ]);
    if (actRes?.activity) {
      setActivity(actRes.activity);
      setTitle(actRes.activity.title);
      setSport(actRes.activity.sport);
      setWorldName(actRes.activity.worldName ?? '');
      setGearId(actRes.activity.gearId ?? '');
      setRpe(actRes.activity.rpe ?? 6);
      setDescription(actRes.activity.description ?? '');
      const distKm = Number(((actRes.activity.distanceMeters || 1000) / 1000).toFixed(2));
      setSegStartKm(0);
      setSegEndKm(Math.min(distKm, Math.max(0.5, Number((distKm * 0.4).toFixed(2)))));
      if (actRes.activity.laps && actRes.activity.laps.length > 1) {
        setSplitView('km');
      }
    }
    setProfile(profRes?.profile ?? null);
    setGear(gearRes?.gear ?? []);
  }, [params.id]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/activities/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        sport,
        ...(activity && sport !== activity.sport ? { subSport: defaultSubSportForSport(sport) } : {}),
        worldName: sport === 'mywhoosh' || worldName ? worldName || null : null,
        gearId: gearId || null,
        rpe,
        description,
      }),
    });
    if (res.ok) {
      await loadAll();
      setEditing(false);
    }
  }

  async function handleDelete() {
    await fetch(`/api/activities/${params.id}`, { method: 'DELETE' });
    router.push('/actividades');
  }

  async function handleAutoDetectClimbs() {
    if (!activity) return;
    setSegBusy(true);
    setSegStatus(null);
    try {
      const res = await fetch('/api/segments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activityId: activity.id, autoDetectClimbs: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSegStatus(data.error || 'Error detectando subidas');
      } else if (data.created?.length > 0) {
        setSegStatus(
          `Se crearon ${data.created.length} segmentos de subida y se detectaron ${data.matchedEfforts ?? 0} pasadas históricas.`
        );
        await loadAll();
      } else {
        setSegStatus(data.message || 'No se encontraron puertos significativos (>45 m D+ y >3%).');
      }
    } finally {
      setSegBusy(false);
    }
  }

  async function handleCreateCustomSegment(e: React.FormEvent) {
    e.preventDefault();
    if (!activity) return;
    setSegBusy(true);
    setSegStatus(null);
    try {
      const res = await fetch('/api/segments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activityId: activity.id,
          name: segName,
          category: segCategory,
          startDistM: Math.round(segStartKm * 1000),
          endDistM: Math.round(segEndKm * 1000),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSegStatus(data.error || 'Error creando segmento');
      } else {
        setSegStatus(`Segmento "${data.segment.name}" creado (${data.matchedEfforts} esfuerzos históricos enlazados).`);
        setSegName('');
        setShowSegmentCreator(false);
        await loadAll();
      }
    } finally {
      setSegBusy(false);
    }
  }

  const worldInfo = useMemo(() => {
    if (!activity) return null;
    const coords: Array<[number, number]> = activity.points.some(
      (p) => typeof p.lat === 'number' && typeof p.lon === 'number'
    )
      ? activity.points
          .filter((p): p is ActivityPoint & { lat: number; lon: number } => typeof p.lat === 'number' && typeof p.lon === 'number')
          .map((p) => [p.lat, p.lon])
      : activity.polyline
        ? decodePolyline(activity.polyline)
        : [];
    const deviceName = activity.extras?.deviceName ?? null;
    const virtualCtx = isMyWhooshContext({
      sport: activity.sport,
      subSport: activity.subSport,
      worldName: activity.worldName,
      title: activity.title,
      deviceName,
    });
    if (!virtualCtx && coords.length === 0) return null;
    return resolveMyWhooshWorldForActivity({
      worldName: activity.worldName,
      title: activity.title,
      sport: activity.sport,
      subSport: activity.subSport,
      deviceName,
      coords,
    });
  }, [activity]);

  if (!activity) {
    return (
      <div className="space-y-4">
        <Link href="/actividades" className="inline-flex items-center gap-2 text-sm text-[#fc4c02]">
          <ArrowLeft className="h-4 w-4" /> Volver al historial
        </Link>
        <div className="card-surface p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          Cargando actividad...
        </div>
      </div>
    );
  }

  const ftp = profile?.ftpWatts ?? 245;
  const weightKg = profile?.weightKg ?? 72;
  const isPaceSport = activity.sport === 'running' || activity.sport === 'mountain' || activity.sport === 'walking';
  const hasGps =
    activity.points.some((p) => typeof p.lat === 'number' && typeof p.lon === 'number') ||
    Boolean(activity.polyline) ||
    Boolean(worldInfo);
  const powerZones = activity.avgWatts ? getCogganPowerZones(ftp, activity.points) : null;
  const intensityFactor =
    activity.normalizedPower && ftp > 0 ? (activity.normalizedPower / ftp).toFixed(2) : null;
  const wKg = activity.avgWatts && weightKg > 0 ? (activity.avgWatts / weightKg).toFixed(2) : null;
  const extras = activity.extras ?? {};
  const maxKm = Number(((activity.distanceMeters || 1000) / 1000).toFixed(2));
  const bestSplitSpeed = activity.kmSplits?.length
    ? Math.max(0.5, ...activity.kmSplits.map((s) => s.avgSpeedMs ?? 0))
    : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/actividades" className="inline-flex items-center gap-2 text-sm font-medium hover:underline">
          <ArrowLeft className="h-4 w-4" /> Volver a Actividades
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          {hasGps && (
            <a
              href={`/api/activities/${activity.id}?format=gpx`}
              className="inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold hover:bg-slate-500/10"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <Download className="h-3.5 w-3.5 text-emerald-400" /> Descargar GPX
            </a>
          )}
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="rounded-xl border px-3.5 py-2 text-xs font-semibold hover:bg-slate-500/10"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            {editing ? 'Cerrar edición' : 'Editar'}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="inline-flex items-center gap-1 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-xs font-semibold text-rose-400 hover:bg-rose-500/20"
          >
            <Trash2 className="h-3.5 w-3.5" /> Eliminar
          </button>
        </div>
      </div>

      {/* Header & KPIs principales */}
      <div className="card-surface p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <SportBadge sport={activity.sport} subSport={activity.subSport} />
          {(activity.worldName || worldInfo) && (
            <span className="inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
              <Globe className="h-3 w-3" />
              Mundo Virtual: {worldInfo?.world.name ?? activity.worldName}
            </span>
          )}
          {extras.deviceName && (
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-500/15 text-slate-300 border border-slate-500/30">
              {extras.deviceName}
            </span>
          )}
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {new Date(activity.startedAt).toLocaleString('es-ES')} · Origen:{' '}
            {activity.source === 'huawei'
              ? 'HUAWEI HEALTH'
              : activity.source === 'mywhoosh'
                ? 'MYWHOOSH DIRECTO'
                : activity.source.toUpperCase()}
          </span>
        </div>

        <h1 className="text-2xl sm:text-3xl font-bold">{activity.title}</h1>
        {activity.description && (
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {activity.description}
          </p>
        )}

        {editing && (
          <form onSubmit={handleSave} className="pt-4 border-t grid grid-cols-1 sm:grid-cols-2 gap-4" style={{ borderColor: 'var(--border-subtle)' }}>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Título</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Deporte</label>
              <select
                value={sport}
                onChange={(e) => setSport(e.target.value as SportType)}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              >
                <option value="running">Correr</option>
                <option value="mywhoosh">MyWhoosh / Bici Indoor</option>
                <option value="mountain">Montaña / Trail</option>
                <option value="walking">Caminar</option>
                <option value="cycling">Ciclismo Exterior</option>
                <option value="strength">Fuerza en Casa</option>
              </select>
            </div>
            {(sport === 'mywhoosh' || Boolean(worldName)) && (
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Mundo Virtual MyWhoosh</label>
                <select
                  value={worldName}
                  onChange={(e) => setWorldName(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
                >
                  <option value="">Auto-detectar por GPS / título</option>
                  {MYWHOOSH_WORLDS.map((w) => (
                    <option key={w.id} value={w.name}>
                      {w.name} ({w.regionLabel})
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Material asociado</label>
              <select
                value={gearId}
                onChange={(e) => setGearId(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              >
                <option value="">Sin material</option>
                {gear.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>RPE ({rpe}/10)</label>
              <input
                type="range"
                min={1}
                max={10}
                value={rpe}
                onChange={(e) => setRpe(Number(e.target.value))}
                className="w-full accent-[#fc4c02] mt-2"
              />
            </div>
            <div className="sm:col-span-2">
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <button
                type="submit"
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
              >
                <Save className="h-4 w-4" /> Guardar cambios
              </button>
            </div>
          </form>
        )}

        {/* Grid de métricas ampliado */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 pt-2">
          {activity.distanceMeters > 0 && (
            <div className="card-elevated p-3">
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Distancia</div>
              <div className="text-lg font-bold tabular-nums">{formatDistanceKm(activity.distanceMeters)}</div>
            </div>
          )}
          <div className="card-elevated p-3">
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Tiempo mov.</div>
            <div className="text-lg font-bold tabular-nums">{formatDuration(activity.durationSec)}</div>
          </div>
          {typeof activity.avgSpeedMs === 'number' && activity.avgSpeedMs > 0 && (
            <div className="card-elevated p-3">
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {isPaceSport ? 'Ritmo medio' : 'Vel. media'}
              </div>
              <div className="text-lg font-bold tabular-nums text-[#fc4c02]">
                {isPaceSport ? formatPaceMinKm(activity.avgSpeedMs) : formatSpeedKmh(activity.avgSpeedMs)}
              </div>
            </div>
          )}
          {typeof extras.gapSpeedMs === 'number' && extras.gapSpeedMs > 0 && isPaceSport && (
            <div className="card-elevated p-3">
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Ritmo GAP (llano)</div>
              <div className="text-lg font-bold tabular-nums text-amber-400">
                {formatPaceMinKm(extras.gapSpeedMs)}
              </div>
            </div>
          )}
          {activity.elevationGain > 0 && (
            <div className="card-elevated p-3">
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Desnivel + / -</div>
              <div className="text-lg font-bold tabular-nums text-emerald-400">
                +{activity.elevationGain} / -{activity.elevationLoss ?? 0} m
              </div>
            </div>
          )}
          {typeof extras.maxEle === 'number' && (
            <div className="card-elevated p-3">
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Cota Máx / Mín</div>
              <div className="text-lg font-bold tabular-nums">
                {extras.maxEle} / {extras.minEle ?? '--'} m
              </div>
            </div>
          )}
          {typeof activity.avgHr === 'number' && activity.avgHr > 0 && (
            <div className="card-elevated p-3">
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>FC Media / Máx</div>
              <div className="text-lg font-bold tabular-nums text-rose-400">
                {activity.avgHr} / {activity.maxHr ?? '--'} ppm
              </div>
            </div>
          )}
          {typeof activity.avgWatts === 'number' && activity.avgWatts > 0 && (
            <div className="card-elevated p-3">
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Potencia / NP</div>
              <div className="text-lg font-bold tabular-nums text-cyan-400">
                {activity.avgWatts} / {activity.normalizedPower ?? activity.avgWatts} W
              </div>
            </div>
          )}
          {wKg && (
            <div className="card-elevated p-3">
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Relación W/kg</div>
              <div className="text-lg font-bold tabular-nums">{wKg} W/kg</div>
            </div>
          )}
          {intensityFactor && (
            <div className="card-elevated p-3">
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>IF · VI</div>
              <div className="text-lg font-bold tabular-nums">
                {intensityFactor}{extras.variabilityIndex ? ` · ${extras.variabilityIndex}` : ''}
              </div>
            </div>
          )}
          {typeof activity.avgCadence === 'number' && activity.avgCadence > 0 && (
            <div className="card-elevated p-3">
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Cadencia media</div>
              <div className="text-lg font-bold tabular-nums text-purple-400">
                {activity.avgCadence} {isPaceSport ? 'spm' : 'rpm'}
              </div>
            </div>
          )}
          {typeof extras.vamMh === 'number' && extras.vamMh > 0 && (
            <div className="card-elevated p-3">
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>VAM subida</div>
              <div className="text-lg font-bold tabular-nums text-emerald-400">{extras.vamMh} m/h</div>
            </div>
          )}
          {typeof extras.avgTemp === 'number' && (
            <div className="card-elevated p-3">
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Temperatura</div>
              <div className="text-lg font-bold tabular-nums text-amber-300">
                {extras.avgTemp} °C
              </div>
            </div>
          )}
          <div className="card-elevated p-3">
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Carga (TSS)</div>
            <div className="text-lg font-bold tabular-nums text-[#fc4c02]">{activity.tss}</div>
          </div>
          {typeof activity.calories === 'number' && activity.calories > 0 && (
            <div className="card-elevated p-3">
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Energía</div>
              <div className="text-lg font-bold tabular-nums">
                {activity.calories} kcal{extras.workKj ? ` · ${extras.workKj} kJ` : ''}
              </div>
            </div>
          )}
          {typeof extras.steps === 'number' && extras.steps > 0 && (
            <div className="card-elevated p-3">
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Pasos</div>
              <div className="text-lg font-bold tabular-nums">{extras.steps.toLocaleString('es-ES')}</div>
            </div>
          )}
          {typeof activity.totalVolumeKg === 'number' && activity.totalVolumeKg > 0 && (
            <div className="card-elevated p-3">
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Volumen fuerza</div>
              <div className="text-lg font-bold tabular-nums text-purple-400">{activity.totalVolumeKg} kg</div>
            </div>
          )}
        </div>
      </div>

      {/* Mapa GPS o Mapa Virtual MyWhoosh */}
      {hasGps && (
        <div className="card-surface p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold flex items-center gap-2">
              {worldInfo ? <Globe className="h-4 w-4 text-cyan-400" /> : <Compass className="h-4 w-4 text-emerald-400" />}
              {worldInfo ? `Mapa Virtual MyWhoosh · ${worldInfo.world.name}` : 'Mapa Topográfico de la Ruta'}
            </h2>
            {highlightPolyline && (
              <button
                type="button"
                onClick={() => setHighlightPolyline(null)}
                className="text-xs px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-300 border border-amber-500/30"
              >
                Limpiar resaltado de segmento
              </button>
            )}
          </div>
          <ActivityMap
            points={activity.points}
            polyline={activity.polyline}
            sport={activity.sport}
            subSport={activity.subSport}
            deviceName={extras.deviceName ?? null}
            worldName={activity.worldName}
            title={activity.title}
            color={sportColor(activity.sport)}
            defaultLayer={worldInfo ? 'virtual' : activity.sport === 'mountain' ? 'topo' : 'osm'}
            hoverPoint={hoverPoint}
            highlightPolyline={highlightPolyline}
            heightClass="h-[440px]"
          />
        </div>
      )}

      {/* Gráfica de Telemetría multi-capa */}
      {activity.points.length > 3 && (
        <div className="card-surface p-5 space-y-3">
          <h2 className="text-base font-bold">Telemetría Interactiva (Altitud · Ritmo/Velocidad · Pulso · Potencia · Cadencia)</h2>
          <TelemetryChart points={activity.points} sport={activity.sport} onHoverPoint={setHoverPoint} />
        </div>
      )}

      {/* Segmentos detectados y creador */}
      {activity.points.some((p) => typeof p.lat === 'number' && typeof p.lon === 'number') && (
        <div className="card-surface p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold flex items-center gap-2">
                <Flag className="h-4 w-4 text-amber-400" />
                Segmentos en esta Actividad ({activity.segmentEfforts?.length ?? 0})
              </h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Pulsa un segmento para resaltarlo en el mapa o compararlo con todas tus pasadas anteriores.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={segBusy}
                onClick={handleAutoDetectClimbs}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 px-3 py-1.5 text-xs font-semibold hover:bg-emerald-500/25 disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" /> Auto-detectar subidas
              </button>
              <button
                type="button"
                onClick={() => setShowSegmentCreator((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#fc4c02]/15 text-[#fc4c02] border border-[#fc4c02]/30 px-3 py-1.5 text-xs font-semibold hover:bg-[#fc4c02]/25"
              >
                <Plus className="h-3.5 w-3.5" /> Crear segmento
              </button>
            </div>
          </div>

          {segStatus && (
            <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-2 text-xs text-cyan-300">
              {segStatus}
            </div>
          )}

          {showSegmentCreator && (
            <form
              onSubmit={handleCreateCustomSegment}
              className="rounded-xl border p-4 grid grid-cols-1 sm:grid-cols-4 gap-3"
              style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
            >
              <div className="sm:col-span-2">
                <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Nombre del segmento</label>
                <input
                  required
                  placeholder="Ej: Subida Fuente del Pájaro"
                  value={segName}
                  onChange={(e) => setSegName(e.target.value)}
                  className="w-full rounded-lg border px-3 py-1.5 text-xs"
                  style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
                />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Tipo</label>
                <select
                  value={segCategory}
                  onChange={(e) => setSegCategory(e.target.value as 'climb' | 'sprint' | 'flat' | 'custom')}
                  className="w-full rounded-lg border px-3 py-1.5 text-xs"
                  style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
                >
                  <option value="climb">Subida / Puerto</option>
                  <option value="sprint">Sprint</option>
                  <option value="flat">Llano / Serie</option>
                  <option value="custom">Personalizado</option>
                </select>
              </div>
              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={segBusy}
                  className="w-full rounded-lg bg-[#fc4c02] hover:bg-[#e04300] px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Guardar y buscar pasadas
                </button>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                  Inicio: <strong>{segStartKm.toFixed(2)} km</strong>
                </label>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0.2, maxKm - 0.15)}
                  step={0.05}
                  value={segStartKm}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setSegStartKm(v);
                    if (segEndKm <= v + 0.1) setSegEndKm(Math.min(maxKm, Number((v + 0.2).toFixed(2))));
                  }}
                  className="w-full accent-[#fc4c02]"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                  Fin: <strong>{segEndKm.toFixed(2)} km</strong> (tramo {Math.max(0, segEndKm - segStartKm).toFixed(2)} km)
                </label>
                <input
                  type="range"
                  min={0.15}
                  max={maxKm}
                  step={0.05}
                  value={segEndKm}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setSegEndKm(Math.max(segStartKm + 0.15, v));
                  }}
                  className="w-full accent-emerald-400"
                />
              </div>
            </form>
          )}

          {activity.segmentEfforts && activity.segmentEfforts.length > 0 ? (
            <div className="space-y-2">
              {activity.segmentEfforts.map((ef) => (
                <div
                  key={ef.id}
                  onMouseEnter={() => ef.segmentPolyline && setHighlightPolyline(ef.segmentPolyline)}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border p-3.5 hover:border-amber-400/50 transition-colors cursor-pointer"
                  style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {ef.prRank === 1 && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                          <Award className="h-3 w-3" /> PR #1
                        </span>
                      )}
                      {ef.prRank && ef.prRank > 1 && (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-500/20 text-slate-300">
                          #{ef.prRank} tiempo histórico{ef.prDeltaSec ? ` (+${ef.prDeltaSec}s)` : ''}
                        </span>
                      )}
                      <Link href={`/segmentos?id=${ef.segmentId}`} className="font-semibold text-sm hover:text-amber-300 underline-offset-2 hover:underline">
                        {ef.segmentName ?? 'Segmento'}
                      </Link>
                    </div>
                    <div className="text-xs flex flex-wrap gap-3" style={{ color: 'var(--text-muted)' }}>
                      {ef.segmentDistanceMeters && <span>{(ef.segmentDistanceMeters / 1000).toFixed(2)} km</span>}
                      {typeof ef.segmentAvgGradePct === 'number' && <span>{ef.segmentAvgGradePct}% pendiente media</span>}
                      {typeof ef.segmentElevationGain === 'number' && ef.segmentElevationGain > 0 && (
                        <span>+{ef.segmentElevationGain} m D+</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-xs tabular-nums">
                    <div>
                      <div style={{ color: 'var(--text-muted)' }}>Tiempo</div>
                      <div className="font-bold text-amber-300">{formatDurationClock(ef.durationSec)}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--text-muted)' }}>{isPaceSport ? 'Ritmo' : 'Velocidad'}</div>
                      <div className="font-semibold">
                        {isPaceSport ? formatPaceMinKm(ef.avgSpeedMs) : formatSpeedKmh(ef.avgSpeedMs)}
                      </div>
                    </div>
                    {ef.avgWatts && (
                      <div>
                        <div style={{ color: 'var(--text-muted)' }}>Potencia</div>
                        <div className="font-semibold text-cyan-400">{ef.avgWatts} W</div>
                      </div>
                    )}
                    {ef.avgHr && (
                      <div>
                        <div style={{ color: 'var(--text-muted)' }}>FC</div>
                        <div className="font-semibold text-rose-400">{ef.avgHr} ppm</div>
                      </div>
                    )}
                    {ef.vamMh && (
                      <div>
                        <div style={{ color: 'var(--text-muted)' }}>VAM</div>
                        <div className="font-semibold text-emerald-400">{ef.vamMh} m/h</div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border p-4 text-xs" style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>
              Esta sesión todavía no cruza ningún segmento guardado. Usa <strong>Auto-detectar subidas</strong> o <strong>Crear segmento</strong> para empezar a comparar tus marcas.
            </div>
          )}
        </div>
      )}

      {/* Pestañas de Análisis Completo */}
      {activity.points.length > 3 && (
        <div className="card-surface p-5 space-y-5">
          <div className="flex flex-wrap gap-2 border-b pb-3" style={{ borderColor: 'var(--border-subtle)' }}>
            {[
              { id: 'splits', label: 'Parciales y Vueltas', icon: Timer },
              { id: 'efforts', label: 'Mejores Esfuerzos & Curva', icon: Award },
              { id: 'zones', label: 'Zonas (FC · Ritmo · Potencia)', icon: HeartPulse },
              { id: 'terrain', label: 'Terreno, Eficiencia y Dinámica', icon: Mountain },
            ].map((t) => {
              const Icon = t.icon;
              const active = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id as AnalysisTab)}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors ${
                    active ? 'bg-[#fc4c02] text-white' : 'hover:bg-slate-500/10'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* TAB 1: Parciales por Km & Laps del dispositivo */}
          {activeTab === 'splits' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">
                  {splitView === 'km' ? 'Parciales por kilómetro' : 'Vueltas registradas por el dispositivo (.FIT / .TCX)'}
                </div>
                {activity.laps && activity.laps.length > 0 && (
                  <div className="inline-flex rounded-lg border overflow-hidden text-xs" style={{ borderColor: 'var(--border-subtle)' }}>
                    <button
                      type="button"
                      onClick={() => setSplitView('km')}
                      className={`px-3 py-1 ${splitView === 'km' ? 'bg-[#fc4c02] text-white' : ''}`}
                    >
                      Splits 1 km ({activity.kmSplits?.length ?? 0})
                    </button>
                    <button
                      type="button"
                      onClick={() => setSplitView('laps')}
                      className={`px-3 py-1 ${splitView === 'laps' ? 'bg-[#fc4c02] text-white' : ''}`}
                    >
                      Vueltas / Laps ({activity.laps.length})
                    </button>
                  </div>
                )}
              </div>

              {splitView === 'km' && activity.kmSplits && activity.kmSplits.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left border-b" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>
                        <th className="py-2 px-2">Km</th>
                        <th className="py-2 px-2">{isPaceSport ? 'Ritmo' : 'Velocidad'}</th>
                        {isPaceSport && <th className="py-2 px-2">GAP</th>}
                        <th className="py-2 px-2 w-28">Intensidad</th>
                        <th className="py-2 px-2">Pendiente</th>
                        <th className="py-2 px-2">Desn. +/-</th>
                        <th className="py-2 px-2">FC</th>
                        <th className="py-2 px-2">Potencia</th>
                        <th className="py-2 px-2">Cadencia</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                      {activity.kmSplits.map((sp) => {
                        const spSpeed = sp.avgSpeedMs ?? 0;
                        const barPct = Math.min(100, Math.max(18, Math.round((spSpeed / bestSplitSpeed) * 100)));
                        return (
                          <tr key={sp.lapNumber} className="tabular-nums hover:bg-slate-500/5">
                            <td className="py-2 px-2 font-bold">
                              {sp.distanceMeters >= 950 ? `Km ${sp.lapNumber}` : `${(sp.distanceMeters / 1000).toFixed(2)} km`}
                            </td>
                            <td className="py-2 px-2 font-semibold text-[#fc4c02]">
                              {sp.avgSpeedMs
                                ? isPaceSport
                                  ? formatPaceMinKm(sp.avgSpeedMs)
                                  : formatSpeedKmh(sp.avgSpeedMs)
                                : '--'}
                            </td>
                            {isPaceSport && (
                              <td className="py-2 px-2 text-amber-300">
                                {sp.gapSpeedMs ? formatPaceMinKm(sp.gapSpeedMs) : '--'}
                              </td>
                            )}
                            <td className="py-2 px-2">
                              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-muted)' }}>
                                <div className="h-full rounded-full bg-[#fc4c02]" style={{ width: `${barPct}%` }} />
                              </div>
                            </td>
                            <td className="py-2 px-2">
                              {typeof sp.avgGradePct === 'number' ? `${sp.avgGradePct > 0 ? '+' : ''}${sp.avgGradePct}%` : '--'}
                            </td>
                            <td className="py-2 px-2 text-emerald-400">
                              +{sp.elevationGain}/-{sp.elevationLoss} m
                            </td>
                            <td className="py-2 px-2 text-rose-400">{sp.avgHr ? `${sp.avgHr} ppm` : '--'}</td>
                            <td className="py-2 px-2 text-cyan-400">{sp.avgWatts ? `${sp.avgWatts} W` : '--'}</td>
                            <td className="py-2 px-2 text-purple-400">
                              {sp.avgCadence ? `${sp.avgCadence} ${isPaceSport ? 'spm' : 'rpm'}` : '--'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {splitView === 'laps' && activity.laps && activity.laps.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left border-b" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>
                        <th className="py-2 px-2">Vuelta</th>
                        <th className="py-2 px-2">Distancia</th>
                        <th className="py-2 px-2">Tiempo</th>
                        <th className="py-2 px-2">{isPaceSport ? 'Ritmo' : 'Vel.'}</th>
                        <th className="py-2 px-2">FC Media/Máx</th>
                        <th className="py-2 px-2">Vatios (NP)</th>
                        <th className="py-2 px-2">Cadencia</th>
                        <th className="py-2 px-2">Disparador</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                      {activity.laps.map((lap) => (
                        <tr key={lap.lapNumber} className="tabular-nums hover:bg-slate-500/5">
                          <td className="py-2 px-2 font-bold">{lap.name ?? `Lap ${lap.lapNumber}`}</td>
                          <td className="py-2 px-2">{(lap.distanceMeters / 1000).toFixed(2)} km</td>
                          <td className="py-2 px-2">{formatDurationClock(lap.durationSec)}</td>
                          <td className="py-2 px-2 font-semibold text-[#fc4c02]">
                            {lap.avgSpeedMs
                              ? isPaceSport
                                ? formatPaceMinKm(lap.avgSpeedMs)
                                : formatSpeedKmh(lap.avgSpeedMs)
                              : '--'}
                          </td>
                          <td className="py-2 px-2 text-rose-400">
                            {lap.avgHr ?? '--'} / {lap.maxHr ?? '--'}
                          </td>
                          <td className="py-2 px-2 text-cyan-400">
                            {lap.avgWatts ? `${lap.avgWatts} W${lap.normalizedPower ? ` (${lap.normalizedPower})` : ''}` : '--'}
                          </td>
                          <td className="py-2 px-2 text-purple-400">{lap.avgCadence ?? '--'}</td>
                          <td className="py-2 px-2" style={{ color: 'var(--text-muted)' }}>{lap.trigger ?? 'auto'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: Mejores Esfuerzos & Curva de Potencia */}
          {activeTab === 'efforts' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {activity.bestEfforts && activity.bestEfforts.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-bold flex items-center gap-2">
                    <Flame className="h-4 w-4 text-[#fc4c02]" />
                    Mejores Esfuerzos en Distancia y Escalada
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {activity.bestEfforts.map((be) => (
                      <div key={be.label} className="card-elevated p-3 space-y-1">
                        <div className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>{be.label}</div>
                        <div className="text-base font-bold text-[#fc4c02] tabular-nums">
                          {formatDurationClock(be.durationSec)}
                        </div>
                        <div className="text-[11px] tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                          {isPaceSport ? formatPaceMinKm(be.avgSpeedMs) : formatSpeedKmh(be.avgSpeedMs)}
                          {be.avgHr ? ` · ${be.avgHr} ppm` : ''}
                          {be.avgWatts ? ` · ${be.avgWatts} W` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activity.powerCurve && activity.powerCurve.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-bold flex items-center gap-2">
                    <Zap className="h-4 w-4 text-cyan-400" />
                    Curva de Potencia (Vatios y W/kg)
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {activity.powerCurve.map((p) => (
                      <div key={p.label} className="card-elevated p-3 text-center">
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Mejor {p.label}</div>
                        <div className="text-xl font-bold text-cyan-400 tabular-nums mt-1">{p.watts} W</div>
                        <div className="text-[11px] tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                          {(p.watts / weightKg).toFixed(2)} W/kg
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: Zonas (FC, Ritmo, Potencia) */}
          {activeTab === 'zones' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {activity.hrZones && activity.hrZones.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-bold flex items-center gap-2">
                    <HeartPulse className="h-4 w-4 text-rose-400" />
                    Zonas de Frecuencia Cardíaca (FC Máx {profile?.maxHr ?? 188} ppm)
                  </h3>
                  <ZoneBarsChart zones={activity.hrZones} />
                </div>
              )}

              {activity.paceZones && activity.paceZones.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-bold flex items-center gap-2">
                    <ActivityIcon className="h-4 w-4 text-[#fc4c02]" />
                    Zonas de Ritmo (Carrera / Trail)
                  </h3>
                  <ZoneBarsChart zones={activity.paceZones} />
                </div>
              )}

              {powerZones && (
                <div className="space-y-3 lg:col-span-2">
                  <h3 className="text-sm font-bold flex items-center gap-2">
                    <Zap className="h-4 w-4 text-cyan-400" />
                    Zonas de Potencia Coggan (FTP {ftp} W)
                  </h3>
                  <PowerZonesChart zones={powerZones} />
                </div>
              )}
            </div>
          )}

          {/* TAB 4: Terreno, Eficiencia y Dinámica */}
          {activeTab === 'terrain' && (
            <div className="space-y-6">
              {activity.terrainBreakdown && activity.terrainBreakdown.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-bold flex items-center gap-2">
                    <Mountain className="h-4 w-4 text-emerald-400" />
                    Desglose del Esfuerzo por Pendiente (Subida · Llano · Bajada)
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {activity.terrainBreakdown.map((tb) => (
                      <div key={tb.type} className="card-elevated p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-sm">{tb.label}</span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-500/15">
                            {(tb.distanceMeters / 1000).toFixed(2)} km
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs tabular-nums">
                          <div>
                            <div style={{ color: 'var(--text-muted)' }}>Tiempo</div>
                            <div className="font-semibold">{formatDuration(tb.durationSec)}</div>
                          </div>
                          <div>
                            <div style={{ color: 'var(--text-muted)' }}>{isPaceSport ? 'Ritmo' : 'Vel.'}</div>
                            <div className="font-semibold text-[#fc4c02]">
                              {tb.avgSpeedMs
                                ? isPaceSport
                                  ? formatPaceMinKm(tb.avgSpeedMs)
                                  : formatSpeedKmh(tb.avgSpeedMs)
                                : '--'}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {extras.efficiencyFactor && (
                  <div className="card-elevated p-3.5">
                    <div className="text-[11px] flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                      <Gauge className="h-3.5 w-3.5 text-cyan-400" /> Factor de Eficiencia (EF)
                    </div>
                    <div className="text-lg font-bold tabular-nums mt-1">{extras.efficiencyFactor}</div>
                  </div>
                )}
                {typeof extras.aerobicDecouplingPct === 'number' && (
                  <div className="card-elevated p-3.5">
                    <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Desacoplamiento Aeróbico</div>
                    <div className={`text-lg font-bold tabular-nums mt-1 ${extras.aerobicDecouplingPct <= 5 ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {extras.aerobicDecouplingPct}%
                    </div>
                    <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      {extras.aerobicDecouplingPct <= 5 ? 'Base aeróbica sólida (<5%)' : 'Deriva cardíaca >5%'}
                    </div>
                  </div>
                )}
                {typeof extras.avgTemp === 'number' && (
                  <div className="card-elevated p-3.5">
                    <div className="text-[11px] flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                      <Thermometer className="h-3.5 w-3.5 text-amber-300" /> Temperatura
                    </div>
                    <div className="text-lg font-bold tabular-nums mt-1">
                      {extras.avgTemp}°C ({extras.minTemp ?? '--'}° / {extras.maxTemp ?? '--'}°)
                    </div>
                  </div>
                )}
                {typeof extras.leftBalancePct === 'number' && (
                  <div className="card-elevated p-3.5">
                    <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Equilibrio Izq / Der</div>
                    <div className="text-lg font-bold tabular-nums mt-1 text-cyan-400">
                      {extras.leftBalancePct}% / {extras.rightBalancePct ?? 100 - extras.leftBalancePct}%
                    </div>
                  </div>
                )}
                {extras.avgGctMs && (
                  <div className="card-elevated p-3.5">
                    <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Contacto suelo (GCT)</div>
                    <div className="text-lg font-bold tabular-nums mt-1">{extras.avgGctMs} ms</div>
                  </div>
                )}
                {extras.avgVerticalOscMm && (
                  <div className="card-elevated p-3.5">
                    <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Oscilación vertical</div>
                    <div className="text-lg font-bold tabular-nums mt-1">{(extras.avgVerticalOscMm / 10).toFixed(1)} cm</div>
                  </div>
                )}
                {extras.avgStrideLenM && (
                  <div className="card-elevated p-3.5">
                    <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Longitud zancada</div>
                    <div className="text-lg font-bold tabular-nums mt-1">{extras.avgStrideLenM} m</div>
                  </div>
                )}
                {(extras.aerobicTe || extras.anaerobicTe) && (
                  <div className="card-elevated p-3.5">
                    <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Training Effect (Aer / Ana)</div>
                    <div className="text-lg font-bold tabular-nums mt-1 text-emerald-400">
                      {extras.aerobicTe ?? '--'} / {extras.anaerobicTe ?? '--'}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Detalle de Fuerza en Casa */}
      {activity.strengthLogs && activity.strengthLogs.length > 0 && (
        <div className="card-surface p-5 space-y-4">
          <h2 className="text-base font-bold">Ejercicios y Series Registradas</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {activity.strengthLogs.map((ex, idx) => (
              <div key={`${ex.exerciseId}-${idx}`} className="card-elevated p-4 space-y-2">
                <div className="font-semibold text-sm">{ex.exerciseName}</div>
                <div className="space-y-1">
                  {ex.sets.map((s, sIdx) => (
                    <div key={sIdx} className="flex justify-between text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                      <span>Serie {sIdx + 1}</span>
                      <span>
                        {s.reps} reps {s.weightKg > 0 ? `× ${s.weightKg} kg` : '(peso corporal)'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
