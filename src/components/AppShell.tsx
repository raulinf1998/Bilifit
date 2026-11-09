'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Activity,
  Bike,
  Dumbbell,
  Flag,
  Flame,
  LayoutDashboard,
  Mountain,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sun,
  Moon,
  Upload,
  Wrench,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/', label: 'Panel', icon: LayoutDashboard },
  { href: '/actividades', label: 'Actividades', icon: Activity },
  { href: '/segmentos', label: 'Segmentos y PRs', icon: Flag },
  { href: '/ciclismo', label: 'MyWhoosh y Bici', icon: Bike },
  { href: '/montana', label: 'Rutas Montaña', icon: Mountain },
  { href: '/casa', label: 'Casa y Rutinas', icon: Dumbbell, highlight: true },
  { href: '/strava', label: 'Strava e Importar', icon: RefreshCw },
  { href: '/material', label: 'Zapatillas y Bicis', icon: Wrench },
  { href: '/ajustes', label: 'Ajustes Atleta', icon: Settings },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [light, setLight] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem('bilifit-theme');
    if (saved === 'light') {
      document.documentElement.classList.add('light');
      setLight(true);
    }
  }, []);

  function toggleTheme() {
    const next = !light;
    setLight(next);
    if (next) {
      document.documentElement.classList.add('light');
      window.localStorage.setItem('bilifit-theme', 'light');
    } else {
      document.documentElement.classList.remove('light');
      window.localStorage.setItem('bilifit-theme', 'dark');
    }
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* Sidebar Desktop */}
      <aside
        className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 border-r"
        style={{
          background: 'var(--bg-card)',
          borderColor: 'var(--border-subtle)',
        }}
      >
        <div className="flex items-center justify-between px-5 py-5 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <Link href="/" className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-[#fc4c02] to-amber-500 flex items-center justify-center text-white shadow-md shadow-[#fc4c02]/25">
              <Flame className="h-5 w-5" />
            </div>
            <div>
              <div className="font-bold text-lg leading-tight tracking-tight">Bilifit</div>
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                Open Source · Self-Hosted
              </div>
            </div>
          </Link>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Cambiar tema"
            className="p-2 rounded-lg hover:bg-slate-500/10 transition-colors"
            style={{ color: 'var(--text-secondary)' }}
          >
            {light ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  active
                    ? 'bg-[#fc4c02] text-white shadow-sm shadow-[#fc4c02]/30'
                    : 'hover:bg-slate-500/10'
                }`}
                style={!active ? { color: 'var(--text-secondary)' } : undefined}
              >
                <span className="flex items-center gap-3">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </span>
                {item.highlight && !active && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-purple-500/20 text-purple-400">
                    IA Local
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t space-y-2.5" style={{ borderColor: 'var(--border-subtle)' }}>
          <Link
            href="/strava"
            className="flex items-center justify-center gap-2 w-full py-2.5 px-3 rounded-xl text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-colors"
          >
            <Upload className="h-3.5 w-3.5" />
            Importar GPX / FIT / MyWhoosh
          </Link>
          <div className="flex items-center gap-2 px-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            <span>Tus datos en tu propio SQLite</span>
          </div>
        </div>
      </aside>

      {/* Topbar Móvil / Tablet */}
      <header
        className="lg:hidden sticky top-0 z-30 border-b px-4 py-3 flex items-center justify-between backdrop-blur-md"
        style={{
          background: 'var(--bg-card)',
          borderColor: 'var(--border-subtle)',
        }}
      >
        <Link href="/" className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-[#fc4c02] to-amber-500 flex items-center justify-center text-white">
            <Flame className="h-4 w-4" />
          </div>
          <span className="font-bold text-base">Bilifit</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/casa"
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-purple-500/15 text-purple-400 border border-purple-500/30"
          >
            Rutinas Casa
          </Link>
          <Link
            href="/strava"
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-[#fc4c02]/15 text-[#fc4c02] border border-[#fc4c02]/30"
          >
            Strava / GPX
          </Link>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Cambiar tema"
            className="p-2 rounded-lg hover:bg-slate-500/10"
            style={{ color: 'var(--text-secondary)' }}
          >
            {light ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 lg:pl-64 pb-20 lg:pb-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">{children}</div>
      </main>

      {/* Mobile Bottom Nav */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 border-t flex items-center justify-around py-2 px-1"
        style={{
          background: 'var(--bg-card)',
          borderColor: 'var(--border-subtle)',
        }}
      >
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
              className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg text-[10px] font-medium ${
                active ? 'text-[#fc4c02]' : ''
              }`}
              style={!active ? { color: 'var(--text-secondary)' } : undefined}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
