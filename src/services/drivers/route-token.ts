import 'server-only';

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { getServerEnv } from '@/config/env';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server-client';
import type { RouteId } from '@/types/core';

/**
 * Enlaces de acceso para el conductor.
 *
 * El conductor no tiene usuario ni contrasena: recibe por mensaje un enlace
 * que le abre SU ruta y nada mas. Eso obliga a que el enlace, por si solo,
 * sea la credencial. De ahi las tres propiedades que se exigen aqui:
 *
 *  1. No adivinable: lleva 16 bytes aleatorios ademas del identificador.
 *  2. No falsificable: va firmado con HMAC-SHA256 y una clave de servidor.
 *     Cambiar la ruta o la fecha de vencimiento invalida la firma.
 *  3. Caduco y revocable: expira solo, y se puede anular antes.
 *
 * La firma va incluida en el propio enlace en vez de guardarse: asi un
 * token robado no se puede convertir en otro valido para otra ruta ni
 * extender su vigencia, aunque quien lo tenga entienda el formato.
 *
 * La REVOCACION si necesita guardarse en algun sitio (la firma, por diseno,
 * sigue siendo valida hasta que expira). Se persiste en la tabla
 * `enlaces_conductor` de Supabase cuando esta configurada; si no, en un `Set`
 * en memoria del proceso. Esto ultimo es una limitacion real en un despliegue
 * serverless con varias instancias o reinicios: un enlace "revocado" en una
 * instancia seguiria funcionando en otra. Con Supabase configurado la
 * revocacion es autoritativa y compartida.
 */

const VERSION = 'v1';
const NONCE_BYTES = 16;
const SIGNATURE_BYTES = 32;
const LEDGER_TABLE = 'enlaces_conductor';

const globalForTokens = globalThis as unknown as {
  __feniceDriverSecret?: Buffer;
  __feniceRevokedTokens?: Set<string>;
};

/**
 * Clave de firma.
 *
 * Sin `DRIVER_PORTAL_SECRET` se genera una aleatoria por proceso: los enlaces
 * siguen siendo seguros, pero mueren en cada reinicio. Es el comportamiento
 * correcto por defecto — nunca una clave fija escrita en el codigo, que seria
 * publica desde el primer despliegue.
 */
function getSecret(): Buffer {
  if (!globalForTokens.__feniceDriverSecret) {
    const configured = getServerEnv().DRIVER_PORTAL_SECRET;
    globalForTokens.__feniceDriverSecret = configured
      ? Buffer.from(configured, 'utf8')
      : randomBytes(48);
  }
  return globalForTokens.__feniceDriverSecret;
}

function getRevokedMemory(): Set<string> {
  if (!globalForTokens.__feniceRevokedTokens) {
    globalForTokens.__feniceRevokedTokens = new Set<string>();
  }
  return globalForTokens.__feniceRevokedTokens;
}

function encode(buffer: Buffer): string {
  return buffer.toString('base64url');
}

function sign(payload: string): Buffer {
  return createHmac('sha256', getSecret()).update(payload).digest();
}

/** Hash del token para el ledger: nunca se guarda el token en si. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface IssuedRouteToken {
  token: string;
  routeId: RouteId;
  expiresAt: string;
  /** Ruta relativa a la que apunta el enlace. */
  path: string;
}

export interface RouteTokenClaims {
  routeId: RouteId;
  expiresAt: string;
  nonce: string;
}

export type RouteTokenFailure =
  | 'formato_invalido'
  | 'firma_invalida'
  | 'token_expirado'
  | 'token_revocado';

export type RouteTokenVerification =
  | { valid: true; claims: RouteTokenClaims }
  | { valid: false; reason: RouteTokenFailure };

