import { apiError, assertSameOrigin, getClientIp, guardApi } from '@/lib/api';
import { getAuthContext } from '@/lib/auth';
import { logAction } from '@/lib/audit';
import { loadVehicleDetail } from '@/services/aggregation/fleet-aggregator';
import { deleteVehicleFromStore } from '@/services/fleet/vehicle-store';
import { asVehicleId } from '@/types/core';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ vehicleId: string }> },
): Promise<Response> {
  const denied = await guardApi('flota.ver');
  if (denied) return denied;

  const { vehicleId } = await params;

  try {
    const detail = await loadVehicleDetail(asVehicleId(vehicleId));
    if (!detail) return apiError('Vehiculo no encontrado.', 404);
    return NextResponse.json(detail);
  } catch (error) {
    return apiError(
      'No fue posible obtener el detalle del vehiculo.',
      503,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/** Da de baja un vehiculo. No afecta al ERP: es un artefacto propio de la plataforma. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ vehicleId: string }> },
): Promise<Response> {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const denied = await guardApi('flota.editar');
  if (denied) return denied;

  const { vehicleId } = await params;
  const id = asVehicleId(vehicleId);
  if (!(await deleteVehicleFromStore(id))) {
    return apiError('Vehiculo no encontrado.', 404);
  }

  const context = await getAuthContext();
  void logAction({
    userId: context.userId,
    action: 'vehiculo.eliminar',
    entity: 'vehiculos',
    entityId: id,
    ip: getClientIp(request),
  });

  return new Response(null, { status: 204 });
}
