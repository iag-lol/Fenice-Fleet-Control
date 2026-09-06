import { z } from 'zod';

import { apiError, assertSameOrigin, getClientIp } from '@/lib/api';
import { getServerEnv } from '@/config/env';
import {
  applyFailedAttempt,
  isIpRateLimited,
  isLocked,
  recordLoginAttempt,
  type LoginFailureReason,
} from '@/lib/login-guard';
import { getDecoyHash, verifyPassword } from '@/lib/password';
import { normalizeRut } from '@/lib/rut';
import { createSession } from '@/lib/session';
import { isSupabaseConfigured, getSupabaseClient } from '@/lib/supabase/server-client';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const loginSchema = z.object({
  rut: z.string().trim().min(3).max(20),
  password: z.string().min(1).max(200),
});

interface UsuarioRow {
  id: string;
  rut: string;
  nombre_completo: string;
  rol: string;
  activo: boolean;
  password_hash: string;
  intentos_fallidos: number;
  bloqueado_hasta: string | null;
}

/** Mensaje unico para toda credencial invalida: no distingue el motivo real. */
const GENERIC_ERROR = 'RUT o contraseña incorrectos.';

/**
 * Login por RUT y contrasena contra la tabla `usuarios`.
 *
 * Deliberadamente NO usa Supabase Auth: valida a mano contra el hash
 * guardado y emite su propia sesion (ver `src/lib/session.ts`). El mensaje de
 * error es identico sin importar si el RUT no existe, la cuenta esta inactiva
 * o la contrasena es incorrecta, y el tiempo de respuesta se iguala con un
 * hash señuelo cuando el usuario no existe, para no permitir enumerar RUT
 * validos por ninguna via.
 */
export async function POST(request: Request): Promise<Response> {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  if (!isSupabaseConfigured()) {
    return apiError('El inicio de sesion no esta disponible: Supabase no esta configurado.', 503);
  }

  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError('Ingresa tu RUT y tu contrasena.', 400);
  }

  const ip = getClientIp(request);
  const userAgent = request.headers.get('user-agent');
  const rutIntentado = parsed.data.rut;

  const fail = async (motivo: LoginFailureReason, status: number, message = GENERIC_ERROR) => {
    await recordLoginAttempt({ rutIntentado, ip, userAgent }, { exitoso: false, motivo });
    return apiError(message, status);
  };

  if (await isIpRateLimited(ip)) {
    return fail('credenciales_invalidas', 429, 'Demasiados intentos. Intenta nuevamente mas tarde.');
  }

  const normalizedRut = normalizeRut(rutIntentado);
  if (!normalizedRut) {
    // Se compara igual contra el hash señuelo para no revelar por timing que
    // el formato ya descarto el intento antes de tocar la base de datos.
    await verifyPassword(parsed.data.password, await getDecoyHash());
    return fail('rut_invalido', 401);
  }

  const supabase = getSupabaseClient();
  const { data: usuario, error } = await supabase
    .from('usuarios')
    .select(
      'id, rut, nombre_completo, rol, activo, password_hash, intentos_fallidos, bloqueado_hasta',
    )
    .eq('rut', normalizedRut)
    .maybeSingle<UsuarioRow>();

  if (error) {
    console.error('[auth/login] error consultando usuarios:', error.message);
    return apiError('El inicio de sesion no esta disponible en este momento.', 503);
  }

  if (!usuario) {
    await verifyPassword(parsed.data.password, await getDecoyHash());
    return fail('credenciales_invalidas', 401);
  }

  if (isLocked({ intentosFallidos: usuario.intentos_fallidos, bloqueadoHasta: usuario.bloqueado_hasta })) {
    return fail(
      'usuario_bloqueado',
      429,
      'Cuenta bloqueada temporalmente por demasiados intentos. Intenta nuevamente mas tarde.',
    );
  }

  if (!usuario.activo) {
    await verifyPassword(parsed.data.password, await getDecoyHash());
    return fail('usuario_inactivo', 401);
  }

  const validPassword = await verifyPassword(parsed.data.password, usuario.password_hash);
  if (!validPassword) {
    const nextState = applyFailedAttempt({
      intentosFallidos: usuario.intentos_fallidos,
      bloqueadoHasta: usuario.bloqueado_hasta,
    });
    await supabase
      .from('usuarios')
      .update({ intentos_fallidos: nextState.intentosFallidos, bloqueado_hasta: nextState.bloqueadoHasta })
      .eq('id', usuario.id);
    return fail('credenciales_invalidas', 401);
  }

  await supabase
    .from('usuarios')
    .update({
      intentos_fallidos: 0,
      bloqueado_hasta: null,
      ultimo_login_at: new Date().toISOString(),
      ultimo_login_ip: ip,
    })
    .eq('id', usuario.id);

  await createSession(usuario.id, { ip, userAgent });
  await recordLoginAttempt({ rutIntentado, ip, userAgent }, { exitoso: true });

  const env = getServerEnv();
  return NextResponse.json({
    id: usuario.id,
    rut: usuario.rut,
    nombreCompleto: usuario.nombre_completo,
    rol: usuario.rol,
    sessionTtlHours: env.SESSION_TTL_HOURS,
  });
}
