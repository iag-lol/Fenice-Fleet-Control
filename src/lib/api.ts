import { NextResponse } from 'next/server';
import { clientIpFromHeaders } from '@/lib/client-ip';

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
  // Los detalles del servidor nunca forman parte del contrato publico.
  void detail;
  return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
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
    return NextResponse.json(await fn(), { headers: NO_STORE_HEADERS });
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
  return clientIpFromHeaders(request.headers);
}

/** Verifica el origen completo y Fetch Metadata. La lista de produccion
 * proviene del entorno, nunca de X-Forwarded-Host suministrado en la solicitud.
 * Clientes de servidor sin Origin siguen necesitando una credencial valida.
 */
export function assertSameOrigin(request: Request): Response | null {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return apiError('Solicitud rechazada: origen no confiable.', 403);
  }
  const origin = request.headers.get('origin') ?? request.headers.get('referer');
  // Clientes sin navegador (curl, integraciones de servidor) no envian
  // `Origin`: se dejan pasar, la autenticacion por sesion ya los cubre.
  if (!origin) return null;

  const host = request.headers.get('host');
  // Sin `Host` no hay con que comparar: no se bloquea por una cabecera que
  // deberia existir siempre en HTTP/1.1+, para no convertir un caso raro en
  // una funcionalidad rota.
  if (!host && !process.env.APP_ALLOWED_ORIGINS) return apiError('Solicitud rechazada: origen no confiable.', 403);

  try {
    const supplied = new URL(origin).origin;
    const allowed = process.env.APP_ALLOWED_ORIGINS?.split(',').map((value) => new URL(value.trim()).origin)
      ?? [new URL(request.url).origin];
    if (!allowed.includes(supplied)) {
      return apiError('Solicitud rechazada: origen no confiable.', 403);
    }
    return null;
  } catch {
    return apiError('Solicitud rechazada: origen invalido.', 403);
  }
}
