import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { GpsProvider } from '@/services/gps/gps-provider';
import type { Position } from '@/types/core';
const actions = vi.hoisted(() => ({ event: vi.fn(), alert: vi.fn(), geofences: vi.fn(), vehicles: vi.fn() }));
vi.mock('@/services/fleet/alert-store', () => ({ createAlert: actions.alert }));
vi.mock('@/services/fleet/geofence-event-store', () => ({ recordGeofenceEvent: actions.event }));
vi.mock('@/services/fleet/vehicle-store', () => ({ listVehicles: actions.vehicles }));
vi.mock('@/services/geofences/geofence-store', () => ({ listGeofences: actions.geofences }));
vi.mock('@/services/settings/settings-store', async () => {
  const { DEFAULT_OPERATIONAL_SETTINGS } = await import('@/config/operational');
  return { getOperationalSettings: () => DEFAULT_OPERATIONAL_SETTINGS };
});
import { withGeofenceDetection } from './geofence-detector';
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T18:00:00Z')); vi.clearAllMocks();
  actions.geofences.mockResolvedValue([]); actions.vehicles.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());
it('permite mostrar la ultima ubicacion antigua sin registrar una nueva entrada ni alertar por geocerca', async () => {
  const position = { vehicleId: 'gps-test', timestamp: '2026-10-07T16:00:25Z', lat: -33.45, lng: -70.66, valid: true } as Position;
  const base = { info: { id: '3dtracking' }, getAllCurrentPositions: async () => [position] } as unknown as GpsProvider;
  expect(await withGeofenceDetection(base).getAllCurrentPositions()).toEqual([position]);
  await vi.advanceTimersByTimeAsync(1);
  expect(actions.event).not.toHaveBeenCalled();
  expect(actions.alert).not.toHaveBeenCalled();
  expect(actions.geofences).not.toHaveBeenCalled();
});
