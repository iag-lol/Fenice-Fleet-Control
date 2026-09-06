import 'server-only';

import { cookies } from 'next/headers';

import { getServerEnv } from '@/config/env';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server-client';
import type { Role } from '@/lib/auth';

/**
 * Sesiones de login propias (RUT + contrasena), sin Supabase Auth.
 *
 * La cookie del navegador solo contiene un token opaco de 32 bytes
 * aleatorios. En la tabla `sesiones` se guarda unicamente el SHA-256 de ese
 * token (`token_hash`), nunca el token en si: si la base de datos se filtra,
 * no expone sesiones utilizables (equivalente a como se guardan contrasenas,
 * aplicado a credenciales de sesion).
 *
 * La autoridad sobre revocacion y vigencia vive siempre en esta tabla: la
 * cookie por si sola no basta para entrar, tiene que seguir existiendo una
 * fila valida en `sesiones`.
 *
 * Usa exclusivamente Web Crypto (`crypto.subtle`, `crypto.getRandomValues`)
 * en vez de `node:crypto`: este modulo lo importa `src/middleware.ts`, que
 * Next.js compila para el Edge Runtime, donde los esquemas `node:` no estan
 * soportados por el empaquetador. Web Crypto esta disponible tanto en Node
 * (desde la v20, la minima que exige este proyecto) como en Edge, asi que el
 * mismo codigo sirve para ambos sin duplicarlo.
 */

export const SESSION_COOKIE_NAME = 'fenice_session';

export interface SessionUser {
  id: string;
  rut: string;
  nombreCompleto: string;
  rol: Role;
}

export interface SessionRequestContext {
  ip: string | null;
  userAgent: string | null;
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Token opaco de 32 bytes aleatorios, codificado en base64url. */
function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface SesionRow {
  id: string;
  expira_at: string;
  revocada_at: string | null;
  usuarios: {
    id: string;
    rut: string;
    nombre_completo: string;
    rol: string;
    activo: boolean;
  } | { id: string; rut: string; nombre_completo: string; rol: string; activo: boolean }[] | null;
}

function isKnownRole(value: string): value is Role {
  return value === 'administrador' || value === 'supervisor' || value === 'operador' || value === 'invitado';
}

/**
 * Resuelve la sesion a partir del token crudo (el que trae la cookie).
 *
 * No depende de `next/headers`: la usan tanto las rutas de API/Server
 * Components (via `resolveSessionFromCookies`) como el middleware, que lee la
 * cookie directamente de la peticion.
 */
export async function resolveSessionByToken(token: string): Promise<SessionUser | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('sesiones')
    .select('id, expira_at, revocada_at, usuarios!inner(id, rut, nombre_completo, rol, activo)')
    .eq('token_hash', await hashToken(token))
    .maybeSingle<SesionRow>();

  if (error || !data) return null;
  if (data.revocada_at) return null;
  if (new Date(data.expira_at).getTime() <= Date.now()) return null;

  const usuario = Array.isArray(data.usuarios) ? data.usuarios[0] : data.usuarios;
  if (!usuario || !usuario.activo || !isKnownRole(usuario.rol)) return null;

  // Informativo: no bloquea la respuesta ni su fallo invalida la sesion.
  void supabase
    .from('sesiones')
    .update({ ultimo_uso_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(({ error: touchError }) => {
      if (touchError) console.error('[session] no fue posible actualizar ultimo_uso_at:', touchError.message);
    });

  return {
    id: usuario.id,
    rut: usuario.rut,
    nombreCompleto: usuario.nombre_completo,
    rol: usuario.rol,
  };
}

/** Sesion vigente segun la cookie de la peticion actual. Server Components y Route Handlers. */
export async function resolveSessionFromCookies(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return resolveSessionByToken(token);
}

/**
 * Crea una sesion nueva y fija la cookie en la respuesta actual.
 *
 * Solo valida dentro de un Route Handler (donde `cookies().set()` esta
 * permitido). Se llama exclusivamente desde `POST /api/auth/login` tras
 * validar RUT y contrasena.
 */
export async function createSession(usuarioId: string, ctx: SessionRequestContext): Promise<void> {
  const env = getServerEnv();
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + env.SESSION_TTL_HOURS * 3_600_000);

  const supabase = getSupabaseClient();
  const { error } = await supabase.from('sesiones').insert({
    usuario_id: usuarioId,
    token_hash: await hashToken(token),
    expira_at: expiresAt.toISOString(),
    ip_creacion: ctx.ip,
    user_agent: ctx.userAgent,
  });

  if (error) throw new Error(`No fue posible crear la sesion: ${error.message}`);

  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

/** Revoca la sesion de la cookie actual (si existe) y la borra del navegador. */
export async function destroySessionFromCookies(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  store.delete(SESSION_COOKIE_NAME);
  if (!token) return;

  if (!isSupabaseConfigured()) return;
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('sesiones')
    .update({ revocada_at: new Date().toISOString() })
    .eq('token_hash', await hashToken(token));

  if (error) console.error('[session] no fue posible revocar la sesion:', error.message);
}
