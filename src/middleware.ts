import { NextResponse, type NextRequest } from 'next/server';

import { getServerEnv } from '@/config/env';
import { getBlockedRoutes } from '@/product/feature-access';
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

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

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
   * Se excluyen los recursos estaticos y la API.
   *
   * La API se protege en cada endpoint segun lo que hace, no por su ruta:
   * varios endpoints sirven a la vez a funciones Basicas y Medias.
   */
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
