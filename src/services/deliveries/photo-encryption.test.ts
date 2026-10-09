import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { byteaToDataUrl, dataUrlToBytea } from './proof-store';
const fixture = `data:image/png;base64,${Buffer.from('fixture image bytes').toString('base64')}`;
afterEach(() => vi.unstubAllEnvs());
describe('cifrado de fotografias y compatibilidad de bytea', () => {
  it('recupera exactamente la fotografia y no permite intercambiar registros', () => {
    vi.stubEnv('DATA_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
    const stored = dataUrlToBytea(fixture, 'fixture-photo-one');
    expect(Buffer.from(stored.hex.slice(2), 'hex').toString('utf8')).toMatch(/^enc:v1:/);
    expect(byteaToDataUrl(stored.hex, stored.mime, 'fixture-photo-one')).toBe(fixture);
    expect(() => byteaToDataUrl(stored.hex, stored.mime, 'fixture-photo-two')).toThrow();
  });
  it('mantiene imagenes existentes y el modo de desarrollo sin clave', () => {
    vi.stubEnv('DATA_ENCRYPTION_KEY', ''); vi.stubEnv('DATA_ENCRYPTION_PREVIOUS_KEYS', ''); vi.stubEnv('NODE_ENV', 'test');
    const stored = dataUrlToBytea(fixture, 'fixture');
    expect(Buffer.from(stored.hex.slice(2), 'hex').toString('utf8')).toBe('fixture image bytes');
    expect(byteaToDataUrl(stored.hex, stored.mime, 'fixture')).toBe(fixture);
  });
});
