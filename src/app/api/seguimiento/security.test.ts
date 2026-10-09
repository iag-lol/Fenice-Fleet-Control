import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
const mocks = vi.hoisted(() => ({ load: vi.fn(), auth: vi.fn() }));
vi.mock('@/services/aggregation/tracking-aggregator', () => ({ loadTrackingSession: mocks.load }));
vi.mock('@/lib/auth', () => ({ getAuthContext: mocks.auth }));
import { GET } from './route';
import { issueTrackingToken } from '@/services/tracking/access-token';
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('DATA_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
  mocks.auth.mockResolvedValue({ authenticated: false, openAccess: false, permissions: new Set() });
  mocks.load.mockResolvedValue({ status: 'en_ruta', destination: {} });
});
afterEach(() => vi.unstubAllEnvs());
describe('seguimiento sin enumeracion publica de OT', () => {
  it('no consulta el pedido si un visitante prueba su numero secuencial', async () => {
    const response = await GET(new Request('https://example.test/api/seguimiento?ref=OT-TEST-0001'));
    expect(response.status).toBe(404); expect(mocks.load).not.toHaveBeenCalled();
  });
  it('autoriza exactamente el pedido del enlace autentico', async () => {
    const token = issueTrackingToken('OT-TEST-0001');
    expect((await GET(new Request(`https://example.test/api/seguimiento?ref=${token}`))).status).toBe(200);
    expect(mocks.load).toHaveBeenCalledWith({ reference: 'OT-TEST-0001' });
  });
  it('un token vencido no retrocede al acceso por numero aunque haya sesion', async () => {
    mocks.auth.mockResolvedValue({ authenticated: true, openAccess: false, permissions: new Set(['ordenes.ver']) });
    const token = issueTrackingToken('OT-TEST-0001', Date.now() - 73 * 3_600_000);
    expect((await GET(new Request(`https://example.test/api/seguimiento?ref=${token}`))).status).toBe(404);
    expect(mocks.load).not.toHaveBeenCalled();
  });
});
