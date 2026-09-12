import { NextResponse } from 'next/server';
import { z } from 'zod';

import { assertSameOrigin, guardApi, NO_STORE_HEADERS } from '@/lib/api';
import { testTraccarConnection } from '@/services/fleet/vehicle-gps-device';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  identifier: z.string().trim().min(1).max(100),
  serverUrl: z.string().trim().url().optional().or(z.literal('')),
});

/**
 * "Probar conexion" del dialogo "Conectar GPS". No guarda nada: solo
 * confirma, antes de asociar el dispositivo de verdad, que el identificador
 * ingresado corresponde a un equipo real que esta transmitiendo.
 */
export async function POST(request: Request): Promise<Response> {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const denied = await guardApi('flota.editar');
  if (denied) return denied;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Identificador invalido.' }, { status: 400 });
  }

  const result = await testTraccarConnection({
    identifier: parsed.data.identifier,
    serverUrl: parsed.data.serverUrl || undefined,
  });

  const response = NextResponse.json(result);
  for (const [key, value] of Object.entries(NO_STORE_HEADERS)) response.headers.set(key, value);
  return response;
}
