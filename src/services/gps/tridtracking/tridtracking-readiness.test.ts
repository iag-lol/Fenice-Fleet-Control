import { describe, expect, it, vi } from 'vitest';
import type { GpsProvider } from '@/services/gps/gps-provider';
import type { Position, Vehicle } from '@/types/core';
import { checkTridReadiness } from './tridtracking-readiness';
import { TridTrackingError } from './tridtracking-client';
const now = new Date('2026-10-09T14:00:00Z');
const vehicle = { id: 'rbdc-uid', plate: 'RBDC-59', device: { imei: '359632100000001', provider: '3dtracking' } } as Vehicle;
const position = { vehicleId: vehicle.id, valid: true, lat: -33.45, lng: -70.66, timestamp: '2026-10-09T13:59:30Z', ignition: 'on' } as Position;
const input = { plate: 'RBDC59', maxAgeSeconds: 180 };
function gps(): GpsProvider { return { info: { id: '3dtracking', simulated: false, label: 'CONECTADO', preferredTransport: 'polling' }, healthCheck: vi.fn(async () => ({ ok: true, message: 'OK', latencyMs: 5 })), getVehicles: vi.fn(async () => [vehicle]), getAllCurrentPositions: vi.fn(async () => [position]), getPositionHistory: vi.fn(async () => [position]) } as unknown as GpsProvider; }
describe('diagnostico de instalacion RBDC59', () => {
  it('distingue el limite de consultas de un problema de permisos o credenciales', async () => {
    const provider = gps();
    vi.mocked(provider.getAllCurrentPositions).mockRejectedValue(new TridTrackingError('3DTracking limitó la frecuencia de consultas. Reintentaremos en 60 s.', 'RATE_LIMIT', 429));
    expect(await checkTridReadiness(provider, input, now)).toMatchObject({ ok: false, serverReachable: true, message: expect.stringContaining('frecuencia') });
  });
  it('puede probar por patente sin inventar ni exigir un IMEI antes de recibir el equipo', async () => {
    expect(await checkTridReadiness(gps(), input, now)).toMatchObject({ ok: true, deviceFound: true, hasPosition: true, imeiMatches: null, ageSeconds: 30 });
  });
  it('comprueba el IMEI cuando ya esta disponible', async () => {
    expect(await checkTridReadiness(gps(), { ...input, imei: 'otro' }, now)).toMatchObject({ ok: false, imeiMatches: false });
  });
  it('informa de credenciales pendientes sin dibujar telemetria de otro proveedor', async () => {
    const provider = gps(); provider.info.id = 'unavailable';
    expect(await checkTridReadiness(provider, input, now)).toMatchObject({ ok: false, serverReachable: false });
    expect(provider.getAllCurrentPositions).not.toHaveBeenCalled();
  });
  it('rechaza una patente duplicada en el proveedor', async () => {
    const provider = gps(); vi.mocked(provider.getVehicles).mockResolvedValue([vehicle, { ...vehicle, id: 'other' as Vehicle['id'] }]);
    expect(await checkTridReadiness(provider, input, now)).toMatchObject({ ok: false, deviceFound: false });
  });
  it.each([{ ...position, timestamp: '2026-10-09T12:00:00Z' }, { ...position, timestamp: '2026-10-09T15:00:00Z' }, { ...position, lat: 0, lng: 0 }, { ...position, valid: false }, { ...position, vehicleId: 'other' as Position['vehicleId'] }])('rechaza una muestra antigua, futura, sin fix o de otro camion', async (sample) => {
    const provider = gps(); vi.mocked(provider.getAllCurrentPositions).mockResolvedValue([sample]);
    expect(await checkTridReadiness(provider, input, now)).toMatchObject({ ok: false, hasPosition: false });
  });
  it('distingue fallo de historial de una prueba completa', async () => {
    const provider = gps(); vi.mocked(provider.getPositionHistory).mockRejectedValue(new Error('API offline'));
    expect(await checkTridReadiness(provider, { ...input, history: true }, now)).toMatchObject({ ok: false, hasPosition: true });
  });
  it('no acepta la instalacion mientras no llegue un dato de ignicion', async () => {
    const provider = gps(); vi.mocked(provider.getAllCurrentPositions).mockResolvedValue([{ ...position, ignition: 'unknown' }]);
    expect(await checkTridReadiness(provider, input, now)).toMatchObject({ ok: false, hasPosition: true, ignitionKnown: false });
  });
  it('consulta la ultima hora para el UID correcto', async () => {
    const provider = gps();
    expect(await checkTridReadiness(provider, { ...input, history: true }, now)).toMatchObject({ ok: true, historySamples: 1 });
    expect(provider.getPositionHistory).toHaveBeenCalledWith({ vehicleId: vehicle.id, from: '2026-10-09T13:00:00.000Z', to: now.toISOString(), limit: 5000 });
  });
});
