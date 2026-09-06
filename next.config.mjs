/**
 * Cabeceras de seguridad HTTP, aplicadas a toda respuesta.
 *
 * No incluye Content-Security-Policy: el mapa operacional carga tiles y
 * estilos desde varios proveedores segun `NEXT_PUBLIC_MAP_PROVIDER`
 * (OpenStreetMap, MapTiler, Mapbox, ArcGIS) y una CSP mal enumerada
 * rompería el mapa en silencio. Se documenta como paso siguiente en
 * docs/SUPABASE-INTEGRATION.md una vez fijado el proveedor de produccion.
 *
 * `Permissions-Policy` permite `geolocation=(self)` a proposito: el portal
 * del conductor la usa para adjuntar la posicion del telefono a la evidencia
 * de entrega (ver `src/features/medium/driver-portal/photo-capture.ts`).
 */
const SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()',
  },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: { dirs: ['src'] },
  transpilePackages: ['maplibre-gl'],
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
