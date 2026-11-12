'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowLeftRight,
  Bike,
  Dumbbell,
  Flag,
  LayoutDashboard,
  Moon,
  Mountain,
  Palette,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sun,
  Upload,
  Wrench,
} from 'lucide-react';
import { AccountProvider } from '@/components/AccountProvider';
import { ProfileChooser } from '@/components/ProfileChooser';
import { SettingsMenu } from '@/components/SettingsMenu';
import { ThemePicker } from '@/components/ThemePicker';
import { BrandMark, cx, iconBtn } from '@/components/ui';
import { useServerSettings } from '@/hooks/useServerSettings';
import { ACCOUNT_NAMES, otherAccountId, selectAccount, type AccountId } from '@/lib/accounts';
import { applyCustomPaletteToRoot } from '@/lib/theme-palettes';
import { THEMES, type AppSettings } from '@/lib/themes';

const NAV_ITEMS = [
  { href: '/', label: 'Panel', icon: LayoutDashboard },
  { href: '/actividades', label: 'Actividades', icon: Activity },
  { href: '/segmentos', label: 'Segmentos y PRs', icon: Flag },
  { href: '/ciclismo', label: 'MyWhoosh y Bici', icon: Bike },
  { href: '/montana', label: 'Rutas Montaña', icon: Mountain },
  { href: '/casa', label: 'Casa y Rutinas', icon: Dumbbell, highlight: true },
  { href: '/strava', label: 'Conexiones e Importar', icon: RefreshCw },
  { href: '/material', label: 'Zapatillas y Bicis', icon: Wrench },
  { href: '/ajustes', label: 'Ajustes Atleta', icon: Settings },
];

export default function AppShell({
  children,
  initialAccount,
  initialSettings,
}: {
  children: React.ReactNode;
  initialAccount: AccountId | null;
  initialSettings: AppSettings;
}) {
  if (!initialAccount) {
    return <ProfileChooser />;
  }

  return (
    <AccountProvider account={initialAccount}>
      <ActiveAppShell account={initialAccount} initialSettings={initialSettings}>
        {children}
      </ActiveAppShell>
    </AccountProvider>
  );
}

