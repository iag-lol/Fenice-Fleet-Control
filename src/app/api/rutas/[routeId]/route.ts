import { apiError } from '@/lib/api';
import { getOperationsProvider } from '@/services/registry';
import { asRouteId } from '@/types/core';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ routeId: string }> },
): Promise<Response> {
  const { routeId } = await params;

  try {
    const operations = getOperationsProvider();
    const route = await operations.getRouteById(asRouteId(routeId));
    if (!route) return apiError('Ruta no encontrada.', 404);

    const [vehicles, drivers, workOrders] = await Promise.all([
      operations.getVehicles(),
      operations.getDrivers(),
      operations.getWorkOrders({ routeId: asRouteId(routeId) }),
    ]);

    const vehicle = route.vehicleId
      ? (vehicles.find((v) => v.id === route.vehicleId) ?? null)
      : null;
    const driver = route.driverId ? (drivers.find((d) => d.id === route.driverId) ?? null) : null;

    return NextResponse.json({ route, vehicle, driver, workOrders });
  } catch (error) {
    return apiError(
      'No fue posible obtener la ruta.',
      503,
      error instanceof Error ? error.message : String(error),
    );
  }
}
