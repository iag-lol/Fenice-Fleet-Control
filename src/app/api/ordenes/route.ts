import { handleApi } from '@/lib/api';
import { getOperationsProvider } from '@/services/registry';

export const dynamic = 'force-dynamic';

/** Ordenes de trabajo. Sin filtro de fecha devuelve la ventana disponible. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const date = url.searchParams.get('fecha');

  return handleApi(async () => {
    const operations = getOperationsProvider();
    const [workOrders, vehicles, drivers] = await Promise.all([
      operations.getWorkOrders(date ? { date } : { limit: 600 }),
      operations.getVehicles(),
      operations.getDrivers(),
    ]);

    const plates = new Map(vehicles.map((v) => [v.id as string, v.plate]));
    const driverNames = new Map(drivers.map((d) => [d.id as string, d.fullName]));

    return {
      generatedAt: new Date().toISOString(),
      workOrders: workOrders.map((w) => ({
        ...w,
        vehiclePlate: w.vehicleId ? (plates.get(w.vehicleId) ?? null) : null,
        driverName: w.driverId ? (driverNames.get(w.driverId) ?? null) : null,
      })),
    };
  }, 'las ordenes de trabajo');
}
