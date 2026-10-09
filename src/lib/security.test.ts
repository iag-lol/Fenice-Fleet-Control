import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiError, assertSameOrigin } from './api';
import { clientIpFromHeaders } from './client-ip';
import { readBoundedBody, readJsonBody } from './request-body';
import { protectSensitive, unprotectSensitive } from './sensitive-data';
import { buildContentSecurityPolicy } from './security-policy';
import { issueTrackingToken, resolveTrackingToken } from '@/services/tracking/access-token';
import { randomBytes } from 'node:crypto';
afterEach(() => vi.unstubAllEnvs());
const originRequest = (headers: Record<string, string>) => new Request('https://fleet.example.test/api/configuracion', {
  method: 'PUT', headers: { Host: 'fleet.example.test', ...headers },
});
describe('barreras de seguridad de la API', () => {
  it('no expone detalles internos y evita cachear los errores', async () => {
    const response = apiError('Servicio no disponible.', 503, 'secret-key internal database error');
    expect(await response.json()).toEqual({ error: 'Servicio no disponible.' });
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('rechaza CSRF aunque se falsifique X-Forwarded-Host', () => {
    expect(assertSameOrigin(originRequest({ Origin: 'https://evil.test', 'X-Forwarded-Host': 'evil.test' }))?.status).toBe(403);
    expect(assertSameOrigin(originRequest({ Origin: 'http://fleet.example.test' }))?.status).toBe(403);
    expect(assertSameOrigin(originRequest({ Origin: 'https://fleet.example.test', 'Sec-Fetch-Site': 'same-site' }))?.status).toBe(403);
    expect(assertSameOrigin(originRequest({ Origin: 'null' }))?.status).toBe(403);
    expect(assertSameOrigin(originRequest({ Origin: 'https://fleet.example.test', 'Sec-Fetch-Site': 'same-origin' }))).toBeNull();
  });
  it('usa la lista de origenes de servidor en vez del host enviado', () => {
    vi.stubEnv('APP_ALLOWED_ORIGINS', 'https://fleet.example.test');
    expect(assertSameOrigin(originRequest({ Host: 'evil.test', Origin: 'https://evil.test' }))?.status).toBe(403);
  });
  it('la IP falsificada al principio de XFF no gobierna los limites', () => {
    vi.stubEnv('RENDER', 'true');
    expect(clientIpFromHeaders(new Headers({ 'cf-connecting-ip': '198.51.100.1', 'x-forwarded-for': '203.0.113.1, 198.51.100.1' }))).toBe('198.51.100.1');
    vi.stubEnv('RENDER', '');
    expect(clientIpFromHeaders(new Headers({ 'x-forwarded-for': '203.0.113.1, 198.51.100.1' }))).toBe('198.51.100.1');
    expect(clientIpFromHeaders(new Headers({ 'x-real-ip': '203.0.113.1' }))).toBeNull();
  });
  it('detiene cuerpos fragmentados mayores al limite sin Content-Length', async () => {
    let cancelled = false;
    const body = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(1024)); }, cancel() { cancelled = true; } });
    const request = new Request('http://localhost', { method: 'POST', body, duplex: 'half' } as RequestInit);
    expect(await readBoundedBody(request, 1200)).toBeNull(); expect(cancelled).toBe(true);
  });
  it('no acepta formularios simples como JSON ni un payload corrupto', async () => {
    expect(await readJsonBody(new Request('http://localhost', { method: 'POST', body: 'x=1' }))).toBeNull();
    expect(await readJsonBody(new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' }))).toBeNull();
  });
  it('CSP de produccion exige nonce y no permite scripts inline arbitrarios', () => {
    const csp = buildContentSecurityPolicy('test-nonce');
    expect(csp.split('; ')[1]).toBe("script-src 'self' 'nonce-test-nonce'");
    expect(csp).not.toContain('unsafe-eval'); expect(csp).toContain("frame-ancestors 'none'");
  });
});
describe('cifrado autenticado y enlaces publicos', () => {
  it('cifra con IV independiente y solo descifra con el contexto original', () => {
    vi.stubEnv('DATA_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
    const encrypted = protectSensitive('sensitive fixture', 'record-one');
    expect(encrypted).not.toContain('sensitive fixture');
    expect(encrypted).not.toBe(protectSensitive('sensitive fixture', 'record-one'));
    expect(unprotectSensitive(encrypted, 'record-one')).toBe('sensitive fixture');
    expect(() => unprotectSensitive(encrypted, 'record-two')).toThrow();
    const parts = encrypted.split(':'); parts[5] = Buffer.from('tampered').toString('base64url');
    expect(() => unprotectSensitive(parts.join(':'), 'record-one')).toThrow();
  });
  it('admite rotacion conservando la clave anterior y falla si falta', () => {
    const original = randomBytes(32).toString('base64');
    vi.stubEnv('DATA_ENCRYPTION_KEY', original);
    const encrypted = protectSensitive('fixture', 'context');
    vi.stubEnv('DATA_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
    expect(() => unprotectSensitive(encrypted, 'context')).toThrow();
    vi.stubEnv('DATA_ENCRYPTION_PREVIOUS_KEYS', original);
    expect(unprotectSensitive(encrypted, 'context')).toBe('fixture');
  });
  it('nunca guarda datos nuevos sin clave en produccion', () => {
    vi.stubEnv('DATA_ENCRYPTION_KEY', ''); vi.stubEnv('DATA_ENCRYPTION_PREVIOUS_KEYS', ''); vi.stubEnv('NODE_ENV', 'production');
    expect(() => protectSensitive('secret', 'ctx')).toThrow();
  });
  it('rechaza numeros OT, tokens alterados, expirados y de otro proposito', () => {
    vi.stubEnv('DATA_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
    const now = Date.now(); const token = issueTrackingToken('OT-TEST-0001', now);
    expect(token).not.toContain('OT-TEST');
    expect(resolveTrackingToken(token, now)).toBe('OT-TEST-0001');
    expect(resolveTrackingToken('OT-TEST-0001', now)).toBeNull();
    expect(resolveTrackingToken(token, now + 72 * 3_600_000)).toBeNull();
    const wrongPurpose = 'trk1.' + Buffer.from(protectSensitive('{"reference":"OT-TEST","expires":9999999999999}', 'other-purpose')).toString('base64url');
    expect(resolveTrackingToken(wrongPurpose, now)).toBeNull();
    expect(resolveTrackingToken(token.slice(0, 20) + 'x' + token.slice(21), now)).toBeNull();
  });
});
