/**
 * Cabeceras de seguridad HTTP, aplicadas a toda respuesta.
 *
 * `Permissions-Policy` permite `geolocation=(self)` a proposito: el portal
 * del conductor la usa para adjuntar la posicion del telefono a la evidencia
 * de entrega (ver `src/features/medium/driver-portal/photo-capture.ts`).
 */
const SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  {
    key: 'Permissions-Policy',
    value: 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()',
  },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Un servidor de revision puede compilar sin tocar los artefactos de produccion.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  poweredByHeader: false,
  outputFileTracingExcludes: { '*': ['./.fenice/**/*'] },
  eslint: { dirs: ['src'] },
  transpilePackages: ['maplibre-gl'],
  serverExternalPackages: ['web-push'],
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