function ActiveAppShell({
  children,
  account,
  initialSettings,
}: {
  children: React.ReactNode;
  account: AccountId;
  initialSettings: AppSettings;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const {
    dark,
    setDark,
    theme,
    setTheme,
    customPalettes,
    activeCustomPalette,
    applyCustomPalette,
    saveCustomPalette,
    deleteCustomPalette,
    settingsVersion,
    settingsSyncStatus,
    settingsSyncError,
    settingsLastSyncedAt,
    refreshSettings,
  } = useServerSettings(initialSettings);

  const [showThemes, setShowThemes] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    if (showThemes) void refreshSettings();
  }, [refreshSettings, showThemes]);

  const firstRun = useRef(true);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const effectiveDark = activeCustomPalette ? dark : dark || theme === 'nocturno';
    let timeout: number | undefined;

    if (!firstRun.current) {
      root.classList.add('theme-anim');
      timeout = window.setTimeout(() => root.classList.remove('theme-anim'), 420);
    }
    firstRun.current = false;

    root.dataset.theme = theme;
    root.dataset.mode = effectiveDark ? 'dark' : 'light';
    root.classList.toggle('dark', effectiveDark);
    root.style.colorScheme = effectiveDark ? 'only dark' : 'only light';
    const colorSchemeMeta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
    if (colorSchemeMeta) colorSchemeMeta.content = effectiveDark ? 'only dark' : 'only light';
    applyCustomPaletteToRoot(activeCustomPalette, effectiveDark);

    return () => {
      if (timeout) window.clearTimeout(timeout);
    };
  }, [activeCustomPalette, dark, theme]);

  const isDark = activeCustomPalette ? dark : dark || theme === 'nocturno';
  const darkModeLocked = !activeCustomPalette && theme === 'nocturno';
  const accountName = ACCOUNT_NAMES[account];
  const otherAccount = otherAccountId(account);
  const otherName = ACCOUNT_NAMES[otherAccount];

  const handleSwitchAccount = () => {
    if (
      settingsSyncStatus !== 'synced' &&
      !window.confirm('Hay cambios de apariencia sin confirmar todavía en el servidor. ¿Cambiar de perfil igualmente?')
    ) {
      return;
    }
    selectAccount(otherAccount, pathname || '/');
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row text-ink">
      {/* Sidebar Desktop */}
      <aside className="hidden lg:flex lg:w-[272px] lg:flex-col lg:fixed lg:inset-y-0 border-r border-line bg-surface/85 backdrop-blur-xl z-40 overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <Link href="/" className="flex items-center gap-2.5 min-w-0">
            <BrandMark className="h-10 w-10 shadow-lift" />
            <div className="min-w-0">
              <div className="font-display font-bold text-lg leading-tight tracking-tight text-ink">Bilifit</div>
              <div className="text-[11px] text-ink3 truncate">Tu entrenamiento, a tu manera</div>
            </div>
          </Link>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            aria-label="Abrir ajustes y apariencia"
            title="Ajustes y apariencia"
            className={iconBtn}
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>

        {/* Selector de perfil activo */}
        <div className="px-4 pt-3.5 pb-1">
          <button
            type="button"
            onClick={handleSwitchAccount}
            title={`Cambiar a ${otherName}`}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-btn border border-line bg-sunken/60 hover:border-line2 hover:bg-sunken transition-all text-left"
          >
            <span className="flex items-center gap-2 min-w-0">
              <span className="h-6 w-6 rounded-full bg-primary text-onprimary text-xs font-extrabold flex items-center justify-center shrink-0">
                {accountName.charAt(0)}
              </span>
              <span className="min-w-0">
                <span className="block text-[10px] uppercase tracking-wider font-bold text-ink3 leading-none">
                  Perfil activo
                </span>
                <span className="block text-xs font-bold text-ink truncate mt-0.5">{accountName}</span>
              </span>
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent shrink-0">
              <ArrowLeftRight className="h-3.5 w-3.5" />
              {otherName}
            </span>
          </button>
        </div>

        <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto" aria-label="Secciones">
          {NAV_ITEMS.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cx(
                  'flex items-center justify-between px-3 py-2.5 rounded-btn text-sm font-semibold transition-all active:scale-[0.99]',
                  active
                    ? 'bg-accent/10 text-ink shadow-[inset_0_0_0_1px_rgb(var(--accent)/0.25)]'
                    : 'text-ink2 hover:bg-sunken hover:text-ink'
                )}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <span
                    className={cx(
                      'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors',
                      active ? 'bg-primary text-onprimary shadow-card' : 'bg-sunken text-ink3'
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                  </span>
                  <span className="truncate">{item.label}</span>
                </span>
                {item.highlight && !active && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-accent/10 text-accent shrink-0">
                    IA Local
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Apariencia rápida (estilo Read_nook_1) */}
        <div className="px-4 py-3.5 border-t border-line">
          <div className="flex items-center justify-between px-1 mb-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink3">Tema</p>
            <div className="flex items-center gap-1">
              {!darkModeLocked && (
                <button
                  type="button"
                  onClick={() => setDark(!isDark)}
                  className="p-1.5 rounded-lg text-ink3 hover:text-ink hover:bg-sunken transition-colors"
                  aria-label={isDark ? 'Modo claro' : 'Modo oscuro'}
                  title={isDark ? 'Modo claro' : 'Modo oscuro'}
                >
                  {isDark ? <Sun size={15} /> : <Moon size={15} />}
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowThemes(true)}
                className="p-1.5 rounded-lg text-ink3 hover:text-ink hover:bg-sunken transition-colors"
                aria-label="Abrir selector de paletas"
                title="Ver y crear paletas"
              >
                <Palette size={15} />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            {THEMES.map((t) => {
              const selected = !activeCustomPalette && theme === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTheme(t.id)}
                  title={t.label}
                  aria-label={`Tema ${t.label}`}
                  aria-pressed={selected}
                  className={cx(
                    'h-8 rounded-lg border-2 overflow-hidden flex transition-all active:scale-95',
                    selected ? 'border-accent shadow-card' : 'border-line hover:border-line2'
                  )}
                  style={{ background: t.preview.bg }}
                >
                  <span className="w-full h-full flex items-end gap-0.5 p-1">
                    <span className="w-2.5 h-3.5 rounded-[2px]" style={{ background: t.preview.primary }} />
                    <span className="w-2.5 h-2.5 rounded-[2px]" style={{ background: t.preview.accent2 }} />
                    <span className="flex-1 h-1.5 rounded-full mb-0.5" style={{ background: t.preview.line }} />
                  </span>
                </button>
              );
            })}
          </div>

          <p className="px-1 mt-2 text-[11px] font-semibold text-ink2 truncate">
            {activeCustomPalette?.name || THEMES.find((t) => t.id === theme)?.label}
            {isDark ? ' · oscuro' : ' · claro'}
          </p>
        </div>

        <div className="px-4 py-3 border-t border-line space-y-2">
          <Link
            href="/strava"
            className="flex items-center justify-center gap-2 w-full py-2 px-3 rounded-btn text-xs font-semibold bg-accent2/15 text-accent2 border border-accent2/30 hover:bg-accent2/25 transition-colors"
          >
            <Upload className="h-3.5 w-3.5" />
            MyWhoosh · Huawei · Archivos
          </Link>
          <div className="flex items-center gap-2 px-1 text-[11px] text-ink3">
            <ShieldCheck className="h-3.5 w-3.5 text-accent2 shrink-0" />
            <span>SQLite independiente ({accountName})</span>
          </div>
        </div>
      </aside>

      {/* Topbar Móvil / Tablet */}
      <header className="lg:hidden sticky top-0 z-30 border-b border-line px-4 py-3 flex items-center justify-between bg-surface/85 backdrop-blur-xl">
        <Link href="/" className="flex items-center gap-2.5 min-w-0">
          <BrandMark className="h-8 w-8" />
          <div className="min-w-0">
            <span className="font-display font-bold text-base text-ink block leading-none">Bilifit</span>
            <span className="text-[11px] text-ink3 font-medium truncate block mt-0.5">{accountName}</span>
          </div>
        </Link>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleSwitchAccount}
            className="px-2.5 py-1.5 rounded-btn text-xs font-semibold bg-sunken text-ink2 hover:text-ink border border-line inline-flex items-center gap-1"
            title={`Cambiar a ${otherName}`}
          >
            <ArrowLeftRight className="h-3.5 w-3.5 text-accent" />
            <span>{otherName}</span>
          </button>
          <button
            type="button"
            onClick={() => !darkModeLocked && setDark(!isDark)}
            disabled={darkModeLocked}
            className={cx(iconBtn, 'disabled:opacity-40 disabled:cursor-not-allowed')}
            aria-label={darkModeLocked ? 'Modo oscuro fijo con el tema Nocturno' : isDark ? 'Activar modo claro' : 'Activar modo oscuro'}
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => setShowThemes(true)}
            className={iconBtn}
            aria-label="Cambiar paleta"
          >
            <Palette className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className={iconBtn}
            aria-label="Abrir ajustes"
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 lg:pl-[272px] pb-20 lg:pb-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">{children}</div>
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 border-t border-line bg-surface/90 backdrop-blur-xl flex items-center justify-around py-2 px-1">
        {[
          { href: '/', label: 'Panel', icon: LayoutDashboard },
          { href: '/actividades', label: 'Historial', icon: Activity },
          { href: '/ciclismo', label: 'MyWhoosh', icon: Bike },
          { href: '/montana', label: 'Montaña', icon: Mountain },
          { href: '/casa', label: 'Casa', icon: Dumbbell },
        ].map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cx(
                'flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg text-[10px] font-semibold transition-colors',
                active ? 'text-primary' : 'text-ink2 hover:text-ink'
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {showSettings && (
        <SettingsMenu
          theme={theme}
          dark={isDark}
          darkModeLocked={darkModeLocked}
          accountName={accountName}
          onSwitchAccount={() => {
            setShowSettings(false);
            handleSwitchAccount();
          }}
          activePaletteName={activeCustomPalette?.name || null}
          settingsVersion={settingsVersion}
          syncStatus={settingsSyncStatus}
          syncError={settingsSyncError}
          lastSyncedAt={settingsLastSyncedAt}
          onToggleDark={() => !darkModeLocked && setDark(!isDark)}
          onAppearance={() => {
            setShowSettings(false);
            setShowThemes(true);
          }}
          onGoConnections={() => {
            setShowSettings(false);
            router.push('/strava');
          }}
          onGoAthleteSettings={() => {
            setShowSettings(false);
            router.push('/ajustes');
          }}
          onClose={() => setShowSettings(false)}
        />
      )}

      {showThemes && (
        <ThemePicker
          theme={theme}
          dark={isDark}
          onSetTheme={setTheme}
          onSetDark={setDark}
          customPalettes={customPalettes}
          activeCustomPalette={activeCustomPalette}
          syncStatus={settingsSyncStatus}
          syncError={settingsSyncError}
          onApplyCustomPalette={applyCustomPalette}
          onSaveCustomPalette={saveCustomPalette}
          onDeleteCustomPalette={deleteCustomPalette}
          onClose={() => setShowThemes(false)}
        />
      )}
    </div>
  );
}
