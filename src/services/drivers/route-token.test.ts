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

  it('emite un enlace que se verifica y devuelve su ruta', () => {
    const issued = issueRouteToken(RUTA);
    const result = verifyRouteToken(issued.token);

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.claims.routeId).toBe(RUTA);
    expect(issued.path).toBe(`/conductor/ruta/${issued.token}`);
  });

  it('emite enlaces distintos para la misma ruta', () => {
    // Si dos emisiones coincidieran, revocar una revocaria la otra y no se
    // podria distinguir que telefono tiene cual.
    expect(issueRouteToken(RUTA).token).not.toBe(issueRouteToken(RUTA).token);
  });

  it('rechaza un enlace al que se le cambia la ruta', () => {
    const issued = issueRouteToken(RUTA);
    const parts = issued.token.split('.');
    parts[1] = Buffer.from(OTRA, 'utf8').toString('base64url');

    const result = verifyRouteToken(parts.join('.'));
    expect(result).toEqual({ valid: false, reason: 'firma_invalida' });
  });

  it('rechaza un enlace al que se le extiende la vigencia', () => {
    const issued = issueRouteToken(RUTA, { ttlHours: 1 });
    const parts = issued.token.split('.');
    const futuro = new Date(Date.now() + 999 * 3_600_000).toISOString();
    parts[2] = Buffer.from(futuro, 'utf8').toString('base64url');

    expect(verifyRouteToken(parts.join('.'))).toEqual({ valid: false, reason: 'firma_invalida' });
  });

  it('rechaza un enlace vencido', () => {
    const emitido = new Date('2026-08-27T08:00:00.000Z');
    const issued = issueRouteToken(RUTA, { ttlHours: 8, now: emitido });

    const durante = verifyRouteToken(issued.token, { now: new Date('2026-08-27T15:00:00.000Z') });
    expect(durante.valid).toBe(true);

    const despues = verifyRouteToken(issued.token, { now: new Date('2026-08-27T17:00:00.000Z') });
    expect(despues).toEqual({ valid: false, reason: 'token_expirado' });
  });

  it('rechaza un enlace revocado aunque siga vigente', () => {
    const issued = issueRouteToken(RUTA);
    revokeRouteToken(issued.token);

    expect(verifyRouteToken(issued.token)).toEqual({ valid: false, reason: 'token_revocado' });
  });

  it('rechaza basura sin lanzar', () => {
    for (const basura of ['', 'abc', 'v1.a.b.c', 'v2.a.b.c.d', '....', 'v1.a.b.c.d.e']) {
      expect(verifyRouteToken(basura).valid).toBe(false);
    }
  });

  it('no acepta un enlace sin firma', () => {
    const issued = issueRouteToken(RUTA);
    const sinFirma = `${issued.token.split('.').slice(0, 4).join('.')}.`;
    expect(verifyRouteToken(sinFirma).valid).toBe(false);
  });
});
