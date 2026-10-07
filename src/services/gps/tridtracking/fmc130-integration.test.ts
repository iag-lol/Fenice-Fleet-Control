import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
vi.mock('@/config/env', () => ({ getServerEnv: () => ({ TRIDTRACKING_USERNAME: 'test-only', TRIDTRACKING_PASSWORD: 'test-only', TRIDTRACKING_BASE_URL: 'https://3d.example.test', GPS_REFRESH_INTERVAL_MS: 15000 }) }));
vi.mock('@/services/fleet/vehicle-store', () => ({ listVehicles: async () => [] }));
vi.mock('@/services/settings/settings-store', async () => { const { DEFAULT_OPERATIONAL_SETTINGS } = await import('@/config/operational'); return { getOperationalSettings: () => DEFAULT_OPERATIONAL_SETTINGS }; });
import { TridTrackingGpsProvider } from './tridtracking-gps-provider';
import { checkTridReadiness } from './tridtracking-readiness';
import { PositionArchive, withPositionArchive } from '@/services/gps/history/position-archive';
const dirs: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

it('procesa el contrato oficial desde autenticacion hasta posicion y recorrido persistido de RBDC59', async () => {
  // Datos de prueba: no se envia telemetria ni se crea un equipo en 3DTracking.
  const now = new Date('2026-10-09T14:00:00Z');
  const unit = { Uid: 'unit-rbdc59', Name: 'RBDC59', Imei: '359632100000001' };
  const position = { Unit: unit, Latitude: -33.45, Longitude: -70.66, GPSTimeUtc: '2026-10-09T13:59:30', ServerTimeUTC: '2026-10-09T13:59:33', Speed: 18, SpeedMeasure: 'km/h', Ignition: 'On' };
  const fetchMock = vi.fn(async (url: string | URL | Request) => {
    const pathname = new URL(String(url)).pathname;
    const data = pathname.endsWith('userauthenticate') ? { UserIdGuid: 'user-test', SessionId: 'session-test' }
      : pathname.endsWith('latestpositionslist') ? [{ ...unit, Position: position }]
      : pathname.endsWith('/unit/list') ? [unit]
      : pathname.endsWith('positionslist') ? { Position: [position], StartId: 918273, IsCurrent: true }
      : { AlertList: [] };
    return Response.json({ Status: { Result: 'Success', ErrorCode: '', Message: '' }, Result: data });
  });
  vi.stubGlobal('fetch', fetchMock);
  const dir = await mkdtemp(join(tmpdir(), 'fenice-fmc130-')); dirs.push(dir);
  const archive = new PositionArchive(dir, '3dtracking-test');
  const gps = withPositionArchive(new TridTrackingGpsProvider(), archive);
  expect(await checkTridReadiness(gps, { plate: 'RBDC59', imei: unit.Imei, history: true, maxAgeSeconds: 180 }, now)).toMatchObject({ ok: true, hasPosition: true, ignitionKnown: true, imeiMatches: true, historySamples: 1 });
  const recovered = await new PositionArchive(dir, '3dtracking-test').read({ vehicleId: unit.Uid as never, from: '2026-10-09T13:00:00Z', to: now.toISOString() });
  expect(recovered[0]).toMatchObject({ speed: 18, ignition: 'on', lat: -33.45, timestamp: '2026-10-09T13:59:30.000Z' });
  expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('userauthenticate'))).toHaveLength(1);
});
