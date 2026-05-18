/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@nyx/schemas', '@nyx/types'],
  allowedDevOrigins: ['192.168.15.13'],
  // Em produção, rotear /api diretamente ao NestJS via nginx/load balancer e remover este rewrite.
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_INTERNAL_URL ?? 'http://localhost:3001/api'}/:path*`,
      },
    ]
  },
}

module.exports = nextConfig
