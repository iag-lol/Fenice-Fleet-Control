import 'server-only';

import { NextResponse } from 'next/server';

import { apiError } from '@/lib/api';
import type { DriverSessionFailure } from '@/services/aggregation/driver-route-aggregator';

/**
 * Respuesta comun ante un enlace rechazado.
 *
 * Se responde 404 en casi todos los casos para no confirmarle a quien prueba
 * tokens si acerto el formato, la firma o la ruta. La unica excepcion es el
 * enlace vencido: ahi el conductor legitimo necesita saber que debe pedir uno
 * nuevo, y quien no lo tiene tampoco aprende nada util.
 */
export function driverAccessFailure(reason: DriverSessionFailure): NextResponse {
  if (reason === 'token_expirado') {
    return apiError('Este enlace caduco. Pide uno nuevo a la central.', 410);
  }
  return apiError('Enlace no valido.', 404);
}
