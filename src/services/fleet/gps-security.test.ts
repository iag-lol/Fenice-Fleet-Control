import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ env: { TRACCAR_BASE_URL: 'https://gps.example.test', TRACCAR_TOKEN: 'fixture-only' }, fetch: vi.fn() }));
vi.mock('@/config/env', () => ({ getServerEnv: () => mocks.env }));
import { testTraccarConnection } from './vehicle-gps-device';
afterEach(() => { vi.unstubAllGlobals(); mocks.fetch.mockReset(); });
describe('URLs GPS no permiten SSRF ni envio de credenciales a otro host', () => {
  it.each(['http://127.0.0.1:10000', 'http://169.254.169.254', 'https://attacker.example.test', 'https://gps.example.test.evil.test', 'https://gps.example.test/other'])('rechaza %s antes de contactar la red', async (serverUrl) => {
    vi.stubGlobal('fetch', mocks.fetch);
    expect((await testTraccarConnection({ identifier: 'fixture', serverUrl })).ok).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
