import type { Position } from '@/types/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const query = vi.hoisted(() => vi.fn(async (): Promise<Position[]> => []));
vi.mock('@/services/registry', () => ({ getGpsProvider: () => ({ getPositionHistory: query }) }));
vi.mock('@/lib/api', () => ({
  guardApi: async () => null,
  apiError: (error: string, status: number) => Response.json({ error }, { status }),
  handleApi: async (work: () => Promise<unknown>) => Response.json(await work()),
}));
import { GET } from './route';
beforeEach(() => query.mockReset().mockResolvedValue([]));
afterEach(() => vi.useRealTimers());
it.each(['hasta=no-es-fecha', 'desde=2026-09-13&hasta=2026-09-12', 'desde=2026-01-01&hasta=2026-09-12', 'limite=NaN', 'limite=999999'])('rejects invalid history query %s before contacting the provider', async (params) => {
  const response = await GET(new Request(`https://app.example.test/api/gps/history/v1?${params}`), { params: Promise.resolve({ vehicleId: 'v1' }) });
  expect(response.status).toBe(400); expect(query).not.toHaveBeenCalled();
});
it('accepts historical days beyond the default eight-hour window', async () => {
  const response = await GET(new Request('https://app.example.test/api/gps/history/v1?desde=2026-08-01T00:00:00Z&hasta=2026-08-02T00:00:00Z&limite=20000'), { params: Promise.resolve({ vehicleId: 'v1' }) });
  expect(response.status).toBe(200);
  expect(query).toHaveBeenCalledWith({ vehicleId: 'v1', from: '2026-08-01T00:00:00.000Z', to: '2026-08-02T00:00:00.000Z', limit: 20000 });
});

it('no permite que el fin del día incluya ubicaciones futuras por un reloj GPS adelantado', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-08T18:00:00Z'));
  const p = { vehicleId: 'v1' as Position['vehicleId'], deviceId: 'd1' as Position['deviceId'],
    lat: -33.45, lng: -70.66, valid: true, speed: 30, heading: 0, ignition: 'on' as const,
    timestamp: '2026-10-08T17:59:30Z' };
  query.mockResolvedValue([p, { ...p, timestamp: '2026-10-08T19:00:00Z' }]);
  const response = await GET(new Request('https://app.example.test/api/gps/history/v1?desde=2026-10-08T03:00:00Z&hasta=2026-10-09T02:59:59Z'), { params: Promise.resolve({ vehicleId: 'v1' }) });
  expect(await response.json()).toEqual([p]);
  expect(query).toHaveBeenCalledWith(expect.objectContaining({ to: '2026-10-08T18:00:00.000Z' }));
});
it('una consulta de mañana no inventa registros ni contacta al proveedor', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-08T18:00:00Z'));
  const response = await GET(new Request('https://app.example.test/api/gps/history/v1?desde=2026-10-09T03:00:00Z&hasta=2026-10-10T02:59:59Z'), { params: Promise.resolve({ vehicleId: 'v1' }) });
  expect(await response.json()).toEqual([]); expect(query).not.toHaveBeenCalled();
});
