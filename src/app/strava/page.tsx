'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Link2,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Unlink,
} from 'lucide-react';
import ActivityImporter from '@/components/ActivityImporter';
import HuaweiConnectorCard from '@/components/HuaweiConnectorCard';
import MyWhooshConnectorCard from '@/components/MyWhooshConnectorCard';
import type { StravaConnectionStatus } from '@/types';

export default function StravaAndImportPage() {
  const [status, setStatus] = useState<StravaConnectionStatus | null>(null);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [savingCreds, setSavingCreds] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadStatus = useCallback(async () => {
    const res = await fetch('/api/strava/status');
    const d = await res.json();
    if (d.status) {
      setStatus(d.status);
      if (d.status.clientId) setClientId(d.status.clientId);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const qs = new URLSearchParams(window.location.search);
    if (qs.get('connected') === '1') {
      setNotice({ type: 'ok', text: '¡Cuenta de Strava vinculada correctamente!' });
    } else if (qs.get('error')) {
      setNotice({ type: 'err', text: `Error en Strava: ${qs.get('error')}` });
    } else if (qs.get('huawei_connected') === '1') {
      setNotice({ type: 'ok', text: '¡Google Drive vinculado para Huawei Health! Ya puedes sincronizar tus entrenos.' });
    } else if (qs.get('huawei_error')) {
      setNotice({ type: 'err', text: `Error conectando Google Drive: ${qs.get('huawei_error')}` });
    }
  }, [loadStatus]);

  async function handleSaveCredentials(e: React.FormEvent) {
    e.preventDefault();
    setSavingCreds(true);
    setNotice(null);
    try {
      const res = await fetch('/api/strava/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret }),
      });
      const d = await res.json();
      if (!res.ok) {
        setNotice({ type: 'err', text: d.error || 'Error guardando credenciales' });
      } else {
        setStatus(d.status);
        setClientSecret('');
        setNotice({ type: 'ok', text: 'Credenciales de Strava guardadas. Pulsa "Conectar con Strava" para autorizar.' });
      }
    } finally {
      setSavingCreds(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setNotice(null);
    try {
      const res = await fetch('/api/strava/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 30 }),
      });
      const d = await res.json();
      if (!res.ok) {
        setNotice({ type: 'err', text: d.error || 'No se pudo sincronizar con Strava' });
      } else {
        setNotice({
          type: 'ok',
          text: `Sincronización completada: ${d.imported} nuevas actividades importadas (${d.skipped} ya existentes de ${d.totalFetched} revisadas).`,
        });
        await loadStatus();
      }
    } finally {
      setSyncing(false);
    }
  }

  async function handleDisconnect() {
    const res = await fetch('/api/strava/disconnect', { method: 'POST' });
    const d = await res.json();
    setStatus(d.status);
    setNotice({ type: 'ok', text: 'Sesión de Strava desvinculada.' });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
          <RefreshCw className="h-6 w-6 text-primary" />
          Conexiones Directas e Importación (Sin Strava)
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          Conecta <strong>MyWhoosh</strong> y tu reloj <strong>Huawei / Huawei Health</strong> directamente en local, o sube archivos{' '}
          <code>.FIT</code> / <code>.GPX</code> / <code>.TCX</code> / <code>.ZIP</code>.
        </p>
      </div>

      {notice && (
        <div
          className={`rounded-xl border p-4 text-sm flex items-start gap-2.5 ${
            notice.type === 'ok'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300'
          }`}
        >
          {notice.type === 'ok' ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : <AlertTriangle className="h-5 w-5 shrink-0" />}
          <span>{notice.text}</span>
        </div>
      )}

      {/* 1. Conexión directa nativa MyWhoosh */}
      <MyWhooshConnectorCard />

      {/* 2. Conexión directa Huawei Watch / Huawei Health */}
      <HuaweiConnectorCard />

      {/* 3. Importador Universal manual */}
      <div className="card-surface p-5 space-y-4">
        <div>
          <h2 className="text-base font-bold">Importador Universal Manual (.FIT / .GPX / .TCX / .ZIP / Huawei)</h2>
          <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
            Sube archivos sueltos o un lote de <strong>Health Sync</strong> (agrupa automáticamente <code>.fit</code> +{' '}
            <code>.tcx</code> + <code>.gpx</code> + <code>.csv</code> sin duplicar), exportaciones <code>.zip</code> de Huawei
            Privacidad, ficheros <code>HiTrack_*</code> o rutas de MyWhoosh.
          </p>
        </div>
        <ActivityImporter />
      </div>

      {/* 4. Strava (Legado / Opcional, colapsado salvo si está conectado) */}
      <details
        open={Boolean(status?.connected)}
        className="card-surface p-5 space-y-4"
      >
        <summary className="cursor-pointer list-none flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>
              Strava API OAuth 2.0 (Legado · Opcional)
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Innecesario si usas MyWhoosh y Huawei Health directamente. Manténlo plegado o úsalo solo para migrar historial antiguo.
            </p>
          </div>
          <span
            className={`text-xs font-semibold px-3 py-1 rounded-full border ${
              status?.connected
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
                : 'bg-sunken text-ink3 border-line'
            }`}
          >
            {status?.connected ? `Conectado (${status.athleteName ?? 'Atleta'})` : 'Opcional · No vinculado'}
          </span>
        </summary>

        <div className="pt-3 space-y-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          <div className="rounded-xl border p-3.5 text-xs space-y-2" style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}>
            <div className="font-semibold flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
              <ShieldAlert className="h-4 w-4" />
              Solo si quieres conectar tu propia app de Strava:
            </div>
            <ol className="list-decimal pl-4 space-y-1" style={{ color: 'var(--text-secondary)' }}>
              <li>
                Entra en{' '}
                <a
                  href="https://www.strava.com/settings/api"
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline inline-flex items-center gap-0.5"
                >
                  strava.com/settings/api <ExternalLink className="h-3 w-3" />
                </a>{' '}
                y crea una aplicación.
              </li>
              <li>
                Authorization Callback Domain:{' '}
                <code className="px-1 py-0.5 rounded bg-sunken text-cyan-700 dark:text-cyan-300">
                  {status?.redirectUriHint ? new URL(status.redirectUriHint).hostname : '192.168.1.47'}
                </code>
              </li>
            </ol>
          </div>

          {!status?.hasEnvCredentials && (
            <form onSubmit={handleSaveCredentials} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                    Strava Client ID
                  </label>
                  <input
                    required
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder="Ej. 123456"
                    className="w-full rounded-xl border px-3 py-2 text-sm"
                    style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
                    Strava Client Secret
                  </label>
                  <input
                    required
                    type="password"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    placeholder={status?.configured ? '•••••••••••• (guardado)' : 'Tu Client Secret'}
                    className="w-full rounded-xl border px-3 py-2 text-sm"
                    style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={savingCreds}
                className="rounded-xl border px-4 py-2 text-xs font-semibold hover:bg-sunken"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                {savingCreds ? 'Guardando...' : 'Guardar Credenciales API'}
              </button>
            </form>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {status?.configured && !status?.connected && (
              <a
                href="/api/strava/auth"
                className="inline-flex items-center gap-2 rounded-xl bg-primary hover:bg-primaryhover px-5 py-2.5 text-sm font-bold text-onprimary"
              >
                <Link2 className="h-4 w-4" /> Conectar con Strava
              </a>
            )}

            {status?.connected && (
              <>
                <button
                  type="button"
                  disabled={syncing}
                  onClick={handleSync}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary hover:bg-primaryhover px-5 py-2.5 text-sm font-bold text-onprimary"
                >
                  {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {syncing ? 'Sincronizando...' : 'Sincronizar Strava'}
                </button>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/30 px-4 py-2.5 text-xs font-semibold text-rose-400 hover:bg-rose-500/10"
                >
                  <Unlink className="h-3.5 w-3.5" /> Desconectar
                </button>
              </>
            )}
          </div>
        </div>
      </details>
    </div>
  );
}
