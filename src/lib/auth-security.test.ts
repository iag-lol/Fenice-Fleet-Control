import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ session: vi.fn(), enabled: true, query: vi.fn() }));
vi.mock('@/config/env', () => ({ getServerEnv: () => ({ AUTH_ENABLED: mocks.enabled }) }));
vi.mock('@/lib/session', () => ({ resolveSessionFromCookies: mocks.session }));
import { requireAuth, requirePermission, ForbiddenError, UnauthorizedError } from './auth';
afterEach(() => { vi.clearAllMocks(); mocks.enabled = true; });
describe('autorizacion independiente de la interfaz', () => {
  it('rechaza anonimato aunque se invoque la accion directamente', async () => {
    mocks.session.mockResolvedValue(null);
    await expect(requireAuth()).rejects.toBeInstanceOf(UnauthorizedError);
  });
  it.each(['invitado', 'operador', 'supervisor'])('el rol %s no puede editar configuracion', async (rol) => {
    mocks.session.mockResolvedValue({ id: 'fixture', rut: 'fixture', nombreCompleto: 'Fixture', rol });
    await expect(requirePermission('configuracion.editar')).rejects.toBeInstanceOf(ForbiddenError);
  });
  it.each(['invitado', 'operador'])('el rol %s no puede modificar flota', async (rol) => {
    mocks.session.mockResolvedValue({ id: 'fixture', rut: 'fixture', nombreCompleto: 'Fixture', rol });
    await expect(requirePermission('flota.editar')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requirePermission('flota.ver')).resolves.toHaveProperty('authenticated', true);
  });
});
