import type { Metadata, Viewport } from 'next';
import './globals.css';
import AppShell from '@/components/AppShell';

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
  themeColor: '#090d14',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
