import { NextResponse, type NextRequest } from 'next/server';

import { getBlockedRoutes } from '@/product/feature-access';

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

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  const blocked = BLOCKED.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  if (!blocked) return NextResponse.next();

  // Se reescribe a una ruta inexistente para que Next sirva su pagina de
  // "no encontrado" con el estado correcto, sin revelar que la pantalla
  // existe pero esta restringida.
  return NextResponse.rewrite(new URL('/404', request.url), { status: 404 });
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
