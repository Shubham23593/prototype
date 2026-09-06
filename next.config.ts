import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  allowedDevOrigins: ['*.e2b.app', 'localhost', '127.0.0.1'],
  output: process.env.VERCEL ? undefined : 'standalone',
  // Match the real historical CSV upload limit and bounded ML/evidence calls.
  experimental: { proxyClientMaxBodySize: '85mb', proxyTimeout: 180000 },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${process.env.INTERNAL_API_URL || 'http://127.0.0.1:4000'}/api/:path*` }];
  },
  poweredByHeader: false,
  devIndicators: false,
};
export default nextConfig;
