/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: { dirs: ['src'] },
  transpilePackages: ['maplibre-gl'],
};

export default nextConfig;
