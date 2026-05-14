/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@nyx/schemas', '@nyx/types'],
  allowedDevOrigins: ['192.168.15.13'],
}

module.exports = nextConfig
