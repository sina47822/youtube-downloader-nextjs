import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  experimental: {
    serverActions: { allowedOrigins: ['*'] },
  },
  output: 'standalone', // ⟵ مهم برای Docker runtime جمع‌وجور
}

export default nextConfig
