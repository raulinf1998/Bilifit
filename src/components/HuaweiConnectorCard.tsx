'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  FolderSync,
  HardDrive,
  Loader2,
  RefreshCw,
  Settings2,
  Unlink,
  Upload,
  Watch,
} from 'lucide-react';
import type { HuaweiConnectionStatus } from '@/types';

interface DriveFolderOption {
  id: string;
  name: string;
  modifiedTime?: string;
}

export default function HuaweiConnectorCard({
  onSynced,
}: {
  onSynced?: () => void;
}) {
  const [status, setStatus] = useState<HuaweiConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [watchDir, setWatchDir] = useState('');
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleClientSecret, setGoogleClientSecret] = useState('');
  const [folders, setFolders] = useState<DriveFolderOption[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncingMode, setSyncingMode] = useState<'auto' | 'folder' | 'drive' | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showGoogleSetup, setShowGoogleSetup] = useState(false);
  const [isLocalHostIp, setIsLocalHostIp] = useState(false);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    setIsLocalHostIp(/^\d{1,3}(\.\d{1,3}){3}$/.test(window.location.hostname));
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/huawei/status');
      const data = await res.json();
      if (data.status) {
        const s = data.status as HuaweiConnectionStatus;
        setStatus(s);
        setWatchDir((prev) => prev || s.watchDir || '');
        if (s.googleClientId) {
          setGoogleClientId((prev) => prev || s.googleClientId || '');
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDriveFolders = useCallback(async () => {
    setLoadingFolders(true);
    try {
      const res = await fetch('/api/huawei/google/folders');
      const data = await res.json();
      if (res.ok && Array.isArray(data.folders)) {
        setFolders(data.folders);
      }
    } finally {
      setLoadingFolders(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (status?.googleConnected && folders.length === 0) {
      void loadDriveFolders();
    }
  }, [status?.googleConnected, folders.length, loadDriveFolders]);

  async function savePreferences(patch: Record<string, unknown>, okMessage?: string) {
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch('/api/huawei/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice({ type: 'err', text: data.error || 'Error guardando configuración.' });
      } else {
        setStatus(data.status);
        if (patch.googleClientSecret) setGoogleClientSecret('');
        if (okMessage) setNotice({ type: 'ok', text: okMessage });
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleSync(mode: 'auto' | 'folder' | 'drive') {
    setSyncingMode(mode);
    setNotice(null);
    try {
      const res = await fetch('/api/huawei/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, limit: 60, retryFailed: true }),
      });
      const data = await res.json();
      if (data.status) setStatus(data.status);
      if (!res.ok) {
        setNotice({ type: 'err', text: data.error || 'No se pudo sincronizar Huawei Health.' });
      } else {
        setNotice({
          type: 'ok',
          text: `Huawei Health sincronizado: ${data.imported} nueva(s) importada(s), ${data.skipped} ya existentes (${data.scanned} revisadas).`,
        });
        onSynced?.();
      }
    } finally {
      setSyncingMode(null);
    }
  }

  async function handleDisconnectDrive() {
    setNotice(null);
    const res = await fetch('/api/huawei/disconnect', { method: 'POST' });
    const data = await res.json();
    if (data.status) setStatus(data.status);
    setFolders([]);
    setNotice({ type: 'ok', text: 'Google Drive desconectado. Tus actividades locales se conservan.' });
  }

  async function handleDirectHuaweiUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length === 0) return;
    setUploading(true);
    setNotice(null);
    try {
      const fd = new FormData();
      for (const f of picked) fd.append('files', f);
      const res = await fetch('/api/import', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) {
        setNotice({ type: 'err', text: data.error || 'Error procesando exportación de Huawei.' });
      } else {
        setNotice({
          type: 'ok',
          text: `Importación Huawei: ${data.imported} actividad(es) nueva(s) · ${data.skipped} duplicadas.${
            data.errors?.length ? ` Avisos: ${data.errors.join(' | ')}` : ''
          }`,
        });
        await loadStatus();
        onSynced?.();
      }
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  if (loading || !status) {
    return (
      <div className="card-surface p-5 animate-pulse space-y-3">
        <div className="h-6 w-64 rounded bg-slate-800/50" />
        <div className="h-24 rounded-xl bg-slate-800/40" />
      </div>
    );
  }

  return (
    <div className="card-surface p-5 space-y-5">
      {/* Cabecera */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shrink-0">
            <Watch className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold">Huawei Watch / Huawei Health (Sin Strava)</h2>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                Health Sync · Privacidad ZIP · HiTrack
              </span>
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              Sincroniza tus carreras, caminatas y rutas del reloj Huawei desde tu carpeta automática o Google Drive (agrupa
              automáticamente .fit/.tcx/.gpx de Health Sync y extrae títulos y pasos del .csv).
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`text-xs font-semibold px-3 py-1 rounded-full border ${
              status.googleConnected
                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                : status.watchDirExists && status.watchDirFileCount > 0
                  ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                  : 'bg-slate-500/15 text-slate-400 border-slate-500/30'
            }`}
          >
            {status.googleConnected
              ? `Drive: ${status.driveFolderName || 'Conectado'}`
              : status.watchDirFileCount > 0
                ? `Carpeta lista (${status.watchDirFileCount})`
                : 'Listo para configurar'}
          </span>
        </div>
      </div>

      {/* KPIs de estado */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div
          className="rounded-xl border p-3"
          style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
        >
          <div style={{ color: 'var(--text-muted)' }}>Sesiones Huawei</div>
          <div className="font-bold text-sm mt-0.5 tabular-nums text-emerald-400">{status.importedCount}</div>
        </div>
        <div
          className="rounded-xl border p-3"
          style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
        >
          <div style={{ color: 'var(--text-muted)' }}>En carpeta local</div>
          <div className="font-bold text-sm mt-0.5 tabular-nums">{status.watchDirFileCount} sesiones</div>
        </div>
        <div
          className="rounded-xl border p-3"
          style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
        >
          <div style={{ color: 'var(--text-muted)' }}>Auto-sync</div>
          <div className="font-bold text-sm mt-0.5">
            {status.autoSyncEnabled ? `Cada ${status.syncIntervalMin} min` : 'Manual'}
          </div>
        </div>
        <div
          className="rounded-xl border p-3"
          style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
        >
          <div style={{ color: 'var(--text-muted)' }}>Última sync</div>
          <div className="font-bold text-sm mt-0.5 truncate">
            {status.lastSyncAt
              ? new Date(status.lastSyncAt).toLocaleString('es-ES', {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : 'Nunca'}
          </div>
        </div>
      </div>

      {notice && (
        <div
          className={`rounded-xl border p-3 text-xs flex items-start gap-2 ${
            notice.type === 'ok'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
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

      {status.lastError && !notice && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-300 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>Último aviso: {status.lastError}</span>
        </div>
      )}

      {/* Canales de sincronización directa */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Canal 1: Carpeta local automática / rclone Docker */}
        <div
          className="rounded-xl border p-4 space-y-3"
          style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-semibold text-sm">
              <HardDrive className="h-4 w-4 text-emerald-400" />
              1. Carpeta Automática Docker / rclone
            </div>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300">
              Recomendado LAN
            </span>
          </div>

          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Si usas <strong>Health Sync → Google Drive</strong>, sincroniza la carpeta{' '}
            <code>Health Sync/Health Sync Actividades</code> hacia este volumen local con <code>rclone</code> o Syncthing sin
            configurar apps en Google Cloud:
          </p>

          <div className="flex gap-2">
            <input
              value={watchDir}
              onChange={(e) => setWatchDir(e.target.value)}
              placeholder="/app/data/huawei-sync"
              className="flex-1 rounded-lg border px-3 py-1.5 text-xs font-mono"
              style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
            />
            <button
              type="button"
              disabled={saving}
              onClick={() => void savePreferences({ watchDir }, 'Carpeta de sincronización guardada.')}
              className="rounded-lg border px-3 py-1.5 text-xs font-semibold hover:bg-slate-500/10"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              Guardar
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={status.autoSyncEnabled}
                onChange={(e) => void savePreferences({ autoSyncEnabled: e.target.checked })}
                className="rounded accent-emerald-500"
              />
              <span>Auto-escanear</span>
            </label>

            <div className="flex items-center gap-2">
              <select
                value={status.syncIntervalMin}
                onChange={(e) => void savePreferences({ syncIntervalMin: Number(e.target.value) })}
                className="rounded-lg border px-2 py-1 text-xs"
                style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
              >
                <option value={10}>10 min</option>
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
                <option value={60}>1 h</option>
              </select>

              <button
                type="button"
                disabled={syncingMode !== null}
                onClick={() => void handleSync('folder')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-3 py-1.5 text-xs font-semibold text-white"
              >
                {syncingMode === 'folder' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FolderSync className="h-3.5 w-3.5" />
                )}
                Escanear carpeta
              </button>
            </div>
          </div>

          <details className="text-[11px] pt-1" style={{ color: 'var(--text-secondary)' }}>
            <summary className="cursor-pointer font-semibold text-emerald-300">
              Ver comando rclone 1-línea para Proxmox (192.168.1.47)
            </summary>
            <div className="mt-2 space-y-1.5">
              <p>Ejecuta en tu cron de Proxmox (tras configurar <code>rclone config</code> una sola vez con Drive):</p>
              <pre
                className="rounded-lg p-2 overflow-x-auto text-[10px] border"
                style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
              >{`rclone copy "gdrive:Health Sync/Health Sync Actividades" ./data/huawei-sync`}</pre>
            </div>
          </details>
        </div>

        {/* Canal 2: Google Drive OAuth Directo */}
        <div
          className="rounded-xl border p-4 space-y-3"
          style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-semibold text-sm">
              <Cloud className="h-4 w-4 text-cyan-400" />
              2. Google Drive Directo (OAuth)
            </div>
            {status.googleConnected && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300">
                Conectado
              </span>
            )}
          </div>

          {status.googleConnected ? (
            <div className="space-y-3">
              <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Cuenta: <strong className="text-slate-200">{status.googleAccountEmail || 'Google Drive'}</strong>
              </div>

              <div className="flex gap-2">
                <select
                  value={status.driveFolderId || ''}
                  onChange={(e) => {
                    const chosen = folders.find((f) => f.id === e.target.value);
                    void savePreferences(
                      {
                        driveFolderId: e.target.value || null,
                        driveFolderName: chosen?.name ?? null,
                      },
                      'Carpeta de Google Drive actualizada.'
                    );
                  }}
                  className="flex-1 rounded-lg border px-2.5 py-1.5 text-xs"
                  style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
                >
                  <option value="">Selecciona carpeta (ej. Health Sync Actividades)...</option>
                  {status.driveFolderId && !folders.some((f) => f.id === status.driveFolderId) && (
                    <option value={status.driveFolderId}>{status.driveFolderName || status.driveFolderId}</option>
                  )}
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  disabled={loadingFolders}
                  onClick={() => void loadDriveFolders()}
                  className="rounded-lg border px-2.5 py-1.5 text-xs hover:bg-slate-500/10"
                  style={{ borderColor: 'var(--border-subtle)' }}
                  title="Recargar carpetas"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loadingFolders ? 'animate-spin' : ''}`} />
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={syncingMode !== null || !status.driveFolderId}
                  onClick={() => void handleSync('drive')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  {syncingMode === 'drive' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Sincronizar Drive ahora
                </button>
                <button
                  type="button"
                  onClick={() => void handleDisconnectDrive()}
                  className="inline-flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/20"
                >
                  <Unlink className="h-3.5 w-3.5" />
                  Desconectar
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Conecta tu Google Drive para leer directamente la carpeta <code>Health Sync Actividades</code> (solo lectura).
              </p>

              {isLocalHostIp && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11px] text-amber-200">
                  Nota: Google Cloud OAuth no acepta IPs privadas como <code>192.168.1.47</code> en la URL de redirección (pide{' '}
                  <code>localhost</code> o un dominio local). Si entras por IP local, el método 1 (<code>rclone</code> →{' '}
                  <code>./data/huawei-sync</code>) es más directo y no requiere app en Google Cloud.
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {status.googleConfigured && (
                  <a
                    href="/api/huawei/google/auth"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    <Cloud className="h-3.5 w-3.5" />
                    Autorizar Google Drive
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setShowGoogleSetup((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold hover:bg-slate-500/10"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  {status.googleConfigured ? 'Cambiar Client ID' : 'Configurar Google OAuth'}
                </button>
              </div>

              {(showGoogleSetup || !status.googleConfigured) && (
                <div className="space-y-2 pt-1">
                  {status.googleRedirectUriHint && (
                    <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      Redirect URI: <code className="text-cyan-300">{status.googleRedirectUriHint}</code>
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      value={googleClientId}
                      onChange={(e) => setGoogleClientId(e.target.value)}
                      placeholder="Google Client ID"
                      className="rounded-lg border px-2.5 py-1.5 text-xs"
                      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
                    />
                    <input
                      type="password"
                      value={googleClientSecret}
                      onChange={(e) => setGoogleClientSecret(e.target.value)}
                      placeholder="Google Client Secret"
                      className="rounded-lg border px-2.5 py-1.5 text-xs"
                      style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={saving || !googleClientId.trim() || !googleClientSecret.trim()}
                    onClick={() =>
                      void savePreferences(
                        { googleClientId, googleClientSecret },
                        'Credenciales de Google OAuth guardadas. Ya puedes pulsar "Autorizar Google Drive".'
                      )
                    }
                    className="rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    Guardar credenciales OAuth
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Canal 3: Subida directa de exportación Huawei Privacy ZIP / HiTrack / Health Sync */}
      <div
        className="rounded-xl border p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
      >
        <div className="text-xs space-y-0.5">
          <div className="font-semibold">3. Subida Directa de Archivo Huawei (.zip de Privacidad / HiTrack / Health Sync)</div>
          <div style={{ color: 'var(--text-secondary)' }}>
            En Huawei Health: <strong>Yo → Centro de privacidad → Solicitar tus datos</strong> y sube aquí el <code>.zip</code> o{' '}
            <code>motion path detail data.json</code> o cualquier <code>HiTrack_*</code>.
          </div>
        </div>
        <label className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-2 text-xs font-semibold text-white cursor-pointer shrink-0">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {uploading ? 'Importando...' : 'Subir ZIP / HiTrack'}
          <input
            type="file"
            multiple
            accept=".zip,.json,.fit,.tcx,.gpx,.gz,.csv"
            className="hidden"
            onChange={handleDirectHuaweiUpload}
          />
        </label>
      </div>

      {/* Historial reciente de imports */}
      {status.recentImports.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
            Últimos elementos revisados de Huawei Health
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {status.recentImports.slice(0, 6).map((item) => (
              <div
                key={item.itemKey}
                className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs"
                style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{item.title}</div>
                  <div className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                    {item.channel === 'drive' ? 'Drive' : 'Carpeta'} ·{' '}
                    {item.startedAt
                      ? new Date(item.startedAt).toLocaleDateString('es-ES', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })
                      : item.fileName}
                  </div>
                </div>
                <span
                  className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                    item.status === 'imported'
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : item.status === 'skipped'
                        ? 'bg-slate-500/15 text-slate-300 border-slate-500/30'
                        : 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                  }`}
                >
                  {item.status === 'imported' ? 'Importada' : item.status === 'skipped' ? 'Duplicada' : 'Error'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
