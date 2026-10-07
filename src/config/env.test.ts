import { afterEach, describe, expect, it, vi } from 'vitest';
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
describe('entorno de puesta en marcha', () => {
  it('acepta campos opcionales vacios de la plantilla sin invalidar URLs o enums', async () => {
    vi.resetModules();
    for (const key of ['SUPABASE_URL', 'TRACCAR_BASE_URL', 'TRACCAR_TOKEN', 'EXTERNAL_DB_ENGINE', 'EXTERNAL_DB_PORT', 'DRIVER_PORTAL_SECRET']) vi.stubEnv(key, '');
    vi.stubEnv('AUTH_ENABLED', 'false');
    const { getServerEnv } = await import('./env');
    const env = getServerEnv();
    expect(env.SUPABASE_URL).toBeUndefined();
    expect(env.TRACCAR_BASE_URL).toBeUndefined();
    expect(env.EXTERNAL_DB_ENGINE).toBeUndefined();
  });
  it('conserva la validacion de URLs configuradas incorrectamente', async () => {
    vi.resetModules(); vi.stubEnv('TRACCAR_BASE_URL', 'esto-no-es-una-url');
    const { getServerEnv } = await import('./env');
    expect(() => getServerEnv()).toThrow(/TRACCAR_BASE_URL/);
  });
});
