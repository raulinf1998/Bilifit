import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  ...(process.env.NEXT_STANDALONE === '1' ? { output: 'standalone' as const } : {}),
  serverExternalPackages: ['better-sqlite3'],
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, proxy-revalidate' },
          { key: 'Vary', value: 'Cookie' },
        ],
      },
    ];
  },
};

export default nextConfig;
