import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import type { CSSProperties } from 'react';
import './globals.css';
import AppShell from '@/components/AppShell';
import { ACCOUNT_COOKIE_NAME, normalizeAccountId, type AccountId } from '@/lib/accounts';
import { getAppSettings } from '@/lib/db';
import { buildPaletteCssVars } from '@/lib/theme-palettes';
import { DEFAULT_APP_SETTINGS, type AppSettings } from '@/lib/themes';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Bilifit',
  applicationName: 'Bilifit',
  description:
    'Plataforma open-source de seguimiento deportivo para correr, ciclismo indoor con MyWhoosh, rutas de montaña y rutinas personalizadas con tu material en casa.',
  appleWebApp: {
    capable: true,
    title: 'Bilifit',
    statusBarStyle: 'black-translucent',
  },
};

export const viewport: Viewport = {
  themeColor: '#FAF6EF',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let account: AccountId | null = null;
  let initialSettings: AppSettings = { ...DEFAULT_APP_SETTINGS };

  if (process.env.NEXT_PHASE !== 'phase-production-build') {
    try {
      const cookieStore = await cookies();
      account = normalizeAccountId(cookieStore.get(ACCOUNT_COOKIE_NAME)?.value);
      if (account) {
        initialSettings = getAppSettings(account);
      }
    } catch {
      account = null;
    }
  }

  const activePalette =
    initialSettings.customPaletteId
      ? initialSettings.customPalettes.find((p) => p.id === initialSettings.customPaletteId) ?? null
      : null;
  const effectiveDark = activePalette
    ? initialSettings.dark
    : initialSettings.dark || initialSettings.theme === 'nocturno';

  const customPaletteStyle = activePalette
    ? (buildPaletteCssVars(effectiveDark ? activePalette.dark : activePalette.light, effectiveDark) as CSSProperties)
    : undefined;

  const htmlStyle: CSSProperties = {
    colorScheme: effectiveDark ? 'only dark' : 'only light',
    ...customPaletteStyle,
  };

  const serializedSettings = JSON.stringify(initialSettings).replace(/</g, '\\u003c');

  return (
    <html
      lang="es"
      data-theme={initialSettings.theme}
      data-mode={effectiveDark ? 'dark' : 'light'}
      className={effectiveDark ? 'dark' : undefined}
      style={htmlStyle}
      suppressHydrationWarning
    >
      <head>
        <meta name="color-scheme" content={effectiveDark ? 'only dark' : 'only light'} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700;800&family=Nunito:wght@500;700;800;900&display=swap"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `window.__BILIFIT_SETTINGS__ = ${serializedSettings};`,
          }}
        />
      </head>
      <body className="min-h-screen antialiased">
        <AppShell initialAccount={account} initialSettings={initialSettings}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
