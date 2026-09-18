/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // pages that shell out to Python must never be statically cached
  experimental: {},
};
module.exports = nextConfig;
