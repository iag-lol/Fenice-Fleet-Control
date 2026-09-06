import { z } from 'zod';

import { apiError, guardApi } from '@/lib/api';
import { geocodeAddress } from '@/services/geocoding/geocoding-provider';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  addressLine: z.string().trim().min(4).max(200),
  communeName: z.string().trim().max(100).optional(),
});

/**
 * Resuelve una direccion a coordenadas.
 *
 * Se usa desde formularios que crean una geocerca a partir de una direccion
 * (por ejemplo, un punto de partida u operacional) en vez de dibujarla a
 * mano. Requiere `GEOCODING_PROVIDER` configurado (ver .env.example); sin
 * proveedor, responde 503 explicando que falta configuracion en vez de
 * fingir una coordenada.
 */
export async function POST(request: Request): Promise<Response> {
  const denied = await guardApi('geocercas.editar');
  if (denied) return denied;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError('Indica una direccion valida.', 400);
  }

  const result = await geocodeAddress(parsed.data);
  if (!result) {
    return apiError(
      'No fue posible ubicar esa direccion. Verifica GEOCODING_PROVIDER o marca el punto directamente en el mapa.',
      503,
    );
  }

  return NextResponse.json(result);
}
