import { assertSameOrigin } from '@/lib/api';
import { destroySessionFromCookies } from '@/lib/session';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Cierra la sesion actual: revoca la fila en `sesiones` y borra la cookie. */
export async function POST(request: Request): Promise<Response> {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  await destroySessionFromCookies();
  return NextResponse.json({ ok: true });
}
