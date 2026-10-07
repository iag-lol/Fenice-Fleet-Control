import { describe, expect, it } from 'vitest';
import { mapTraccarDeviceStatus, mapTraccarEvent, mapTraccarPosition, type DeviceVehicleLink, type TraccarPosition } from './traccar-mapper';
const link: DeviceVehicleLink = { traccarDeviceId: 42, imei: '359632100000001', vehicleId: 'rbdc59' as DeviceVehicleLink['vehicleId'], internalDeviceId: 'gps42' };
const raw: TraccarPosition = { id: 1, deviceId: 42, deviceTime: '2026-10-09T13:00:00Z', fixTime: '2026-10-09T13:00:00Z', serverTime: '2026-10-09T14:00:00Z', valid: true, latitude: -33.45, longitude: -70.66, altitude: 500, speed: 10, course: 450, address: null, attributes: { ignition: true, batteryLevel: null, totalDistance: null } };
it('no convierte sensores ausentes en cero y convierte nudos una sola vez', () => {
  expect(mapTraccarPosition(raw, link)).toMatchObject({ speed: 18.52, heading: 90, ignition: 'on', odometerKm: undefined, batteryLevel: undefined });
});
it('el heartbeat reciente no sustituye la hora del fix', () => {
  const status = mapTraccarDeviceStatus({ id: 42, uniqueId: link.imei, name: 'RBDC59', status: 'online', lastUpdate: raw.serverTime }, link, new Date(raw.serverTime), mapTraccarPosition(raw, link));
  expect(status.lastPositionAt).toBe('2026-10-09T13:00:00.000Z'); expect(status.secondsSinceLastPosition).toBe(3600);
});
describe('alarmas del FMC130', () => {
  it('distingue corte de alimentacion de SOS y descarta alarmas desconocidas', () => {
    const event = { id: 1, type: 'alarm', deviceId: 42, eventTime: raw.fixTime, attributes: { alarm: 'powerCut' } };
    expect(mapTraccarEvent(event, link)?.type).toBe('power_cut');
    expect(mapTraccarEvent({ ...event, attributes: { alarm: 'sos' } }, link)?.type).toBe('sos');
    expect(mapTraccarEvent({ ...event, attributes: { alarm: 'general' } }, link)).toBeNull();
    expect(mapTraccarEvent({ ...event, eventTime: 'invalid' }, link)).toBeNull();
  });
});
