import { apiError, NO_STORE_HEADERS } from '@/lib/api';
import { loadTrackingSession } from '@/services/aggregation/tracking-aggregator';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Seguimiento publico por numero de orden. Sin autenticacion, por diseno.
 *
 * La respuesta es la proyeccion minima definida en `TrackingSession`; no
 * expone entidades internas. Se responde 404 tanto cuando la referencia no
 * existe como cuando es demasiado corta, para no convertir el endpoint en un
 * oraculo que permita enumerar numeros de orden validos.
 */
export async function GET(request: Request): Promise<Response> {
  const reference = new URL(request.url).searchParams.get('ref')?.trim() ?? '';

  if (reference.length < 4) {
    return apiError('Ingresa un numero de pedido u orden de trabajo valido.', 400);
  }

  try {
    const session = await loadTrackingSession({ reference });
    if (!session) {
      return apiError('No encontramos un pedido con ese numero.', 404);
    }

    const response = NextResponse.json(session);
    for (const [key, value] of Object.entries(NO_STORE_HEADERS)) response.headers.set(key, value);
    return response;
  } catch (error) {
    return apiError(
      'El servicio de seguimiento no esta disponible en este momento.',
      503,
      error instanceof Error ? error.message : String(error),
    );
  }
}
