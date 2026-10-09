import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ row: null as unknown, lookup: vi.fn(), configured: true }));
vi.mock('@/lib/supabase/server-client', () => ({
  isSupabaseConfigured: () => mocks.configured,
  getSupabaseClient: () => ({ from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: mocks.lookup }) }),
    update: () => ({ eq: () => ({ then: () => {} }) }),
  }) }),
}));
import { resolveSessionByToken } from './session';
afterEach(() => { vi.clearAllMocks(); });
const session = () => ({ id: 'fixture-session', expira_at: new Date(Date.now() + 60_000).toISOString(), revocada_at: null,
  usuarios: { id: 'fixture', rut: 'fixture', nombre_completo: 'Fixture', rol: 'administrador', activo: true } });
describe('sesiones no falsificables ni prorrogables desde el navegador', () => {
  it('descarta cookies malformadas antes de consultar la base', async () => {
    for (const token of ['admin', 'x'.repeat(10000), '{"rol":"administrador"}', '']) expect(await resolveSessionByToken(token)).toBeNull();
    expect(mocks.lookup).not.toHaveBeenCalled();
  });
  it.each(['expired', 'invalid-date', 'revoked', 'inactive', 'unknown-role'])('rechaza sesion %s', async (kind) => {
    const row = session();
    if (kind === 'expired') row.expira_at = new Date(Date.now()-1).toISOString();
    if (kind === 'invalid-date') row.expira_at = 'invalid';
    if (kind === 'revoked') Object.assign(row, { revocada_at: new Date().toISOString() });
    if (kind === 'inactive') row.usuarios.activo = false;
    if (kind === 'unknown-role') row.usuarios.rol = 'superadmin';
    mocks.lookup.mockResolvedValue({ data: row, error: null });
    expect(await resolveSessionByToken('x'.repeat(43))).toBeNull();
  });
  it('resuelve el rol actual de la base sin confiar en un rol de la cookie', async () => {
    const row = session(); row.usuarios.rol = 'invitado';
    mocks.lookup.mockResolvedValue({ data: row, error: null });
    expect(await resolveSessionByToken('x'.repeat(43))).toHaveProperty('rol', 'invitado');
  });
});
