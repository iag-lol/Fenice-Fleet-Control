import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VehicleId } from '@/types/core';
const fixtures = vi.hoisted(() => ({ call: vi.fn(), local: vi.fn() }));
vi.mock('@/config/env', () => ({
  getServerEnv: () => ({
    TRIDTRACKING_USERNAME: 'test-only',
    TRIDTRACKING_PASSWORD: 'test-only',
    TRIDTRACKING_API_MODE: 'partner',
    TRIDTRACKING_COMPANY_UID: 'company-fenice',
    GPS_REFRESH_INTERVAL_MS: 15000,
  }),
}));
vi.mock('./tridtracking-client', () => ({
  TridTrackingClient: class {
    call = fixtures.call;
  },
}));
vi.mock('@/services/fleet/vehicle-store', () => ({
  listVehicles: fixtures.local,
}));
import { TridTrackingGpsProvider } from './tridtracking-gps-provider';
const uid = 'unit-fenice';
const from = '2026-10-08T12:00:00Z';
const to = '2026-10-08T13:00:00Z';
const raw = (date: string) => ({
  Unit: { Uid: uid, Imei: '359632100000001' },
  Latitude: -33.45,
  Longitude: -70.66,
  GPSTimeUtc: date,
  Speed: 30,
  SpeedMeasure: 'km/h',
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-08T14:00:00Z'));
  fixtures.call.mockReset();
  fixtures.local.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());
function provider() {
  fixtures.call.mockImplementation(async (path: string) =>
    path.endsWith('/Units/List')
      ? [{ Uid: uid, Name: 'RBDC59', IMEI: '359632100000001' }]
      : path.endsWith('LatestPositionsList')
        ? [{ Uid: uid, Imei: '359632100000001', Position: raw(from) }]
        : { Position: [], StartId: 0 },
  );
  return new TridTrackingGpsProvider();
}
describe('contrato oficial de Partner API', () => {
  it('consulta las rutas correctas y restringe flota/posiciones a la empresa seleccionada', async () => {
    const gps = provider();
    const [vehicles, positions] = await Promise.all([
      gps.getVehicles(),
      gps.getAllCurrentPositions(),
    ]);
    expect(vehicles[0]).toMatchObject({
      plate: 'RBDC59',
      device: { imei: '359632100000001' },
    });
    expect(positions[0]).toMatchObject({
      vehicleId: uid,
      simulated: false,
      valid: true,
    });
    expect(fixtures.call).toHaveBeenCalledWith('/api/v1.0/Units/List', {
      CompanyUid: 'company-fenice',
    });
    expect(fixtures.call).toHaveBeenCalledWith(
      '/api/v1.0/Units/LatestPositionsList',
      { CompanyUids: 'company-fenice' },
    );
  });
  it('enlaza IMEI en mayúsculas del catálogo con el vehículo local', async () => {
    const gps = provider();
    fixtures.local.mockResolvedValue([
      {
        id: 'local-rbdc59',
        plate: 'RBDC59',
        device: { imei: '359632100000001' },
      },
    ]);
    expect((await gps.getAllCurrentPositions())[0]?.vehicleId).toBe(
      'local-rbdc59',
    );
  });
  it('pagina sin IsCurrent y solo termina al recibir una página vacía', async () => {
    const gps = provider();
    await gps.getVehicles();
    fixtures.call
      .mockReset()
      .mockResolvedValueOnce({ Position: [raw(from)], StartId: 123 })
      .mockResolvedValueOnce({ Position: [raw(to)], StartId: 234 })
      .mockResolvedValueOnce({ Position: [], StartId: 234 });
    const positions = await gps.getPositionHistory({
      vehicleId: uid as VehicleId,
      from,
      to,
    });
    expect(positions.map((p) => p.timestamp)).toEqual([
      from.replace('Z', '.000Z'),
      to.replace('Z', '.000Z'),
    ]);
    expect(fixtures.call.mock.calls.map(([, params]) => params)).toEqual([
      { Uid: uid },
      { Uid: uid, StartId: '123' },
      { Uid: uid, StartId: '234' },
    ]);
  });
  it('usa StartId=0 para rangos mayores a 24 h y detecta cursores que se repiten con datos', async () => {
    const gps = provider();
    await gps.getVehicles();
    fixtures.call
      .mockReset()
      .mockResolvedValue({ Position: [raw(from)], StartId: 100 });
    await expect(
      gps.getPositionHistory({
        vehicleId: uid as VehicleId,
        from: '2026-10-06T12:00:00Z',
        to,
      }),
    ).rejects.toThrow(/cursor/);
    expect(fixtures.call.mock.calls[0]?.[1]).toEqual({
      Uid: uid,
      StartId: '0',
    });
  });
  it('indica el límite de 7 días y no llama un endpoint de alertas inexistente', async () => {
    const gps = provider();
    await expect(
      gps.getPositionHistory({
        vehicleId: uid as VehicleId,
        from: '2026-09-01T12:00:00Z',
        to,
      }),
    ).rejects.toThrow(/7 días/);
    expect(await gps.getVehicleEvents({ vehicleId: uid as VehicleId })).toEqual(
      [],
    );
    expect(fixtures.call).not.toHaveBeenCalled();
  });
});
