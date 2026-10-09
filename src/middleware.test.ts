import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const authMocks = vi.hoisted(() => ({
  env: vi.fn(() => ({ AUTH_ENABLED: false })),
  session: vi.fn(),
}));
vi.mock('@/config/env', () => ({ getServerEnv: authMocks.env }));
vi.mock('@/lib/session', () => ({ resolveSessionByToken: authMocks.session, SESSION_COOKIE_NAME: 'fixture_session' }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => ({ allowed: true }) }));

import { middleware } from './middleware';

beforeEach(() => {
  vi.clearAllMocks();
  authMocks.env.mockReturnValue({ AUTH_ENABLED: false });
  authMocks.session.mockResolvedValue(null);
});

describe('privacidad de URL compatible con el mapa', () => {
  it.each(['/control', '/seguimiento/trk1.private-token', '/conductor/private-token'])('protege rutas y tokens en %s sin omitir el origen exigido por el mapa', async (path) => {
    const response = await middleware(new NextRequest('https://fleet.example.test' + path));
    expect(response.headers.get('Referrer-Policy')).toBe('strict-origin');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
  });
});

describe('logo publico sin abrir las secciones internas', () => {
  beforeEach(() => authMocks.env.mockReturnValue({ AUTH_ENABLED: true }));

  it('permite cargar el logo sin cookies, tambien al optimizador de imagenes', async () => {
    const response = await middleware(new NextRequest('https://fleet.example.test/brand/fenice-logo.png'));
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(authMocks.session).not.toHaveBeenCalled();
  });

  it.each(['/control', '/flota', '/clientes', '/configuracion', '/brand', '/brand/otro.png', '/brand/fenice-logo.png/extra'])('mantiene el bloqueo sin sesion para %s', async (path) => {
    const response = await middleware(new NextRequest('https://fleet.example.test' + path));
    expect(response.status).toBe(307);
    const login = new URL(response.headers.get('location')!);
    expect(login.pathname).toBe('/login');
    expect(login.searchParams.get('next')).toBe(path);
  });
});
