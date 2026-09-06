import { NO_STORE_HEADERS } from '@/lib/api';
import { getAuthContext } from '@/lib/auth';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Perfil de la sesion vigente, para el encabezado de la aplicacion. */
export async function GET(): Promise<Response> {
  const context = await getAuthContext();

  const response = NextResponse.json({
    authenticated: context.authenticated,
    openAccess: context.openAccess,
    displayName: context.displayName,
    role: context.role,
  });
  for (const [key, value] of Object.entries(NO_STORE_HEADERS)) response.headers.set(key, value);
  return response;
}
