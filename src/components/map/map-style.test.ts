import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveMapStyle } from './map-style';
import { buildContentSecurityPolicy } from '@/lib/security-policy';

afterEach(() => vi.unstubAllEnvs());

describe('compatibilidad de la cartografia con las barreras de seguridad', () => {
  it.each(['standard', 'dark'] as const)('%s usa el endpoint oficial, permitido por CSP y con atribucion', (mode) => {
    vi.stubEnv('NEXT_PUBLIC_MAP_PROVIDER', 'osm');
    const { style } = resolveMapStyle(mode);
    expect(typeof style).toBe('object');
    if (typeof style === 'string') throw new Error('Se esperaba un estilo raster');
    const basemap = style.sources.basemap;
    expect(basemap?.type).toBe('raster');
    if (!basemap || basemap.type !== 'raster') throw new Error('Se esperaba una fuente raster');
    expect(basemap.tiles).toEqual(['https://tile.openstreetmap.org/{z}/{x}/{y}.png']);
    expect(basemap.attribution).toContain('OpenStreetMap contributors');
    const directives = buildContentSecurityPolicy('map-test').split('; ');
    for (const directive of ['img-src', 'connect-src']) {
      const allowedOrigins = directives.find((item) => item.startsWith(directive + ' '))?.split(' ');
      expect(allowedOrigins).toContain('https://tile.openstreetmap.org');
    }
  });
});
