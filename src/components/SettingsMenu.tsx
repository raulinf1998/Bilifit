'use client';

import { useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Flag,
  Moon,
  Palette,
  RefreshCw,
  Settings,
  Sliders,
  Sun,
  Upload,
  Users,
} from 'lucide-react';
import type { SettingsSyncStatus } from '@/hooks/useServerSettings';
import type { ReloadActivitiesResult } from '@/lib/reprocess';
import { THEMES, type ThemeId } from '@/lib/themes';
import { Modal, cx } from '@/components/ui';

interface SettingsMenuProps {
  theme: ThemeId;
  dark: boolean;
  darkModeLocked: boolean;
  accountName: string;
  onSwitchAccount: () => void;
  activePaletteName: string | null;
  settingsVersion: number;
  syncStatus: SettingsSyncStatus;
  syncError: string | null;
  lastSyncedAt: number | null;
  onToggleDark: () => void;
  onAppearance: () => void;
  onGoConnections: () => void;
  onGoAthleteSettings: () => void;
  onActivitiesReloaded?: () => void;
  onClose: () => void;
}

export function SettingsMenu({
  theme,
  dark,
  darkModeLocked,
  accountName,
  onSwitchAccount,
  activePaletteName,
  settingsVersion,
  syncStatus,
  syncError,
  lastSyncedAt,
  onToggleDark,
  onAppearance,
  onGoConnections,
  onGoAthleteSettings,
  onActivitiesReloaded,
  onClose,
}: SettingsMenuProps) {
  const [reloading, setReloading] = useState(false);
  const [reloadSummary, setReloadSummary] = useState<string | null>(null);
  const [reloadErr, setReloadErr] = useState<string | null>(null);

  async function handleReloadActivitiesAndSegments() {
    if (reloading) return;
    setReloading(true);
    setReloadErr(null);
    setReloadSummary(null);
    try {
      const res = await fetch('/api/activities/reload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reloadSources: true, detectClimbs: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setReloadErr(data.error || 'Error recargando actividades y segmentos.');
      } else {
        const summary = data as ReloadActivitiesResult;
        const newlyAdded =
          summary.sources.huawei.imported + summary.sources.mywhoosh.imported + summary.sources.strava.imported;
        const refreshed =
          summary.sources.huawei.updated + summary.sources.mywhoosh.updated + summary.sources.strava.updated;
        const parts = [`${summary.reprocessedActivities} actividades reprocesadas`];
        if (newlyAdded > 0) parts.push(`${newlyAdded} nuevas`);
        if (refreshed > 0) parts.push(`${refreshed} actualizadas desde fuente`);
        parts.push(
          `+${summary.segments.created} seg. nuevos (${summary.segments.total} totales, ${summary.segments.effortsMatched} PRs/pasadas)`
        );
        setReloadSummary(parts.join(' · '));
        window.dispatchEvent(new CustomEvent('bilifit:activities-reloaded'));
        onActivitiesReloaded?.();
      }
    } catch (err) {
      setReloadErr(err instanceof Error ? err.message : 'Error de red al recargar.');
    } finally {
      setReloading(false);
    }
  }
  const themeLabel = THEMES.find((item) => item.id === theme)?.label || theme;
  const appearanceSummary = activePaletteName
    ? `Paleta «${activePaletteName}» · ${dark ? 'oscuro' : 'claro'}`
    : `${themeLabel} · ${dark ? 'oscuro' : 'claro'}`;

  const syncCopy = getSyncCopy(syncStatus, syncError, lastSyncedAt);

  return (
    <Modal title="Ajustes" icon={<Settings size={17} />} onClose={onClose} maxWidth="max-w-md">
      <div className="space-y-2.5">
        <SettingsRow
          icon={<Users size={19} />}
          title={`Perfil: ${accountName}`}
          description="Cambiar al otro perfil (Raúl / Pequeñaja)"
          onClick={onSwitchAccount}
        />
        <SettingsRow
          icon={<Palette size={19} />}
          title="Apariencia"
          description={appearanceSummary}
          onClick={onAppearance}
        />

        <button
          type="button"
          onClick={onToggleDark}
          disabled={darkModeLocked}
          aria-pressed={dark}
          className={cx(
            'w-full flex items-center gap-3 rounded-btn border border-line bg-sunken/55 px-3.5 py-3 text-left transition-all',
            darkModeLocked
              ? 'opacity-60 cursor-not-allowed'
              : 'hover:border-line2 hover:bg-sunken active:scale-[0.99]'
          )}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-btn bg-accent/10 text-accent">
            {dark ? <Moon size={19} /> : <Sun size={19} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-ink">Modo claro / oscuro</span>
            <span className="mt-0.5 block truncate text-xs text-ink3">
              {darkModeLocked
                ? 'El tema Nocturno integrado siempre es oscuro'
                : dark
                  ? 'Oscuro activado · toca para pasar a claro'
                  : 'Claro activado · toca para pasar a oscuro'}
            </span>
          </span>
          <span
            aria-hidden
            className={cx(
              'relative h-6 w-11 shrink-0 rounded-full transition-colors',
              dark ? 'bg-primary' : 'bg-line2'
            )}
          >
            <span
              className={cx(
                'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
                dark ? 'left-[22px]' : 'left-0.5'
              )}
            />
          </span>
        </button>

        <SettingsRow
          icon={<Upload size={19} />}
          title="Conexiones e Importar"
          description="Google Drive, Huawei Health, MyWhoosh, Strava"
          onClick={onGoConnections}
        />
        <SettingsRow
          icon={<Sliders size={19} />}
          title="Ajustes del atleta"
          description="Peso, FTP, zonas de pulso y objetivos"
          onClick={onGoAthleteSettings}
        />

        <button
          type="button"
          disabled={reloading}
          onClick={handleReloadActivitiesAndSegments}
          className="w-full flex items-center gap-3 rounded-btn border border-line bg-sunken/55 px-3.5 py-3 text-left transition-all hover:border-line2 hover:bg-sunken active:scale-[0.99] disabled:opacity-60"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-btn bg-accent/10 text-accent">
            {reloading ? <RefreshCw size={19} className="animate-spin" /> : <Flag size={19} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-ink">
              {reloading ? 'Recargando actividades y segmentos…' : 'Recargar actividades y segmentos'}
            </span>
            <span className="mt-0.5 block text-xs text-ink3">
              {reloadErr
                ? reloadErr
                : reloadSummary
                  ? reloadSummary
                  : 'Refresca sesiones conectadas, recalcula métricas y busca segmentos/PRs'}
            </span>
          </span>
          <RefreshCw size={16} className={cx('shrink-0 text-ink3', reloading && 'animate-spin')} aria-hidden />
        </button>
      </div>

      <div
        className={cx(
          'mt-5 rounded-btn border px-3.5 py-3',
          syncStatus === 'error' || syncStatus === 'retrying'
            ? 'border-danger/35 bg-danger/10'
            : 'border-line bg-sunken/55'
        )}
        role="status"
        aria-live="polite"
      >
        <div className="flex items-start gap-3">
          <span
            className={cx(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-btn',
              syncStatus === 'error' || syncStatus === 'retrying'
                ? 'bg-danger/15 text-danger'
                : 'bg-accent/10 text-accent'
            )}
          >
            {syncCopy.icon}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ink">{syncCopy.title}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink3">
              Versión de ajustes del servidor #{settingsVersion}. {syncCopy.description}
            </p>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function getSyncCopy(
  status: SettingsSyncStatus,
  error: string | null,
  lastSyncedAt: number | null
): { title: string; description: string; icon: ReactNode } {
  if (status === 'saving') {
    return {
      title: 'Guardando en el servidor…',
      description: 'El cambio se está confirmando ahora mismo.',
      icon: <RefreshCw size={17} className="animate-spin" />,
    };
  }
  if (status === 'connecting') {
    return {
      title: 'Conectando con el servidor…',
      description: 'En cuanto responda, se aplicará la apariencia guardada.',
      icon: <RefreshCw size={17} className="animate-spin" />,
    };
  }
  if (status === 'retrying' || status === 'error') {
    return {
      title: status === 'retrying' ? 'Reintentando automáticamente…' : 'Todavía no confirmado por el servidor',
      description: `${error || 'No se pudo confirmar el último cambio.'} Bilifit seguirá reintentándolo solo.`,
      icon: <AlertTriangle size={17} />,
    };
  }

  const time = lastSyncedAt
    ? new Intl.DateTimeFormat('es-ES', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(new Date(lastSyncedAt))
    : null;

  return {
    title: 'Sincronizado con el servidor',
    description: time
      ? `Última confirmación a las ${time}. Los cambios llegan solos al PC y al teléfono.`
      : 'Los cambios llegan solos al PC y al teléfono.',
    icon: <CheckCircle2 size={17} />,
  };
}

function SettingsRow({
  icon,
  title,
  description,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 rounded-btn border border-line bg-sunken/55 px-3.5 py-3 text-left transition-all hover:border-line2 hover:bg-sunken active:scale-[0.99]"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-btn bg-accent/10 text-accent">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-ink">{title}</span>
        <span className="mt-0.5 block truncate text-xs text-ink3">{description}</span>
      </span>
      <ChevronRight size={17} className="shrink-0 text-ink3" aria-hidden />
    </button>
  );
}
