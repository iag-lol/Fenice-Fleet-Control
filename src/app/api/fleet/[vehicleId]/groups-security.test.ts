import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ session: vi.fn(), update: vi.fn(), audit: vi.fn() }));
vi.mock('@/config/env', () => ({ getServerEnv: () => ({ AUTH_ENABLED: true }) }));
vi.mock('@/lib/session', () => ({ resolveSessionFromCookies: mocks.session }));
vi.mock('@/lib/audit', () => ({ logAction: mocks.audit }));
vi.mock('@/services/aggregation/fleet-aggregator', () => ({ loadVehicleDetail: vi.fn() }));
vi.mock('@/services/fleet/vehicle-store', async importOriginal => ({
  ...await importOriginal<typeof import('@/services/fleet/vehicle-store')>(), updateVehicleGroup: mocks.update,
}));
import { PATCH } from './route';
const id = '00000000-0000-4000-8000-000000000001';
const params = { params: Promise.resolve({ vehicleId: id }) };
function request(body: unknown = { group: 'personal' }, origin?: string) {
  return new Request(`https://fleet.example.test/api/fleet/${id}`, { method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(origin ? { origin, host: 'fleet.example.test' } : {}) }, body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.session.mockResolvedValue(null); mocks.audit.mockResolvedValue(undefined);
  mocks.update.mockResolvedValue({ id, group: 'personal' });
});
it('rechaza visitantes sin escribir', async () => {
  expect((await PATCH(request(), params)).status).toBe(401);
  expect(mocks.update).not.toHaveBeenCalled();
});
it.each(['operador', 'invitado'])('el rol %s no puede cambiar grupos por API', async rol => {
  mocks.session.mockResolvedValue({ id: 'fixture', rol });
  expect((await PATCH(request(), params)).status).toBe(403);
  expect(mocks.update).not.toHaveBeenCalled();
});
it('autoriza al administrador y audita el cambio sin alterar el GPS', async () => {
  mocks.session.mockResolvedValue({ id: 'fixture', rol: 'administrador' });
  expect((await PATCH(request(), params)).status).toBe(200);
  expect(mocks.update).toHaveBeenCalledWith(id, 'personal');
  expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'vehiculo.agrupar' }));
});
it('rechaza campos adicionales y peticiones de otro origen', async () => {
  mocks.session.mockResolvedValue({ id: 'fixture', rol: 'administrador' });
  expect((await PATCH(request({ group: 'personal', activo: false }), params)).status).toBe(400);
  expect((await PATCH(request({ group: 'personal' }, 'https://attacker.example.test'), params)).status).toBe(403);
  expect(mocks.update).not.toHaveBeenCalled();
});
