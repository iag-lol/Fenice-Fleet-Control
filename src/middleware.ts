import { NextResponse, type NextRequest } from 'next/server';

import { getServerEnv } from '@/config/env';
import { getBlockedRoutes } from '@/product/feature-access';
import { checkRateLimit } from '@/lib/rate-limit';
import { resolveSessionByToken, SESSION_COOKIE_NAME } from '@/lib/session';

/**
 * Control de acceso por plan a nivel de ruta.
 *
 * Ocultar un enlace del menu NO es control de acceso: la pantalla seguiria
 * accesible escribiendo la URL. Esta comprobacion ocurre ANTES de renderizar,
 * de modo que una funcionalidad que el plan no incluye devuelve un 404 real y
 * no una pagina con estado 200 que dice "no encontrado".
 *
 * Se resuelve desde el mismo catalogo que gobierna la interfaz: no hay una
 * segunda lista de rutas que mantener sincronizada.
 */

const BLOCKED = getBlockedRoutes();

/**
 * Rutas que no exigen sesion: la propia pantalla de login, el seguimiento
 * publico del cliente final y el portal del conductor (su credencial es el
 * enlace firmado, no una sesion de esta plataforma).
 */
const PUBLIC_PREFIXES = ['/login', '/seguimiento', '/conductor'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Rutas de API que no pasan por sesion: el seguimiento publico del cliente,
 * el portal del conductor (su credencial es el enlace firmado) y el login.
 * Al no tener sesion que las limite indirectamente, quedan mas expuestas a
 * scripts y se acotan mas fuerte. `/api/auth/login` YA tiene su propio
 * bloqueo por cuenta e IP contra Supabase (`src/lib/login-guard.ts`); este
 * limite generico es una capa adicional que ademas cubre el caso sin
 * Supabase configurado, donde ese bloqueo especifico queda inactivo.
 */
const SENSITIVE_PUBLIC_PREFIXES = ['/api/seguimiento', '/api/conductor', '/api/auth/login'];

function isSensitivePublicPath(pathname: string): boolean {
  return SENSITIVE_PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Misma logica que `getClientIp()` de `src/lib/api.ts`, duplicada a proposito:
 * ese modulo importa de `@/lib/auth`, que no es seguro de traer al bundle de
 * Edge del middleware (es donde vivia el bug historico de `node:crypto`). */
function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'desconocida';
  return request.headers.get('x-real-ip') ?? 'desconocida';
}

const RATE_LIMIT_WINDOW_MS = 60_000;
/** Trafico normal de un panel en vivo: varias pestañas, sondeo cada pocos segundos. */
const GENERAL_RATE_LIMIT = 600;
/** Rutas sin sesion: mas expuestas a scripts, se acotan mas. */
const SENSITIVE_RATE_LIMIT = 60;

function tooManyRequests(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: 'Demasiadas solicitudes. Intenta nuevamente en unos segundos.' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
  );
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api/');

  // Limite de tasa: aplica a paginas y a la API por igual, ANTES de
  // cualquier otra comprobacion. Es deliberadamente lo primero que corre el
  // middleware.
  const ip = clientIp(request);
  const sensitive = isSensitivePublicPath(pathname);
  const limit = sensitive ? SENSITIVE_RATE_LIMIT : GENERAL_RATE_LIMIT;
  const rate = checkRateLimit(`${sensitive ? 'sens' : 'gen'}:${ip}`, limit, RATE_LIMIT_WINDOW_MS);
  if (!rate.allowed) return tooManyRequests(rate.retryAfterSeconds);

  // La API gestiona su propia autenticacion y autorizacion por endpoint
  // (`guardApi()`), no por ruta: lo unico que le corresponde a este
  // middleware para `/api/**` es el limite de tasa de arriba.
  if (isApi) return NextResponse.next();

  const blocked = BLOCKED.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  if (blocked) {
    // Se reescribe a una ruta inexistente para que Next sirva su pagina de
    // "no encontrado" con el estado correcto, sin revelar que la pantalla
    // existe pero esta restringida.
    return NextResponse.rewrite(new URL('/404', request.url), { status: 404 });
  }

  const env = getServerEnv();
  if (env.AUTH_ENABLED && !isPublicPath(pathname)) {
    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    const session = token ? await resolveSessionByToken(token) : null;

    if (!session) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('next', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  /**
   * Se excluyen solo los recursos estaticos. La API SI pasa por aqui ahora
   * (a diferencia de antes): necesita el limite de tasa de arriba, aunque su
   * autenticacion/autorizacion se resuelve en cada endpoint segun lo que
   * hace, no por ruta (varios endpoints sirven a la vez a Plan Basico y
   * Medio).
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
