import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GpsProvider } from '@/services/gps/gps-provider';
import type { Position, Vehicle } from '@/types/core';
const mocks = vi.hoisted(() => ({ vehicles: vi.fn(), request: vi.fn() }));
vi.mock('@/services/fleet/vehicle-store', () => ({ listVehicles: mocks.vehicles }));
vi.mock('@/config/env', () => ({ getServerEnv: () => ({ TRACCAR_BASE_URL: 'https://gps.example.test' }) }));
vi.mock('@/services/gps/traccar/traccar-client', () => ({
  buildTraccarAuthHeader: () => null,
  TraccarClient: class { request = mocks.request; },
}));
import { withTraccarDeviceLinks } from './traccar-device-links-provider';
const id = 'v-linked' as Position['vehicleId'];
function base(): GpsProvider {
  return { info: { id: 'unavailable', label: 'Sin conexion', simulated: false, preferredTransport: 'polling' },
    getVehicles: vi.fn(async () => []), getAllCurrentPositions: vi.fn(async () => []),
    getVehiclePosition: vi.fn(async () => null), getPositionHistory: vi.fn(async () => []),
    getDeviceStatus: vi.fn(async () => []), getVehicleEvents: vi.fn(async () => []),
    subscribeToPositions: () => () => {},
  };
}
const query = { vehicleId: id, from: '2026-09-12T00:00:00Z', to: '2026-09-13T00:00:00Z', limit: 2 };
beforeEach(() => { mocks.request.mockReset(); mocks.vehicles.mockReset(); });
describe('linked Traccar history', () => {
  it('reads the linked device server instead of the unavailable fleet-wide provider', async () => {
    mocks.vehicles.mockResolvedValue([{ id, device: { provider: 'traccar', externalId: '42', imei: 'imei', id: 'dev-42' } }] as Vehicle[]);
    mocks.request.mockResolvedValue([0, 10, 20].map((seconds) => ({
      id: seconds + 1, deviceId: 42, latitude: -33.45, longitude: -70.66,
      fixTime: `2026-09-12T12:00:${String(seconds).padStart(2, '0')}Z`, valid: true,
      speed: 10, course: 90, attributes: {},
    })));
    const original = base();
    const history = await withTraccarDeviceLinks(original).getPositionHistory(query);
    expect(original.getPositionHistory).not.toHaveBeenCalled();
    expect(mocks.request).toHaveBeenCalledWith('/positions', { deviceId: '42', from: query.from, to: query.to });
    expect(history).toHaveLength(2);
    expect(history[0]?.vehicleId).toBe(id);
    expect(history[1]?.timestamp).toContain('12:00:20');
  });
  it('retains the main provider for vehicles without a linked Traccar device', async () => {
    mocks.vehicles.mockResolvedValue([]);
    const original = base();
    await withTraccarDeviceLinks(original).getPositionHistory(query);
    expect(original.getPositionHistory).toHaveBeenCalledWith(query);
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
