import type { Metadata } from 'next';
import './globals.css';
import AppShell from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'Bilifit · Seguimiento Deportivo, MyWhoosh, Montaña, Casa & Strava',
  description:
    'Plataforma open-source de seguimiento deportivo para correr, ciclismo indoor con MyWhoosh, rutas de montaña y rutinas personalizadas con tu material en casa.',
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
