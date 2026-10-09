import { NextResponse, type NextRequest } from 'next/server';

import { getServerEnv } from '@/config/env';
import { getBlockedRoutes } from '@/product/feature-access';
import { checkRateLimit } from '@/lib/rate-limit';
import { resolveSessionByToken, SESSION_COOKIE_NAME } from '@/lib/session';
import { clientIpFromHeaders } from '@/lib/client-ip';
import { buildContentSecurityPolicy } from '@/lib/security-policy';

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
  return clientIpFromHeaders(request.headers) ?? 'desconocida';
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
  const nonce = btoa(crypto.randomUUID());
  const policy = buildContentSecurityPolicy(nonce, process.env.NODE_ENV !== 'production');
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', policy);
  const secure = (response: NextResponse) => {
    response.headers.set('Content-Security-Policy', policy);
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    // OSM necesita identificar el origen; nunca enviamos rutas ni tokens.
    response.headers.set('Referrer-Policy', 'strict-origin');
    return response;
  };
  // Archivos de configuracion y control de versiones nunca son paginas.
  if (/\/(?:\.env(?:\.[^/]*)?|\.git|\.fenice)(?:\/|$)/i.test(pathname)) {
    return secure(new NextResponse(null, { status: 404 }));
  }
  const declaredBytes = Number(request.headers.get('content-length'));
  const maxBytes = pathname.startsWith('/api/conductor/') ? 6 * 1024 * 1024 : 3 * 1024 * 1024;
  if (isApi && Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
    return secure(NextResponse.json({ error: 'Solicitud demasiado grande.' }, { status: 413 }));
  }

  // Limite de tasa: aplica a paginas y a la API por igual, ANTES de
  // cualquier otra comprobacion. Es deliberadamente lo primero que corre el
  // middleware.
  const ip = clientIp(request);
  const sensitive = isSensitivePublicPath(pathname);
  const limit = sensitive ? SENSITIVE_RATE_LIMIT : GENERAL_RATE_LIMIT;
  const rate = checkRateLimit(`${sensitive ? 'sens' : 'gen'}:${ip}`, limit, RATE_LIMIT_WINDOW_MS);
  if (!rate.allowed) return secure(tooManyRequests(rate.retryAfterSeconds));

  // La API gestiona su propia autenticacion y autorizacion por endpoint
  // (`guardApi()`), no por ruta: lo unico que le corresponde a este
  // middleware para `/api/**` es el limite de tasa de arriba.
  if (isApi) return secure(NextResponse.next({ request: { headers: requestHeaders } }));

  const blocked = BLOCKED.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  if (blocked) {
    // Se reescribe a una ruta inexistente para que Next sirva su pagina de
    // "no encontrado" con el estado correcto, sin revelar que la pantalla
    // existe pero esta restringida.
    return secure(NextResponse.rewrite(new URL('/404', request.url), { status: 404, request: { headers: requestHeaders } }));
  }

  const env = getServerEnv();
  if (env.AUTH_ENABLED && !isPublicPath(pathname)) {
    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    const session = token ? await resolveSessionByToken(token) : null;

    if (!session) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('next', pathname + request.nextUrl.search);
      return secure(NextResponse.redirect(loginUrl));
    }
  }

  return secure(NextResponse.next({ request: { headers: requestHeaders } }));
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
