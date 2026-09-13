import { beforeEach, expect, it, vi } from 'vitest';
const query = vi.hoisted(() => vi.fn(async () => []));
vi.mock('@/services/registry', () => ({ getGpsProvider: () => ({ getPositionHistory: query }) }));
vi.mock('@/lib/api', () => ({
  guardApi: async () => null,
  apiError: (error: string, status: number) => Response.json({ error }, { status }),
  handleApi: async (work: () => Promise<unknown>) => Response.json(await work()),
}));
import { GET } from './route';
beforeEach(() => query.mockClear());
it.each(['hasta=no-es-fecha', 'desde=2026-09-13&hasta=2026-09-12', 'desde=2026-01-01&hasta=2026-09-12', 'limite=NaN', 'limite=999999'])('rejects invalid history query %s before contacting the provider', async (params) => {
  const response = await GET(new Request(`https://app.example.test/api/gps/history/v1?${params}`), { params: Promise.resolve({ vehicleId: 'v1' }) });
  expect(response.status).toBe(400); expect(query).not.toHaveBeenCalled();
});
it('accepts historical days beyond the default eight-hour window', async () => {
  const response = await GET(new Request('https://app.example.test/api/gps/history/v1?desde=2026-08-01T00:00:00Z&hasta=2026-08-02T00:00:00Z&limite=20000'), { params: Promise.resolve({ vehicleId: 'v1' }) });
  expect(response.status).toBe(200);
  expect(query).toHaveBeenCalledWith({ vehicleId: 'v1', from: '2026-08-01T00:00:00.000Z', to: '2026-08-02T00:00:00.000Z', limit: 20000 });
});