/** Emite un enlace de ruta. `ttlHours` permite acortar la vigencia por caso. */
export async function issueRouteToken(
  routeId: RouteId,
  options?: { ttlHours?: number; now?: Date },
): Promise<IssuedRouteToken> {
  const env = getServerEnv();
  const now = options?.now ?? new Date();
  const ttlHours = options?.ttlHours ?? env.DRIVER_TOKEN_TTL_HOURS;
  const expiresAt = new Date(now.getTime() + ttlHours * 3_600_000).toISOString();

  const nonce = encode(randomBytes(NONCE_BYTES));
  const payload = [VERSION, encode(Buffer.from(routeId, 'utf8')), encode(Buffer.from(expiresAt, 'utf8')), nonce].join('.');
  const token = `${payload}.${encode(sign(payload))}`;

  if (isSupabaseConfigured()) {
    const { error } = await getSupabaseClient().from(LEDGER_TABLE).insert({
      ruta_id: routeId,
      token_hash: hashToken(token),
      expira_at: expiresAt,
    });
    if (error) console.error('[route-token] no fue posible registrar el enlace emitido:', error.message);
  }

  return { token, routeId, expiresAt, path: `/conductor/ruta/${token}` };
}

async function isRevoked(token: string): Promise<boolean> {
  if (isSupabaseConfigured()) {
    const { data, error } = await getSupabaseClient()
      .from(LEDGER_TABLE)
      .select('revocado_at')
      .eq('token_hash', hashToken(token))
      .maybeSingle<{ revocado_at: string | null }>();
    if (error) {
      console.error('[route-token] no fue posible verificar la revocacion:', error.message);
      return false;
    }
    return Boolean(data?.revocado_at);
  }
  return getRevokedMemory().has(token);
}

/**
 * Verifica un enlace.
 *
 * Devuelve el motivo del rechazo para poder registrarlo, pero quien llama no
 * debe mostrarselo al visitante: distinguir "firma invalida" de "expirado"
 * ayuda a quien esta probando tokens. La interfaz solo separa el caso
 * "expirado" porque ahi el conductor legitimo necesita pedir uno nuevo.
 */
export async function verifyRouteToken(
  token: string,
  options?: { now?: Date },
): Promise<RouteTokenVerification> {
  const now = options?.now ?? new Date();
  const parts = token.split('.');

  if (parts.length !== 5) return { valid: false, reason: 'formato_invalido' };

  const [version, encodedRoute, encodedExpiry, nonce, encodedSignature] = parts as [
    string, string, string, string, string,
  ];

  if (version !== VERSION) return { valid: false, reason: 'formato_invalido' };

  let signature: Buffer;
  try {
    signature = Buffer.from(encodedSignature, 'base64url');
  } catch {
    return { valid: false, reason: 'formato_invalido' };
  }
  if (signature.length !== SIGNATURE_BYTES) return { valid: false, reason: 'firma_invalida' };

  const payload = [version, encodedRoute, encodedExpiry, nonce].join('.');
  const expected = sign(payload);

  // Comparacion en tiempo constante: una comparacion normal filtra por
  // cuanto tarda en fallar cuantos bytes iniciales acerto quien prueba.
  if (!timingSafeEqual(expected, signature)) return { valid: false, reason: 'firma_invalida' };

  if (await isRevoked(token)) return { valid: false, reason: 'token_revocado' };

  const routeId = Buffer.from(encodedRoute, 'base64url').toString('utf8') as RouteId;
  const expiresAt = Buffer.from(encodedExpiry, 'base64url').toString('utf8');
  const expiry = Date.parse(expiresAt);

  if (!Number.isFinite(expiry)) return { valid: false, reason: 'formato_invalido' };
  if (expiry <= now.getTime()) return { valid: false, reason: 'token_expirado' };

  return { valid: true, claims: { routeId, expiresAt, nonce } };
}

/** Anula un enlace antes de su vencimiento (telefono perdido, cambio de turno). */
export async function revokeRouteToken(token: string, reason?: string): Promise<void> {
  if (isSupabaseConfigured()) {
    const { error } = await getSupabaseClient()
      .from(LEDGER_TABLE)
      .update({ revocado_at: new Date().toISOString(), revocado_motivo: reason ?? null })
      .eq('token_hash', hashToken(token));
    if (error) console.error('[route-token] no fue posible revocar el enlace:', error.message);
    return;
  }
  getRevokedMemory().add(token);
}

/** Solo para pruebas: reinicia la lista de revocados. */
export function resetRevokedTokens(): void {
  getRevokedMemory().clear();
}
