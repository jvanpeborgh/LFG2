import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The broadcaster writes HLS to disk (or R2 in prod). Nothing about the app is
  // serverless-safe by design — see §3 of BUILD_SPEC.md.
  output: 'standalone',
}

export default nextConfig
