import { beforeEach, describe, expect, it } from 'vitest';

import {
  issueRouteToken,
  resetRevokedTokens,
  revokeRouteToken,
  verifyRouteToken,
} from './route-token';
import type { RouteId } from '@/types/core';

const RUTA = 'route-001' as RouteId;
const OTRA = 'route-002' as RouteId;

describe('enlaces de ruta del conductor', () => {
  beforeEach(() => {
    resetRevokedTokens();
  });

  it('emite un enlace que se verifica y devuelve su ruta', async () => {
    const issued = await issueRouteToken(RUTA);
    const result = await verifyRouteToken(issued.token);

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.claims.routeId).toBe(RUTA);
    expect(issued.path).toBe(`/conductor/ruta/${issued.token}`);
  });

  it('emite enlaces distintos para la misma ruta', async () => {
    // Si dos emisiones coincidieran, revocar una revocaria la otra y no se
    // podria distinguir que telefono tiene cual.
    const a = await issueRouteToken(RUTA);
    const b = await issueRouteToken(RUTA);
    expect(a.token).not.toBe(b.token);
  });

  it('rechaza un enlace al que se le cambia la ruta', async () => {
    const issued = await issueRouteToken(RUTA);
    const parts = issued.token.split('.');
    parts[1] = Buffer.from(OTRA, 'utf8').toString('base64url');

    const result = await verifyRouteToken(parts.join('.'));
    expect(result).toEqual({ valid: false, reason: 'firma_invalida' });
  });

  it('rechaza un enlace al que se le extiende la vigencia', async () => {
    const issued = await issueRouteToken(RUTA, { ttlHours: 1 });
    const parts = issued.token.split('.');
    const futuro = new Date(Date.now() + 999 * 3_600_000).toISOString();
    parts[2] = Buffer.from(futuro, 'utf8').toString('base64url');

    expect(await verifyRouteToken(parts.join('.'))).toEqual({ valid: false, reason: 'firma_invalida' });
  });

  it('rechaza un enlace vencido', async () => {
    const emitido = new Date('2026-08-27T08:00:00.000Z');
    const issued = await issueRouteToken(RUTA, { ttlHours: 8, now: emitido });

    const durante = await verifyRouteToken(issued.token, { now: new Date('2026-08-27T15:00:00.000Z') });
    expect(durante.valid).toBe(true);

    const despues = await verifyRouteToken(issued.token, { now: new Date('2026-08-27T17:00:00.000Z') });
    expect(despues).toEqual({ valid: false, reason: 'token_expirado' });
  });

  it('rechaza un enlace revocado aunque siga vigente', async () => {
    const issued = await issueRouteToken(RUTA);
    await revokeRouteToken(issued.token);

    expect(await verifyRouteToken(issued.token)).toEqual({ valid: false, reason: 'token_revocado' });
  });

  it('rechaza basura sin lanzar', async () => {
    for (const basura of ['', 'abc', 'v1.a.b.c', 'v2.a.b.c.d', '....', 'v1.a.b.c.d.e']) {
      expect((await verifyRouteToken(basura)).valid).toBe(false);
    }
  });

  it('no acepta un enlace sin firma', async () => {
    const issued = await issueRouteToken(RUTA);
    const sinFirma = `${issued.token.split('.').slice(0, 4).join('.')}.`;
    expect((await verifyRouteToken(sinFirma)).valid).toBe(false);
  });
});
