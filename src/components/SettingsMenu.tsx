'use client';

import type { ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
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
  onClose,
}: SettingsMenuProps) {
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
