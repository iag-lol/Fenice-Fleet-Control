import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Vehicle, VehicleId } from '@/types/core';
const mocks = vi.hoisted(() => ({ call: vi.fn(), vehicles: vi.fn() }));
vi.mock('@/config/env', () => ({ getServerEnv: () => ({ TRIDTRACKING_USERNAME: 'test', TRIDTRACKING_PASSWORD: 'test', GPS_REFRESH_INTERVAL_MS: 15000 }) }));
vi.mock('./tridtracking-client', () => ({ TridTrackingClient: class { call = mocks.call; } }));
vi.mock('@/services/fleet/vehicle-store', () => ({ listVehicles: mocks.vehicles }));
vi.mock('@/services/settings/settings-store', async () => {
  const { DEFAULT_OPERATIONAL_SETTINGS } = await import('@/config/operational');
  return { getOperationalSettings: () => DEFAULT_OPERATIONAL_SETTINGS };
});
import { TridTrackingGpsProvider } from './tridtracking-gps-provider';
const uid = 'unit-rbdc59';
const from = '2026-10-09T12:10:00Z';
const to = '2026-10-09T13:00:00Z';
const rawPosition = (time: string) => ({ Unit: { Uid: uid, Name: 'RBDC59', Imei: '359632100000001' }, Latitude: -33.45, Longitude: -70.66, GPSTimeUtc: time, ServerTimeUTC: time, Speed: 30, SpeedMeasure: 'km/h', Ignition: 'On' });
const unit = { Uid: uid, Name: 'RBDC59', Imei: '359632100000001', Position: rawPosition(from) };
beforeEach(() => { mocks.call.mockReset(); mocks.vehicles.mockResolvedValue([]); });
afterEach(() => { vi.useRealTimers(); });
function provider() {
  mocks.call.mockImplementation(async (path: string) => {
    if (path.endsWith('/unit/list') || path.endsWith('latestpositionslist')) return [unit];
    return { AlertList: [] };
  });
  return new TridTrackingGpsProvider();
}
describe('FMC130 en 3DTracking para RBDC59', () => {
  it('incorpora nueve GPS con una consulta de catálogo y una de posiciones, sin mezclar identidades', async () => {
    const units = Array.from({ length: 9 }, (_, i) => ({ ...unit, Uid: `supplier-${i}`, Name: `TEST0${i}`,
      Imei: String(359632100000100 + i), Position: { ...rawPosition(to), Unit: { Uid: `supplier-${i}` }, Latitude: -33.45 - i * .001 } }));
    mocks.vehicles.mockResolvedValue(units.map((u, i) => ({ id: `local-${i}`, plate: u.Name, capacityLiters: 30000,
      device: { imei: u.Imei } })) as Vehicle[]);
    mocks.call.mockImplementation(async (path: string) => path.endsWith('/unit/list') || path.endsWith('latestpositionslist')
      ? units : { Position: units.map((u) => u.Position), StartId: 99, IsCurrent: true });
    const gps = new TridTrackingGpsProvider();
    const [vehicles, positions, devices] = await Promise.all([gps.getVehicles(), gps.getAllCurrentPositions(), gps.getDeviceStatus()]);
    expect(vehicles).toHaveLength(9); expect(positions).toHaveLength(9); expect(devices).toHaveLength(9);
    for (let i = 0; i < 9; i++) {
      expect(positions.find((p) => p.vehicleId === `local-${i}`)).toMatchObject({ deviceId: units[i]!.Imei, lat: units[i]!.Position.Latitude });
      expect(devices.find((d) => d.vehicleId === `local-${i}`)?.deviceId).toBe(units[i]!.Imei);
      const history = await gps.getPositionHistory({ vehicleId: `local-${i}` as VehicleId, from, to });
      expect(history).toHaveLength(1);
      expect(history[0]?.vehicleId).toBe(`local-${i}`);
      expect(history[0]?.lat).toBe(units[i]!.Position.Latitude);
    }
    expect(mocks.call.mock.calls.filter(([p]) => p.endsWith('/unit/list'))).toHaveLength(1);
    expect(mocks.call.mock.calls.filter(([p]) => p.endsWith('latestpositionslist'))).toHaveLength(1);
  });
  it('descubre los ocho equipos nuevos cuando se renueva el catálogo sin reconfigurar el proveedor', async () => {
    vi.useFakeTimers(); const gps = provider(); await gps.getVehicles();
    const added = Array.from({ length: 8 }, (_, i) => ({ ...unit, Uid: `new-${i}`, Name: `NEW0${i}`, Imei: String(359632100000101 + i) }));
    mocks.call.mockResolvedValue([unit, ...added]);
    await vi.advanceTimersByTimeAsync(60000);
    expect(await gps.getVehicles()).toHaveLength(9);
  });
  it('rechaza dos unidades asociadas al mismo IMEI', async () => {
    const gps = provider(); mocks.call.mockResolvedValue([unit, { ...unit, Uid: 'other', Name: 'OTHER1' }]);
    await expect(gps.getVehicles()).rejects.toThrow(/mismo IMEI/);
  });
  it('rechaza un UID duplicado antes de sobrescribir otra unidad del catálogo', async () => {
    const gps = provider(); mocks.call.mockResolvedValue([unit, { ...unit, Imei: '359632100000002' }]);
    await expect(gps.getVehicles()).rejects.toThrow(/identificador/);
  });
  it('comparte la instantanea durante la cadencia de refresco aunque varias pantallas consulten', async () => {
    vi.useFakeTimers(); const gps = provider();
    await gps.getAllCurrentPositions();
    await vi.advanceTimersByTimeAsync(10000);
    await Promise.all([gps.getAllCurrentPositions(), gps.getDeviceStatus()]);
    expect(mocks.call.mock.calls.filter(([path]) => path.endsWith('latestpositionslist'))).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5000);
    await Promise.all([gps.getAllCurrentPositions(), gps.getDeviceStatus()]);
    expect(mocks.call.mock.calls.filter(([path]) => path.endsWith('latestpositionslist'))).toHaveLength(2);
  });
  it('comparte la lectura de posiciones entre mapa y salud GPS', async () => {
    const gps = provider();
    const [positions, devices, vehicles] = await Promise.all([gps.getAllCurrentPositions(), gps.getDeviceStatus(), gps.getVehicles()]);
    expect(positions[0]).toMatchObject({ vehicleId: uid, speed: 30, ignition: 'on', simulated: false });
    expect(devices[0]?.vehicleId).toBe(uid);
    expect(vehicles[0]?.plate).toBe('RBDC59');
    expect(vehicles[0]?.device?.provider).toBe('3dtracking');
    expect(mocks.call.mock.calls.filter(([path]) => path.endsWith('latestpositionslist'))).toHaveLength(1);
    expect(mocks.call.mock.calls.filter(([path]) => path.endsWith('/unit/list'))).toHaveLength(1);
  });
  it('conserva identidad local en posicion, estado e historial y usa UID externo en la API', async () => {
    const gps = provider();
    const localId = 'local-truck' as VehicleId;
    mocks.vehicles.mockResolvedValue([{ id: localId, plate: 'RBDC59', capacityLiters: 30000, device: { imei: unit.Imei } }] as Vehicle[]);
    const [positions, devices, vehicles] = await Promise.all([gps.getAllCurrentPositions(), gps.getDeviceStatus(localId), gps.getVehicles()]);
    expect(positions[0]?.vehicleId).toBe(localId);
    expect(devices[0]?.vehicleId).toBe(localId);
    expect(vehicles[0]?.capacityLiters).toBe(30000);
    mocks.call.mockResolvedValueOnce({ Position: [rawPosition(from)], StartId: 99, IsCurrent: true });
    expect((await gps.getPositionHistory({ vehicleId: localId, from, to }))[0]?.vehicleId).toBe(localId);
    expect(mocks.call).toHaveBeenLastCalledWith('/api/v1.0/data/positionslist', { Uid: uid, StartHourUtc: '2026-10-09T12:00:00.000Z' });
  });
  it('pagina con StartId real sin recortar prematuramente los extremos del recorrido', async () => {
    const gps = provider();
    await gps.getVehicles();
    mocks.call.mockReset().mockResolvedValueOnce({ Position: [rawPosition(from), rawPosition('2026-10-09T12:20:00Z')], StartId: 98217, IsCurrent: false })
      .mockResolvedValueOnce({ Position: [rawPosition(to), { ...rawPosition(to), Unit: { Uid: 'other' } }], StartId: 120001, IsCurrent: true });
    const history = await gps.getPositionHistory({ vehicleId: uid as VehicleId, from, to, limit: 2 });
    expect(history.map((p) => p.timestamp)).toEqual(['2026-10-09T12:10:00.000Z', '2026-10-09T13:00:00.000Z']);
    expect(mocks.call.mock.calls[1]?.[1]).toEqual({ Uid: uid, StartId: '98217' });
  });
  it('detecta un cursor detenido en vez de repetir paginas y entregar un recorrido incompleto', async () => {
    const gps = provider(); await gps.getVehicles();
    mocks.call.mockResolvedValue({ Position: [], StartId: 123, IsCurrent: false });
    await expect(gps.getPositionHistory({ vehicleId: uid as VehicleId, from, to })).rejects.toThrow(/cursor/);
  });
  it('lee AlertList y no transforma alertas desconocidas en recuperacion de señal', async () => {
    const gps = provider(); await gps.getVehicles();
    mocks.call.mockResolvedValueOnce({ AlertList: [
      { AlertUID: 'a1', AlertType: 'Ignition Off', Vehicle: 'RBDC59', CreatedDate: from, AlertMessage: 'Motor apagado' },
      { AlertUID: 'a2', AlertType: 'Unknown alarm', Vehicle: 'RBDC59', CreatedDate: from },
      { AlertUID: 'a3', AlertType: 'SOS', Vehicle: 'Other', CreatedDate: from },
    ] });
    expect(await gps.getVehicleEvents({ vehicleId: uid as VehicleId })).toEqual([expect.objectContaining({ id: 'a1', type: 'ignition_off', vehicleId: uid, detail: 'Motor apagado' })]);
  });
  it('no entrega posiciones despues de cancelar una consulta en vuelo', async () => {
    vi.useFakeTimers(); const gps = provider();
    let done!: (value: unknown) => void;
    mocks.call.mockImplementation((path: string) => path.endsWith('latestpositionslist') ? new Promise((resolve) => { done = resolve; }) : Promise.resolve([unit]));
    const onPositions = vi.fn(); const stop = gps.subscribeToPositions({ onPositions });
    stop(); done([unit]); await vi.advanceTimersByTimeAsync(30000);
    expect(onPositions).not.toHaveBeenCalled();
  });
});
