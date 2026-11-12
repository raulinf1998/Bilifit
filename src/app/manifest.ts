import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Bilifit',
    short_name: 'Bilifit',
    description:
      'Plataforma open-source de seguimiento deportivo para correr, ciclismo indoor con MyWhoosh, rutas de montaña y rutinas personalizadas con tu material en casa.',
    start_url: '/',
    display: 'standalone',
    background_color: '#090d14',
    theme_color: '#090d14',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
