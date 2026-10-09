export function buildContentSecurityPolicy(nonce: string, development = false): string {
  const maps = 'https://*.tile.openstreetmap.org https://server.arcgisonline.com https://api.maptiler.com https://api.mapbox.com https://*.tiles.mapbox.com https://demotiles.maplibre.org';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${development ? " 'unsafe-eval'" : ''}`,
    // MapLibre posiciona marcadores y controles con estilos de elementos.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${maps}`,
    `connect-src 'self' ${maps}`,
    "font-src 'self' data:", "worker-src 'self' blob:", "object-src 'none'",
    "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
    ...(development ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}
