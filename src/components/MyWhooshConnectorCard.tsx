'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  History,
  Info,
  Link2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Unlink,
  Zap,
} from 'lucide-react';
import type { MyWhooshConnectionStatus } from '@/types';

export default function MyWhooshConnectorCard({ onSynced }: { onSynced?: () => void }) {
  const [status, setStatus] = useState<MyWhooshConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberPassword, setRememberPassword] = useState(false);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);
  const [syncIntervalMin, setSyncIntervalMin] = useState(15);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err' | 'warn'; text: string } | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/mywhoosh/status');
      const d = await res.json();
      if (d.status) {
        setStatus(d.status);
        setAutoSyncEnabled(Boolean(d.status.autoSyncEnabled));
        setSyncIntervalMin(Number(d.status.syncIntervalMin || 15));
        if (d.status.email) {
          setEmail((prev) => prev || d.status.email);
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    setConnecting(true);
    setNotice(null);
    try {
      const res = await fetch('/api/mywhoosh/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          rememberPassword,
          autoSyncEnabled,
          syncIntervalMin,
          syncNow: true,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setNotice({ type: 'err', text: d.error || 'No se pudo conectar con MyWhoosh.' });
      } else {
        setStatus(d.status);
        setPassword('');
        if (d.syncError) {
          setNotice({ type: 'warn', text: `Conectado con éxito, pero la descarga inicial avisó: ${d.syncError}` });
        } else if (d.syncResult) {
          const r = d.syncResult;
          setNotice({
            type: r.failed > 0 && r.imported === 0 ? 'warn' : 'ok',
            text: `¡MyWhoosh conectado! ${r.imported} nuevas sesiones importadas (${r.skipped} ya existentes de ${r.totalFetched} revisadas${r.failed > 0 ? `, ${r.failed} con aviso` : ''}).`,
          });
        } else {
          setNotice({ type: 'ok', text: '¡Cuenta de MyWhoosh conectada directamente!' });
        }
        onSynced?.();
      }
    } finally {
      setConnecting(false);
    }
  }

  async function handleSync(syncAll = false) {
    setSyncing(true);
    setNotice(null);
    try {
      const res = await fetch('/api/mywhoosh/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          limit: syncAll ? 500 : 30,
          maxPages: syncAll ? 50 : 5,
          syncAll,
          retryFailed: true,
        }),
      });
      const d = await res.json();
      if (d.status) setStatus(d.status);
      if (!res.ok) {
        setNotice({ type: 'err', text: d.error || 'Error al sincronizar con MyWhoosh.' });
      } else {
        const extraErr = d.errors?.length ? ` · Avisos: ${d.errors[0]}` : '';
        setNotice({
          type: d.failed > 0 && d.imported === 0 ? 'warn' : 'ok',
          text: `Sincronización MyWhoosh completada: ${d.imported} nuevas sesiones importadas (${d.skipped} ya existentes de ${d.totalFetched} revisadas${d.failed > 0 ? `, ${d.failed} fallidas` : ''})${extraErr}`,
        });
        onSynced?.();
      }
    } finally {
      setSyncing(false);
    }
  }

  async function handleToggleAutoSync(nextEnabled: boolean, nextInterval = syncIntervalMin) {
    setAutoSyncEnabled(nextEnabled);
    setSyncIntervalMin(nextInterval);
    const res = await fetch('/api/mywhoosh/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoSyncEnabled: nextEnabled, syncIntervalMin: nextInterval }),
    });
    const d = await res.json();
    if (d.status) setStatus(d.status);
  }

  async function handleDisconnect() {
    setNotice(null);
    const res = await fetch('/api/mywhoosh/disconnect', { method: 'POST' });
    const d = await res.json();
    if (d.status) setStatus(d.status);
    setPassword('');
    setNotice({
      type: 'ok',
      text: 'Cuenta de MyWhoosh desvinculada. Tus actividades ya importadas siguen guardadas en Bilifit.',
    });
  }

  if (loading) {
    return <div className="card-surface p-5 animate-pulse h-48" />;
  }

  const needsReconnect = status?.lastSyncStatus === 'needs_reconnect';
  const showLoginForm = !status?.connected || needsReconnect;

  return (
    <div className="card-surface p-5 space-y-4 border-cyan-500/25">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold flex items-center gap-2">
            <Zap className="h-5 w-5 text-cyan-400" />
            Conexión Directa Nativa con MyWhoosh (Sin Strava)
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            Descarga automáticamente tus archivos .FIT / .GPX originales desde MyWhoosh con vatios, cadencia, pulso, vueltas y mundo virtual.
          </p>
        </div>

        <span
          className={`text-xs font-semibold px-3 py-1 rounded-full border ${
            needsReconnect
              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30'
              : status?.connected
                ? 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30'
                : 'bg-sunken text-ink3 border-line'
          }`}
        >
          {needsReconnect
            ? 'Sesión caducada · Reconectar'
            : status?.connected
              ? `Conectado (${status.riderName || status.email || 'Rider'})`
              : 'No conectado'}
        </span>
      </div>

      {notice && (
        <div
          className={`rounded-xl border p-3.5 text-xs flex items-start gap-2.5 ${
            notice.type === 'ok'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : notice.type === 'warn'
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                : 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300'
          }`}
        >
          {notice.type === 'ok' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          )}
          <span>{notice.text}</span>
        </div>
      )}

      {showLoginForm ? (
        <form onSubmit={handleConnect} className="space-y-4">
          <div
            className="rounded-xl border p-3.5 text-xs space-y-1.5"
            style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
          >
            <div className="font-semibold text-cyan-700 dark:text-cyan-300 flex items-center gap-1.5">
              <Info className="h-4 w-4 shrink-0" />
              Acceso directo y gratuito (100% independiente de Strava)
            </div>
            <p>
              Usa el email y contraseña de tu cuenta de MyWhoosh. Si normalmente entrabas con el botón de{' '}
              <strong>Google o Apple</strong>, establece antes una contraseña en los ajustes de tu perfil de MyWhoosh.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                Email de MyWhoosh
              </label>
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu-email@ejemplo.com"
                className="w-full rounded-xl border px-3 py-2 text-sm"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                Contraseña de MyWhoosh
              </label>
              <input
                required
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full rounded-xl border px-3 py-2 text-sm"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <label
              className="flex items-start gap-2.5 rounded-xl border p-3 cursor-pointer"
              style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
            >
              <input
                type="checkbox"
                checked={rememberPassword}
                onChange={(e) => setRememberPassword(e.target.checked)}
                className="mt-0.5 rounded accent-cyan-400"
              />
              <span style={{ color: 'var(--text-secondary)' }}>
                <strong className="block text-ink">Recordar contraseña cifrada (AES-256)</strong>
                Opcional. Sin marcarla, los tokens ya se renuevan solos hasta 60 días tras cada uso.
              </span>
            </label>

            <div
              className="flex flex-col justify-between gap-2 rounded-xl border p-3"
              style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
            >
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoSyncEnabled}
                  onChange={(e) => setAutoSyncEnabled(e.target.checked)}
                  className="rounded accent-cyan-400"
                />
                <span className="font-semibold">Sincronización automática periódica</span>
              </label>
              <div className="flex items-center justify-between gap-2" style={{ color: 'var(--text-secondary)' }}>
                <span>Comprobar nuevas rutas cada:</span>
                <select
                  value={syncIntervalMin}
                  onChange={(e) => setSyncIntervalMin(Number(e.target.value))}
                  className="rounded-lg border px-2 py-1 text-xs"
                  style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
                >
                  <option value={10}>10 min</option>
                  <option value={15}>15 min</option>
                  <option value={30}>30 min</option>
                  <option value={60}>60 min</option>
                </select>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={connecting}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 px-5 py-2.5 text-sm font-bold text-slate-950 transition-colors"
            >
              {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              {connecting ? 'Conectando y descargando...' : 'Conectar y Sincronizar MyWhoosh'}
            </button>

            {needsReconnect && (
              <button
                type="button"
                onClick={handleDisconnect}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 px-4 py-2.5 text-xs font-semibold text-rose-400 hover:bg-rose-500/10"
              >
                <Unlink className="h-3.5 w-3.5" /> Desvincular sesión anterior
              </button>
            )}
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          {/* Resumen de cuenta conectada */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="rounded-xl border p-3" style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}>
              <div style={{ color: 'var(--text-muted)' }}>Cuenta / Rider</div>
              <div className="font-semibold truncate mt-0.5">{status.riderName || status.email || 'MyWhoosh'}</div>
              {status.whooshId && (
                <div className="text-[10px] truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  ID: {status.whooshId}
                </div>
              )}
            </div>

            <div className="rounded-xl border p-3" style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}>
              <div style={{ color: 'var(--text-muted)' }}>Sesiones MyWhoosh</div>
              <div className="font-bold text-cyan-400 text-sm tabular-nums mt-0.5">{status.importedCount}</div>
              <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                en tu SQLite local
              </div>
            </div>

            <div className="rounded-xl border p-3" style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}>
              <div style={{ color: 'var(--text-muted)' }}>FTP en MyWhoosh</div>
              <div className="font-bold text-sm tabular-nums mt-0.5">
                {status.ftpWatts ? `${status.ftpWatts} W` : '—'}
              </div>
              <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                {status.hasSavedPassword ? 'Re-login AES-256 activo' : 'Renovación por token'}
              </div>
            </div>

            <div className="rounded-xl border p-3" style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}>
              <div style={{ color: 'var(--text-muted)' }}>Última sincronización</div>
              <div className="font-semibold mt-0.5">
                {status.lastSyncAt
                  ? new Date(status.lastSyncAt).toLocaleString('es-ES', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : 'Pendiente'}
              </div>
              <div className="text-[10px] flex items-center gap-1 mt-0.5" style={{ color: 'var(--text-muted)' }}>
                <ShieldCheck className="h-3 w-3 text-emerald-400" />
                {status.hasEnvCredentials ? 'Vía .env' : 'Token cifrado local'}
              </div>
            </div>
          </div>

          {status.lastError && status.lastSyncStatus === 'error' && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              Último aviso: {status.lastError}
            </div>
          )}

          {/* Preferencia auto-sync */}
          <div
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-xs"
            style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
          >
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoSyncEnabled}
                onChange={(e) => handleToggleAutoSync(e.target.checked)}
                className="rounded accent-cyan-400"
              />
              <Clock className="h-3.5 w-3.5 text-cyan-400" />
              <span>Sincronización automática en segundo plano</span>
            </label>

            <div className="flex items-center gap-2">
              <span style={{ color: 'var(--text-muted)' }}>Intervalo:</span>
              <select
                value={syncIntervalMin}
                onChange={(e) => handleToggleAutoSync(autoSyncEnabled, Number(e.target.value))}
                className="rounded-lg border px-2 py-1 text-xs"
                style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
              >
                <option value={10}>Cada 10 min</option>
                <option value={15}>Cada 15 min</option>
                <option value={30}>Cada 30 min</option>
                <option value={60}>Cada 60 min</option>
              </select>
            </div>
          </div>

          {/* Botones de acción */}
          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <button
              type="button"
              disabled={syncing}
              onClick={() => handleSync(false)}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 px-5 py-2.5 text-sm font-bold text-slate-950 transition-colors"
            >
              {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {syncing ? 'Sincronizando MyWhoosh...' : 'Sincronizar MyWhoosh Ahora'}
            </button>

            <button
              type="button"
              disabled={syncing}
              onClick={() => handleSync(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500/20 disabled:opacity-50 px-4 py-2.5 text-xs font-semibold text-cyan-700 dark:text-cyan-300 transition-colors"
            >
              <History className="h-3.5 w-3.5" /> Importar todo el historial
            </button>

            {status.recentImports.length > 0 && (
              <button
                type="button"
                onClick={() => setShowLogs((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2.5 text-xs font-medium hover:bg-slate-500/10"
                style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
              >
                {showLogs ? 'Ocultar registro' : `Registro (${status.recentImports.length})`}
              </button>
            )}

            <button
              type="button"
              onClick={handleDisconnect}
              className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 px-3.5 py-2.5 text-xs font-semibold text-rose-400 hover:bg-rose-500/10 ml-auto"
            >
              <Unlink className="h-3.5 w-3.5" /> Desconectar
            </button>
          </div>

          {showLogs && status.recentImports.length > 0 && (
            <div
              className="rounded-xl border divide-y text-xs overflow-hidden"
              style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
            >
              {status.recentImports.map((item) => (
                <div key={item.activityId} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{item.title}</div>
                    <div className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                      {item.startedAt ? new Date(item.startedAt).toLocaleString('es-ES') : 'Fecha N/D'}
                      {item.error ? ` · ${item.error}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        item.status === 'imported'
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          : item.status === 'skipped'
                            ? 'bg-sunken text-ink2'
                            : 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                      }`}
                    >
                      {item.status === 'imported' ? 'Importada' : item.status === 'skipped' ? 'Omitida' : 'Error'}
                    </span>
                    {item.localActivityId && item.status === 'imported' && (
                      <Link href={`/actividades/${item.localActivityId}`} className="text-cyan-400 hover:underline font-medium">
                        Ver →
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
