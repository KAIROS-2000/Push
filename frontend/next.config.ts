import type { NextConfig } from 'next'

const appEnv = (
  process.env.APP_ENV ||
  process.env.NEXT_PUBLIC_APP_ENV ||
  process.env.NODE_ENV ||
  'development'
)
  .trim()
  .toLowerCase()

if (appEnv === 'production') {
  const missingEnv = ['NEXT_PUBLIC_API_URL', 'INTERNAL_API_URL'].filter(
    (name) => !(process.env[name] || '').trim(),
  )

  if (missingEnv.length > 0) {
    throw new Error(`Missing required production env: ${missingEnv.join(', ')}`)
  }
}

// CSP is owned by src/proxy.ts (nonce-based, per-request; Next 16 proxy replaces middleware).
// Only static security headers that don't need nonces live here.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ]
  },
}

export default nextConfig
