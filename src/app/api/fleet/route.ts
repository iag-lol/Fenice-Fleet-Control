import { NextResponse } from 'next/server';

import { assertSameOrigin, getClientIp, guardApi, handleApi } from '@/lib/api';
import { getAuthContext } from '@/lib/auth';
import { logAction } from '@/lib/audit';
import { loadFleetSnapshots } from '@/services/aggregation/fleet-aggregator';
import { createVehicle, vehicleInputSchema } from '@/services/fleet/vehicle-store';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const denied = await guardApi('flota.ver');
  if (denied) return denied;

  return handleApi(() => loadFleetSnapshots(), 'la flota');
}

/** Da de alta un vehiculo. Artefacto propio de la plataforma: no toca el ERP de Fenice. */
export async function POST(request: Request): Promise<Response> {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const denied = await guardApi('flota.editar');
  if (denied) return denied;

  const parsed = vehicleInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'El vehiculo no es valido.',
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      },
      { status: 400 },
    );
  }

  const result = await createVehicle(parsed.data);
  if (!result.ok || !result.vehicle) {
    return NextResponse.json({ error: result.error ?? 'No fue posible crear el vehiculo.' }, { status: 409 });
  }

  const context = await getAuthContext();
  void logAction({
    userId: context.userId,
    action: 'vehiculo.crear',
    entity: 'vehiculos',
    entityId: result.vehicle.id,
    detail: { patente: result.vehicle.plate, codigoFlota: result.vehicle.fleetCode },
    ip: getClientIp(request),
  });

  return NextResponse.json(result.vehicle, { status: 201 });
}
