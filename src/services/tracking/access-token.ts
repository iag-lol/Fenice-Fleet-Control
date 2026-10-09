import 'server-only';
import { protectSensitive, unprotectSensitive } from '@/lib/sensitive-data';

const PREFIX = 'trk1.';
const CONTEXT = 'fenice:public-tracking:v1';
const TTL_MS = 72 * 3_600_000;

/** El numero de OT no es una credencial. El enlace es opaco y caduco. */
export function issueTrackingToken(reference: string, now = Date.now()): string {
  const payload = JSON.stringify({ reference, expires: now + TTL_MS });
  const protectedPayload = protectSensitive(payload, CONTEXT);
  if (!protectedPayload.startsWith('enc:v1:')) {
    throw new Error('Configura el cifrado antes de compartir enlaces.');
  }
  return PREFIX + Buffer.from(protectedPayload).toString('base64url');
}

export function resolveTrackingToken(token: string, now = Date.now()): string | null {
  if (!token.startsWith(PREFIX) || token.length > 2048 || !/^trk1\.[A-Za-z0-9_-]+$/.test(token)) return null;
  try {
    const encoded = Buffer.from(token.slice(PREFIX.length), 'base64url').toString('utf8');
    if (!encoded.startsWith('enc:v1:')) return null;
    const data = JSON.parse(unprotectSensitive(encoded, CONTEXT)) as { reference?: unknown; expires?: unknown };
    if (typeof data.reference !== 'string' || data.reference.length < 4 || data.reference.length > 100 ||
        typeof data.expires !== 'number' || !Number.isFinite(data.expires) || data.expires <= now ||
        data.expires > now + TTL_MS + 60_000) return null;
    return data.reference;
  } catch { return null; }
}
