'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Save, Settings } from 'lucide-react';
import { getCogganPowerZones } from '@/lib/metrics';
import type { AthleteProfile } from '@/types';

export default function SettingsPage() {
  const [profile, setProfile] = useState<AthleteProfile | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/profile')
      .then((r) => r.json())
      .then((d) => setProfile(d.profile));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    const res = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
    });
    if (res.ok) {
      const d = await res.json();
      setProfile(d.profile);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
  }

  if (!profile) {
    return <div className="card-surface p-8 text-sm">Cargando perfil...</div>;
  }

  const zones = getCogganPowerZones(profile.ftpWatts);
  const hrZones = [
    { z: 'Z1', name: 'Recuperación', range: `< ${Math.round(profile.maxHr * 0.6)} ppm` },
    { z: 'Z2', name: 'Aeróbico / Base', range: `${Math.round(profile.maxHr * 0.6)}-${Math.round(profile.maxHr * 0.72)} ppm` },
    { z: 'Z3', name: 'Tempo', range: `${Math.round(profile.maxHr * 0.73)}-${Math.round(profile.maxHr * 0.82)} ppm` },
    { z: 'Z4', name: 'Umbral', range: `${Math.round(profile.maxHr * 0.83)}-${Math.round(profile.maxHr * 0.91)} ppm` },
    { z: 'Z5', name: 'VO2 Max', range: `> ${Math.round(profile.maxHr * 0.91)} ppm` },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
          <Settings className="h-6 w-6 text-primary" />
          Ajustes Fisiológicos del Atleta
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          Bilifit usa estos umbrales para calcular automáticamente tus TSS, W/kg, Fitness (CTL) y zonas de MyWhoosh/Running.
        </p>
      </div>

      {saved && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3.5 text-sm text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" /> Perfil fisiológico guardado correctamente.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <form onSubmit={handleSave} className="lg:col-span-7 card-surface p-5 space-y-4">
          <h2 className="text-base font-bold">Parámetros y Objetivos</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                Nombre de atleta
              </label>
              <input
                value={profile.name}
                onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                className="w-full rounded-xl border px-3 py-2 text-sm"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>

            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                Peso corporal (kg)
              </label>
              <input
                type="number"
                step={0.5}
                value={profile.weightKg}
                onChange={(e) => setProfile({ ...profile, weightKg: Number(e.target.value) })}
                className="w-full rounded-xl border px-3 py-2 text-sm tabular-nums"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>

            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                FTP Ciclismo / MyWhoosh (W)
              </label>
              <input
                type="number"
                value={profile.ftpWatts}
                onChange={(e) => setProfile({ ...profile, ftpWatts: Number(e.target.value) })}
                className="w-full rounded-xl border px-3 py-2 text-sm tabular-nums"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>

            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                FC Máxima (ppm)
              </label>
              <input
                type="number"
                value={profile.maxHr}
                onChange={(e) => setProfile({ ...profile, maxHr: Number(e.target.value) })}
                className="w-full rounded-xl border px-3 py-2 text-sm tabular-nums"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>

            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                FC Reposo (ppm)
              </label>
              <input
                type="number"
                value={profile.restingHr}
                onChange={(e) => setProfile({ ...profile, restingHr: Number(e.target.value) })}
                className="w-full rounded-xl border px-3 py-2 text-sm tabular-nums"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>

            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                Umbral Láctico LTHR (ppm)
              </label>
              <input
                type="number"
                value={profile.lthr}
                onChange={(e) => setProfile({ ...profile, lthr: Number(e.target.value) })}
                className="w-full rounded-xl border px-3 py-2 text-sm tabular-nums"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>

            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                Objetivo semanal (horas)
              </label>
              <input
                type="number"
                step={0.5}
                value={profile.weeklyTargetHours}
                onChange={(e) => setProfile({ ...profile, weeklyTargetHours: Number(e.target.value) })}
                className="w-full rounded-xl border px-3 py-2 text-sm tabular-nums"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-xl bg-primary hover:bg-primaryhover px-5 py-2.5 text-sm font-semibold text-onprimary"
            >
              <Save className="h-4 w-4" /> Guardar Perfil
            </button>
          </div>
        </form>

        <div className="lg:col-span-5 space-y-5">
          <div className="card-surface p-5 space-y-3">
            <h2 className="text-base font-bold">
              Zonas de Potencia ({(profile.ftpWatts / Math.max(1, profile.weightKg)).toFixed(2)} W/kg)
            </h2>
            <div className="space-y-1.5">
              {zones.map((z) => (
                <div key={z.zone} className="flex justify-between text-xs py-1 border-b last:border-0" style={{ borderColor: 'var(--border-subtle)' }}>
                  <span>
                    <strong style={{ color: z.color }}>{z.zone}</strong> {z.name}
                  </span>
                  <span className="tabular-nums font-medium">{z.range}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card-surface p-5 space-y-3">
            <h2 className="text-base font-bold">Zonas de Frecuencia Cardíaca</h2>
            <div className="space-y-1.5">
              {hrZones.map((z) => (
                <div key={z.z} className="flex justify-between text-xs py-1 border-b last:border-0" style={{ borderColor: 'var(--border-subtle)' }}>
                  <span>
                    <strong className="text-rose-400">{z.z}</strong> {z.name}
                  </span>
                  <span className="tabular-nums font-medium">{z.range}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
