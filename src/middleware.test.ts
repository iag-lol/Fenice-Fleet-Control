import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/config/env', () => ({ getServerEnv: () => ({ AUTH_ENABLED: false }) }));
vi.mock('@/lib/session', () => ({ resolveSessionByToken: vi.fn(), SESSION_COOKIE_NAME: 'fixture_session' }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => ({ allowed: true }) }));

import { middleware } from './middleware';

describe('privacidad de URL compatible con el mapa', () => {
  it.each(['/control', '/seguimiento/trk1.private-token', '/conductor/private-token'])('protege rutas y tokens en %s sin omitir el origen exigido por el mapa', async (path) => {
    const response = await middleware(new NextRequest('https://fleet.example.test' + path));
    expect(response.headers.get('Referrer-Policy')).toBe('strict-origin');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
  });
});
