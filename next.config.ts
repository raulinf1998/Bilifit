import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  ...(process.env.NEXT_STANDALONE === '1' ? { output: 'standalone' as const } : {}),
  serverExternalPackages: ['better-sqlite3'],
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
