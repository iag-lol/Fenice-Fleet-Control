import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ configured: false, result: { data: null as null | { revocado_at: string | null }, error: null as null | { message: string } } }));
vi.mock('@/lib/supabase/server-client', () => ({
  isSupabaseConfigured: () => mocks.configured,
  getSupabaseClient: () => ({ from: () => ({
    insert: async () => mocks.result,
    select: () => ({ eq: () => ({ maybeSingle: async () => mocks.result }) }),
    update: () => ({ eq: async () => mocks.result }),
  }) }),
}));
import { issueRouteToken, verifyRouteToken, revokeRouteToken } from './route-token';
import type { RouteId } from '@/types/core';
afterEach(() => { mocks.configured = false; mocks.result = { data: null, error: null }; });
describe('enlaces de conductor fallan cerrados', () => {
  it('no emite un enlace si no pudo registrar su revocacion', async () => {
    mocks.configured = true; mocks.result.error = { message: 'fixture unavailable' };
    await expect(issueRouteToken('fixture-route' as RouteId)).rejects.toThrow();
  });
  it.each(['missing', 'outage'])('no autoriza un enlace cuando el ledger esta %s', async (state) => {
    const issued = await issueRouteToken('fixture-route' as RouteId);
    mocks.configured = true;
    if (state === 'outage') mocks.result.error = { message: 'fixture unavailable' };
    expect(await verifyRouteToken(issued.token)).toEqual({ valid: false, reason: 'token_revocado' });
  });
  it('no informa revocacion exitosa cuando no pudo persistirla', async () => {
    mocks.configured = true; mocks.result.error = { message: 'fixture unavailable' };
    await expect(revokeRouteToken('fixture')).rejects.toThrow();
  });
});
