import { apiError, guardApi } from '@/lib/api';
import { canUseFeature } from '@/product/feature-access';
import { getProof } from '@/services/deliveries/proof-store';
import { getOperationsProvider } from '@/services/registry';
import { asWorkOrderId } from '@/types/core';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workOrderId: string }> },
): Promise<Response> {
  const denied = await guardApi('ordenes.ver');
  if (denied) return denied;

  const { workOrderId } = await params;

  try {
    const operations = getOperationsProvider();
    const workOrder = await operations.getWorkOrderById(asWorkOrderId(workOrderId));
    if (!workOrder) return apiError('Orden de trabajo no encontrada.', 404);

    const [order, client, vehicles, drivers, route] = await Promise.all([
      operations.getOrderById(workOrder.orderId),
      operations.getClientById(workOrder.clientId),
      operations.getVehicles(),
      operations.getDrivers(),
      workOrder.routeId ? operations.getRouteById(workOrder.routeId) : Promise.resolve(null),
    ]);

    const vehicle = workOrder.vehicleId
      ? (vehicles.find((v) => v.id === workOrder.vehicleId) ?? null)
      : null;
    const driver = workOrder.driverId
      ? (drivers.find((d) => d.id === workOrder.driverId) ?? null)
      : null;

    // La evidencia de terreno solo viaja si el plan la incluye: en Plan
    // Basico no existe el portal del conductor y no hay nada que mostrar.
    const proof = canUseFeature('proof-of-delivery') ? await getProof(workOrder.id) : null;

    return NextResponse.json({ workOrder, order, client, vehicle, driver, route, proof });
  } catch (error) {
    return apiError(
      'No fue posible obtener la orden de trabajo.',
      503,
      error instanceof Error ? error.message : String(error),
    );
  }
}
