import { NextResponse } from 'next/server';

import {
  ForbiddenError,
  requireAuth,
  requirePermission,
  UnauthorizedError,
  type Permission,
} from '@/lib/auth';

/**
 * Utilidades comunes de las rutas de API.
 *
 * Toda respuesta de error usa la misma forma para que el cliente pueda
 * mostrar un mensaje util sin adivinar el formato.
 */

export interface ApiErrorBody {
  error: string;
  detail?: string;
}

export function apiError(message: string, status: number, detail?: string): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error: message, ...(detail ? { detail } : {}) }, { status });
}

/**
 * Envuelve un handler capturando cualquier fallo del proveedor.
 *
 * Una caida del GPS o de la base externa no debe devolver un stack al
 * navegador ni tumbar la ruta: se traduce a un 503 con mensaje en espanol.
 */
export async function handleApi<T>(
  fn: () => Promise<T>,
  context: string,
): Promise<NextResponse<T | ApiErrorBody>> {
  try {
    return NextResponse.json(await fn());
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[api] ${context}:`, detail);
    return apiError(`No fue posible obtener ${context}.`, 503, detail);
  }
}

/** Cabeceras para respuestas que nunca deben cachearse. */
export const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
} as const;

/**
 * Exige sesion (o un permiso concreto) al inicio de un handler de API.
 *
 * Devuelve la respuesta de error lista para retornar, o `null` cuando el
 * acceso esta permitido. Centraliza el try/catch que antes se repetia en
 * cada ruta que llamaba a `requireAuth()`/`requirePermission()` a mano.
 */
export async function guardApi(permission?: Permission): Promise<Response | null> {
  try {
    if (permission) await requirePermission(permission);
    else await requireAuth();
    return null;
  } catch (error) {
    if (error instanceof UnauthorizedError) return apiError(error.message, 401);
    if (error instanceof ForbiddenError) return apiError(error.message, 403);
    throw error;
  }
}

/**
 * Direccion IP del cliente, a partir de las cabeceras que fija el proxy
 * (Vercel u otro). El objeto `Request` estandar no expone la IP directamente.
 */
export function getClientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? null;
  return request.headers.get('x-real-ip');
}

/**
 * Verifica que una peticion que muta estado provenga del propio sitio.
 *
 * Es una capa adicional sobre la cookie de sesion `SameSite=Lax`: protege
 * ademas contra el caso de un subdominio o proxy donde `SameSite` por si solo
 * no basta. Compara el origen declarado por el navegador (`Origin`, y si no
 * viene, `Referer`) contra el host de la propia peticion.
 */
export function assertSameOrigin(request: Request): Response | null {
  const origin = request.headers.get('origin') ?? request.headers.get('referer');
  // Clientes sin navegador (curl, integraciones de servidor) no envian
  // `Origin`: se dejan pasar, la autenticacion por sesion ya los cubre.
  if (!origin) return null;

  try {
    const originHost = new URL(origin).host;
    const requestHost = new URL(request.url).host;
    if (originHost !== requestHost) {
      return apiError('Solicitud rechazada: origen no confiable.', 403);
    }
    return null;
  } catch {
    return apiError('Solicitud rechazada: origen invalido.', 403);
  }
}
