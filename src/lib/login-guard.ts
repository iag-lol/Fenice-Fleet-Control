import 'server-only';

import { getServerEnv } from '@/config/env';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server-client';

/**
 * Limite de intentos de login y su auditoria.
 *
 * Cada intento (exitoso o no) queda en `intentos_login`, con el RUT probado,
 * la IP y el resultado. El bloqueo se guarda en la propia fila de
 * `usuarios` (`intentos_fallidos`, `bloqueado_hasta`): es lo que se consulta
 * en cada intento, y sobrevive a reinicios y a multiples instancias
 * serverless, a diferencia de un contador en memoria.
 */

export interface LoginAttemptContext {
  rutIntentado: string;
  ip: string | null;
  userAgent: string | null;
}

export type LoginFailureReason =
  | 'credenciales_invalidas'
  | 'usuario_inactivo'
  | 'usuario_bloqueado'
  | 'rut_invalido';

/** Registra el intento. No lanza: un fallo de auditoria no debe bloquear el login. */
export async function recordLoginAttempt(
  ctx: LoginAttemptContext,
  outcome: { exitoso: boolean; motivo?: LoginFailureReason },
): Promise<void> {
  if (!isSupabaseConfigured()) return;

  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('intentos_login').insert({
      rut_intentado: ctx.rutIntentado,
      exitoso: outcome.exitoso,
      motivo: outcome.motivo ?? null,
      ip: ctx.ip,
      user_agent: ctx.userAgent,
    });
    if (error) console.error('[login-guard] no fue posible registrar el intento:', error.message);
  } catch (error) {
    console.error('[login-guard] no fue posible registrar el intento:', error);
  }
}

/**
 * Limite adicional por IP, independiente de la cuenta.
 *
 * El bloqueo por cuenta (`usuarios.bloqueado_hasta`) no alcanza si alguien
 * prueba muchos RUT distintos desde la misma direccion en vez de insistir
 * con uno solo. Se permite mas margen que el bloqueo por cuenta (una oficina
 * o un NAT compartido genera trafico legitimo desde una sola IP), pero sigue
 * acotado.
 */
export async function isIpRateLimited(ip: string | null, now: Date = new Date()): Promise<boolean> {
  if (!ip || !isSupabaseConfigured()) return false;

  const env = getServerEnv();
  const windowStart = new Date(now.getTime() - env.LOGIN_LOCKOUT_MINUTES * 60_000).toISOString();
  const threshold = env.LOGIN_MAX_ATTEMPTS * 4;

  try {
    const supabase = getSupabaseClient();
    const { count, error } = await supabase
      .from('intentos_login')
      .select('id', { count: 'exact', head: true })
      .eq('ip', ip)
      .eq('exitoso', false)
      .gte('creado_at', windowStart);

    if (error) {
      console.error('[login-guard] no fue posible evaluar el limite por IP:', error.message);
      return false;
    }
    return (count ?? 0) >= threshold;
  } catch (error) {
    console.error('[login-guard] no fue posible evaluar el limite por IP:', error);
    return false;
  }
}

export interface UsuarioLockState {
  intentosFallidos: number;
  bloqueadoHasta: string | null;
}

/** `true` si la cuenta esta actualmente bloqueada por exceso de intentos. */
export function isLocked(state: UsuarioLockState, now: Date = new Date()): boolean {
  return Boolean(state.bloqueadoHasta && new Date(state.bloqueadoHasta).getTime() > now.getTime());
}

/**
 * Aplica un intento fallido: incrementa el contador y, al alcanzar el limite,
 * fija `bloqueado_hasta`. Devuelve el nuevo estado para persistirlo.
 */
export function applyFailedAttempt(
  state: UsuarioLockState,
  now: Date = new Date(),
): UsuarioLockState {
  const env = getServerEnv();
  const intentosFallidos = state.intentosFallidos + 1;

  const bloqueadoHasta =
    intentosFallidos >= env.LOGIN_MAX_ATTEMPTS
      ? new Date(now.getTime() + env.LOGIN_LOCKOUT_MINUTES * 60_000).toISOString()
      : state.bloqueadoHasta;

  return { intentosFallidos, bloqueadoHasta };
}
