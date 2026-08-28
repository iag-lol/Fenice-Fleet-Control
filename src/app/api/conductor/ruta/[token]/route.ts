import { NextResponse } from 'next/server';

import { apiError, NO_STORE_HEADERS } from '@/lib/api';
import { loadDriverSession } from '@/services/aggregation/driver-route-aggregator';
import { getProofLimits } from '@/services/deliveries/proof-store';
import { driverAccessFailure } from '@/services/drivers/driver-api';
import { canUseFeature } from '@/product/feature-access';

export const dynamic = 'force-dynamic';

/** Jornada del conductor. La credencial es el propio enlace. */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;

  // El plan se comprueba tambien aqui: el middleware no cubre `/api`, y sin
  // esto un enlace emitido antes de bajar de plan seguiria abriendo la ruta.
  if (!canUseFeature('driver-portal')) {
    return apiError('Enlace no valido.', 404);
  }

  try {
    const result = await loadDriverSession(token);
    if (!result.ok) return driverAccessFailure(result.reason);

    const response = NextResponse.json({ session: result.session, limits: getProofLimits() });
    for (const [key, value] of Object.entries(NO_STORE_HEADERS)) response.headers.set(key, value);
    return response;
  } catch (error) {
    return apiError(
      'No fue posible cargar la ruta en este momento.',
      503,
      error instanceof Error ? error.message : String(error),
    );
  }
}
