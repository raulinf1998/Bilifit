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
      setNotice({ type: 'ok', text: '¡Cuenta de Strava vinculada correctamente! Ya puedes sincronizar tus actividades.' });
    } else if (qs.get('error')) {
      setNotice({ type: 'err', text: `Error en la autorización de Strava: ${qs.get('error')}` });
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
          <RefreshCw className="h-6 w-6 text-[#fc4c02]" />
          Vinculación con Strava e Importación Universal
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
          Conecta tu cuenta de Strava vía OAuth 2.0 para traer tus carreras, salidas MyWhoosh y montaña, o sube archivos directamente sin API.
        </p>
      </div>

      {notice && (
        <div
          className={`rounded-xl border p-4 text-sm flex items-start gap-2.5 ${
            notice.type === 'ok'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
          }`}
        >
          {notice.type === 'ok' ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : <AlertTriangle className="h-5 w-5 shrink-0" />}
          <span>{notice.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Bloque Strava OAuth */}
        <div className="lg:col-span-6 card-surface p-5 space-y-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold">Conexión Directa API de Strava (OAuth 2.0)</h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Sincroniza actividades, polilíneas GPS, potencia MyWhoosh, FC y streams.
              </p>
            </div>
            <span
              className={`text-xs font-semibold px-3 py-1 rounded-full border ${
                status?.connected
                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                  : 'bg-slate-500/15 text-slate-400 border-slate-500/30'
              }`}
            >
              {status?.connected ? `Conectado (${status.athleteName ?? 'Atleta'})` : 'No vinculado'}
            </span>
          </div>

          {/* Guía rápida */}
          <div className="rounded-xl border p-3.5 text-xs space-y-2" style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}>
            <div className="font-semibold flex items-center gap-1.5 text-amber-300">
              <ShieldAlert className="h-4 w-4" />
              Cómo configurar tu propia app de Strava:
            </div>
            <ol className="list-decimal pl-4 space-y-1" style={{ color: 'var(--text-secondary)' }}>
              <li>
                Entra en{' '}
                <a
                  href="https://www.strava.com/settings/api"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#fc4c02] underline inline-flex items-center gap-0.5"
                >
                  strava.com/settings/api <ExternalLink className="h-3 w-3" />
                </a>{' '}
                y crea una aplicación (requiere suscripción Strava activa en el programa Standard desde junio 2026).
              </li>
              <li>
                Pon como <strong>Authorization Callback Domain</strong> el dominio de esta app (por ejemplo{' '}
                <code className="px-1 py-0.5 rounded bg-slate-800 text-cyan-300">
                  {status?.redirectUriHint ? new URL(status.redirectUriHint).host : 'tu-dominio'}
                </code>
                ).
              </li>
              <li>Introduce tu Client ID y Client Secret abajo (o en `.env.local`) y pulsa conectar.</li>
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
                className="rounded-xl border px-4 py-2 text-xs font-semibold hover:bg-slate-500/10"
                style={{ borderColor: 'var(--border-subtle)' }}
              >
                {savingCreds ? 'Guardando...' : 'Guardar Credenciales API'}
              </button>
            </form>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
            {status?.configured && !status?.connected && (
              <a
                href="/api/strava/auth"
                className="inline-flex items-center gap-2 rounded-xl bg-[#fc4c02] hover:bg-[#e54400] px-5 py-2.5 text-sm font-bold text-white"
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
                  className="inline-flex items-center gap-2 rounded-xl bg-[#fc4c02] hover:bg-[#e54400] px-5 py-2.5 text-sm font-bold text-white"
                >
                  {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {syncing ? 'Sincronizando...' : 'Sincronizar Actividades Ahora'}
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

          {status?.lastSyncAt && (
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Última sincronización: {new Date(status.lastSyncAt).toLocaleString('es-ES')}
            </div>
          )}
        </div>

        {/* Bloque Importador Universal sin API */}
        <div className="lg:col-span-6 card-surface p-5 space-y-4">
          <div>
            <h2 className="text-base font-bold">Importador Universal Sin API (.FIT / .GPX / .TCX / .ZIP)</h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              ¿No quieres pagar suscripción de Strava para usar su API? Exporta tu historial desde Strava en un{' '}
              <strong>.ZIP</strong>, descarga los archivos <strong>.GPX / .FIT</strong> de <strong>MyWhoosh</strong> o de tu reloj GPS y súbelos aquí sin límites.
            </p>
          </div>
          <ActivityImporter />
        </div>
      </div>
    </div>
  );
}
