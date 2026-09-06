import { NextResponse } from 'next/server';

import { apiError, assertSameOrigin, NO_STORE_HEADERS } from '@/lib/api';
import {
  findOwnStop,
  loadDriverSession,
} from '@/services/aggregation/driver-route-aggregator';
import { deliveryProofInputSchema, recordDeliveryProof } from '@/services/deliveries/proof-store';
import { driverAccessFailure } from '@/services/drivers/driver-api';
import { canUseFeature } from '@/product/feature-access';
import type { WorkOrderId } from '@/types/core';

export const dynamic = 'force-dynamic';

/**
 * Cierre de una parada por el conductor: entrega o incidencia.
 *
 * AISLAMIENTO: la parada se busca DENTRO de la sesion que abre el token. Un
 * identificador de otra ruta no encuentra parada y se responde 404, de modo
 * que el enlace de un conductor no puede tocar la jornada de otro.
 *
 * IDEMPOTENCIA: el telefono reintenta al recuperar senal. Un reenvio devuelve
 * la evidencia ya registrada con 200 y `duplicate: true` en vez de crear una
 * segunda entrega. Ese contrato es lo que permite que la cola sin conexion
 * reintente sin miedo.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string; workOrderId: string }> },
): Promise<Response> {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const { token, workOrderId } = await params;

  // El plan se comprueba tambien aqui: el middleware no cubre `/api`, y sin
  // esto un enlace emitido antes de bajar de plan seguiria abriendo la ruta.
  if (!canUseFeature('driver-portal')) {
    return apiError('Enlace no valido.', 404);
  }

  const result = await loadDriverSession(token);
  if (!result.ok) return driverAccessFailure(result.reason);

  const stop = findOwnStop(result.session, decodeURIComponent(workOrderId) as WorkOrderId);
  if (!stop) return apiError('Esta parada no pertenece a tu ruta.', 404);

  const parsed = deliveryProofInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Faltan datos para cerrar la parada.',
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      },
      { status: 400 },
    );
  }

  const recorded = await recordDeliveryProof(parsed.data, {
    workOrderId: stop.workOrderId,
    routeId: result.session.routeId,
    driverId: null,
    vehicleId: null,
    clientCoordinates: stop.coordinates,
  });

  if (!recorded.ok) return apiError(recorded.error, 400);

  const response = NextResponse.json(
    { proof: recorded.proof, duplicate: recorded.duplicate },
    { status: recorded.duplicate ? 200 : 201 },
  );
  for (const [key, value] of Object.entries(NO_STORE_HEADERS)) response.headers.set(key, value);
  return response;
}
