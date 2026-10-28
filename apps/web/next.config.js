/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@nyx/schemas', '@nyx/types'],
  // LAN, and the Ubuntu Wi-Fi hotspot (10.42.0.1)
  allowedDevOrigins: ['192.168.*.*', '10.42.0.*'],
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
