import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const nextConfig: NextConfig = {
  // Standalone output is used by `npm run build:release`. It produces a
  // tree-shaken `.next/standalone/` tree that customers can extract + run
  // without `npm install`. Gated by env so dev workflow stays unchanged.
  ...(process.env.BUILD_STANDALONE === '1' ? { output: 'standalone' as const } : {}),
  serverExternalPackages: ['better-sqlite3', 'node-pty'],
  // Raise the 10MB default so `/api/upgrade/apply` can receive the release
  // tarball as a raw body (~25MB today, may grow). Applies to all routes,
  // which is fine — routes that don't need large uploads won't read the body.
  experimental: {
    proxyClientMaxBodySize: 500 * 1024 * 1024,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
}

export default withNextIntl(nextConfig)
