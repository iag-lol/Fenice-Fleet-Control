import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Position, Vehicle } from '@/types/core';
import type { GpsProvider } from '@/services/gps/gps-provider';
vi.mock('@/services/settings/settings-store', async () => {
  const { DEFAULT_OPERATIONAL_SETTINGS } = await import('@/config/operational');
  return { getOperationalSettings: () => DEFAULT_OPERATIONAL_SETTINGS };
});
import { withLastKnownGps } from './last-known-gps';
const vehicle = { id: 'truck-test', plate: 'TEST01', fleetCode: 'TEST01', brand: '', model: '', year: 0,
  type: 'cisterna_rigido', capacityLiters: 0, compartments: 0, driverId: null, depotName: '', active: true,
  device: { id: 'device-test', imei: '359632100000001', model: 'FMC130' } } as Vehicle;
const position = { vehicleId: vehicle.id, deviceId: vehicle.device!.id, timestamp: '2026-10-07T16:00:25Z',
  lat: -33.45, lng: -70.66, speed: 0, heading: 0, ignition: 'off', valid: true, simulated: false } as Position;
let directory: string;
function source(): GpsProvider {
  return { info: { id: '3dtracking', label: 'CONECTADO', simulated: false, preferredTransport: 'polling' },
    getVehicles: vi.fn(async () => [vehicle]), getAllCurrentPositions: vi.fn(async () => [position]),
    getVehiclePosition: vi.fn(async () => position), getDeviceStatus: vi.fn(async () => []),
    getPositionHistory: vi.fn(async () => []), getVehicleEvents: vi.fn(async () => []),
    subscribeToPositions: vi.fn(() => () => {}), healthCheck: vi.fn(async () => ({ ok: true, message: 'ok', latencyMs: 0 })) };
}
beforeEach(async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-08T18:00:00Z'));
  directory = await mkdtemp(join(tmpdir(), 'fenice-last-known-'));
});
afterEach(async () => { vi.useRealTimers(); await rm(directory, { recursive: true, force: true }); });

describe('ultima ubicacion real persistente', () => {
  it('no atribuye la posición del equipo anterior a un GPS reemplazado en el mismo vehículo', async () => {
    const base = source(); const gps = withLastKnownGps(base, directory, 'account-one');
    await gps.getVehicles(); await gps.getAllCurrentPositions();
    vi.mocked(base.getVehicles).mockResolvedValue([{ ...vehicle, device: { ...vehicle.device!, id: 'new-device' as Position['deviceId'], imei: '359632100000002' } }]);
    await gps.getVehicles();
    vi.mocked(base.getAllCurrentPositions).mockRejectedValue(new Error('offline'));
    await expect(gps.getAllCurrentPositions()).rejects.toThrow('offline');
    expect((await gps.getDeviceStatus())[0]?.lastPositionAt).toBeNull();
  });
  it('conserva flota y ubicacion durante una caida sin renovar la fecha del GPS', async () => {
    const base = source(); const gps = withLastKnownGps(base, directory, 'account-one');
    await gps.getVehicles(); await gps.getAllCurrentPositions();
    vi.mocked(base.getVehicles).mockRejectedValue(new Error('rate limit'));
    vi.mocked(base.getAllCurrentPositions).mockRejectedValue(new Error('offline'));
    vi.mocked(base.getDeviceStatus).mockRejectedValue(new Error('offline'));
    expect(await gps.getVehicles()).toEqual([vehicle]);
    expect(await gps.getAllCurrentPositions()).toEqual([position]);
    expect((await gps.getDeviceStatus())[0]).toMatchObject({ connection: 'offline', lastPositionAt: position.timestamp });
    expect(gps.getAvailabilityWarnings?.()).toHaveLength(3);
  });
  it('recupera el registro despues de reiniciar y no lo comparte con otra cuenta', async () => {
    const gps = withLastKnownGps(source(), directory, 'account-one');
    await gps.getVehicles(); await gps.getAllCurrentPositions();
    const unavailable = source();
    vi.mocked(unavailable.getVehicles).mockRejectedValue(new Error('offline'));
    vi.mocked(unavailable.getAllCurrentPositions).mockRejectedValue(new Error('offline'));
    const restored = withLastKnownGps(unavailable, directory, 'account-one');
    expect(await restored.getVehicles()).toEqual([vehicle]);
    expect(await restored.getAllCurrentPositions()).toEqual([position]);
    await expect(withLastKnownGps(unavailable, directory, 'account-two').getAllCurrentPositions()).rejects.toThrow('offline');
  });
  it('mantiene el ultimo fix valido al recibir una lista vacia, un fix invalido o una muestra anterior', async () => {
    const base = source(); const gps = withLastKnownGps(base, directory, 'account-one');
    await gps.getVehicles(); await gps.getAllCurrentPositions();
    for (const incoming of [[], [{ ...position, lat: 0, lng: 0 }], [{ ...position, timestamp: '2026-10-06T16:00:25Z' }]]) {
      vi.mocked(base.getAllCurrentPositions).mockResolvedValue(incoming);
      expect(await gps.getAllCurrentPositions()).toEqual([position]);
    }
    const fresh = { ...position, timestamp: '2026-10-08T18:00:00Z', lat: -33.46 };
    vi.mocked(base.getAllCurrentPositions).mockResolvedValue([fresh]);
    expect(await gps.getVehiclePosition(vehicle.id)).toEqual(fresh);
  });
  it('retira la ubicacion de una unidad que el catalogo confirma eliminada', async () => {
    const base = source(); const gps = withLastKnownGps(base, directory, 'account-one');
    await gps.getVehicles(); await gps.getAllCurrentPositions();
    vi.mocked(base.getVehicles).mockResolvedValue([]);
    vi.mocked(base.getAllCurrentPositions).mockResolvedValue([]);
    expect(await gps.getVehicles()).toEqual([]);
    expect(await gps.getAllCurrentPositions()).toEqual([]);
  });
});
