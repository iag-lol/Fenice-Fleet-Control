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

it('no transforma el primer fix, la deriva incierta o la repetición de un fix en entradas de geocerca', async () => {
  const { DEFAULT_GEOFENCE_RULES } = await import('@/types/core');
  const origin = Date.now();
  const center = { lat: -33.45, lng: -70.66 };
  const vehicleId = 'quality-geofence-test' as Position['vehicleId'];
  let current: Position = { ...center, lng: -70.663, vehicleId, deviceId: 'test' as Position['deviceId'],
    timestamp: new Date(origin).toISOString(), valid: true, speed: 0, ignition: 'on', heading: 0, motionEvidence: 'stationary' };
  actions.geofences.mockResolvedValue([{ id: 'quality-g', active: true, name: 'Cliente de prueba', kind: 'cliente',
    geometry: { shape: 'circle', center, radiusMeters: 60 }, rules: { ...DEFAULT_GEOFENCE_RULES, onEnter: true } }]);
  const provider = withGeofenceDetection({ info: { simulated: false }, getAllCurrentPositions: async () => [current] } as GpsProvider);
  const sample = async (second: number, values: Partial<Position> = {}) => {
    vi.setSystemTime(new Date(origin + second * 1000));
    current = { ...current, timestamp: new Date(origin + second * 1000).toISOString(), ...values };
    await provider.getAllCurrentPositions(); await vi.advanceTimersByTimeAsync(1);
  };
  await sample(0); await sample(15);
  expect(actions.event).not.toHaveBeenCalled();
  await sample(30, { ...center });
  await provider.getAllCurrentPositions(); await vi.advanceTimersByTimeAsync(1);
  expect(actions.event).not.toHaveBeenCalled();
  await sample(45, { motionEvidence: 'uncertain' });
  await sample(60, { motionEvidence: 'stationary' });
  expect(actions.event).not.toHaveBeenCalled(); // nueva referencia, no nueva visita
  await sample(75, { lng: -70.663 });
  await sample(90); await sample(105);
  expect(actions.event).toHaveBeenCalledTimes(1);
  expect(actions.event).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'exit', timestamp: current.timestamp }));
});
