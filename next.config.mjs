/**
 * Content-Security-Policy.
 *
 * El mapa operacional es el unico motivo para no usar un `default-src 'self'`
 * estricto: segun `NEXT_PUBLIC_MAP_PROVIDER`, `TRAFFIC_PROVIDER` y las claves
 * configuradas, MapLibre pide teselas y estilos a un conjunto FIJO y conocido
 * de proveedores (nunca a una URL arbitraria: `src/components/map/map-style.ts`
 * enumera cada host en codigo, no en una variable de entorno). Por eso se
 * puede enumerar aqui sin adivinar cual sera el proveedor de produccion: se
 * listan TODOS los que el codigo sabe usar, y el que no este activo
 * simplemente no se llama nunca. El trafico en tiempo real y Traccar/
 * 3DTracking NO aparecen aqui porque se sirven siempre a traves del propio
 * servidor (`/api/trafico/tile/...`, `/api/gps/...`): el navegador nunca los
 * contacta directamente.
 */
const MAP_TILE_HOSTS = [
  'https://*.tile.openstreetmap.org',
  'https://server.arcgisonline.com',
  'https://api.maptiler.com',
  'https://api.mapbox.com',
  'https://*.tiles.mapbox.com',
  'https://demotiles.maplibre.org',
];

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  // Next.js hidrata con pequenos scripts inline (JSON de __NEXT_DATA__ y el
  // bootstrap de cada pagina); sin 'unsafe-inline' la aplicacion no arranca.
  // Es el mismo trade-off que documenta la propia guia de CSP de Next.js.
  "script-src 'self' 'unsafe-inline'",
  // MapLibre inyecta estilos inline en sus controles y marcadores.
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob: ${MAP_TILE_HOSTS.join(' ')}`,
  `connect-src 'self' ${MAP_TILE_HOSTS.join(' ')}`,
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

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
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()',
  },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingExcludes: { '*': ['./.fenice/**/*'] },
  eslint: { dirs: ['src'] },
  transpilePackages: ['maplibre-gl'],
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
