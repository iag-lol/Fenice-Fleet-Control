import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ vehicles: vi.fn(), positions: vi.fn(), devices: vi.fn(), warnings: vi.fn(), open: vi.fn(), update: vi.fn(), create: vi.fn() }));
vi.mock('@/services/registry', () => ({
  getGpsProvider: () => ({ info: { id: '3dtracking', simulated: false }, getVehicles: mocks.vehicles, getAllCurrentPositions: mocks.positions,
    getDeviceStatus: mocks.devices, getVehicleEvents: async () => [], getAvailabilityWarnings: mocks.warnings }),
  getOperationsProvider: () => ({ getRoutes: async () => [], getWorkOrders: async () => [], getClients: async () => [] }),
}));
vi.mock('@/services/fleet/alert-store', () => ({ listAlerts: mocks.open, updateAlertState: mocks.update, createAlert: mocks.create }));
vi.mock('@/services/settings/settings-store', async () => {
  const { DEFAULT_OPERATIONAL_SETTINGS } = await import('@/config/operational');
  return { getOperationalSettings: () => DEFAULT_OPERATIONAL_SETTINGS };
});
import { evaluateRealAlerts } from './real-alert-evaluator';
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-09T13:00:00Z'));
  mocks.warnings.mockReturnValue([]);
  mocks.vehicles.mockResolvedValue([{ id: 'fixture-v', plate: 'TEST01', active: true, device: { id: 'fixture-device' } }]);
  mocks.positions.mockResolvedValue([{ vehicleId: 'fixture-v', deviceId: 'fixture-device', timestamp: '2026-10-09T11:00:00Z', valid: true, speed: 0, ignition: 'off' }]);
  mocks.devices.mockResolvedValue([{ vehicleId: 'fixture-v', lastCommunicationAt: '2026-10-09T12:59:00Z' }]);
  mocks.open.mockResolvedValue([
    { id: 'live:gps:fixture-v:old', vehicleId: 'fixture-v', type: 'gps_offline', state: 'nueva' },
    { id: 'manual:power', vehicleId: 'fixture-v', type: 'gps_evento_equipo', state: 'nueva' },
    { id: 'live:gps:other:old', vehicleId: 'other-v', type: 'gps_offline', state: 'nueva' },
  ]);
});
it('un fallo de consulta no genera una falsa desconexion del dispositivo', async () => {
  mocks.warnings.mockReturnValue(['Consulta temporalmente no disponible.']);
  mocks.devices.mockResolvedValue([]);
  mocks.open.mockResolvedValue([]);
  await evaluateRealAlerts();
  expect(mocks.create).not.toHaveBeenCalled();
});
afterEach(() => vi.useRealTimers());
it('resuelve la falsa desconexion por heartbeat sin inventar un fix ni cerrar alertas manuales o ajenas', async () => {
  await evaluateRealAlerts();
  expect(mocks.update.mock.calls).toEqual([['live:gps:fixture-v:old', 'resuelta']]);
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
    title: 'TEST01: equipo conectado', timestamp: '2026-10-09T12:59:00Z', position: null,
  }));
});
