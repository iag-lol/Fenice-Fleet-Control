import { guardApi, handleApi } from '@/lib/api';
import { getOperationsProvider } from '@/services/registry';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const denied = await guardApi('rutas.ver');
  if (denied) return denied;

  return handleApi(async () => {
    const operations = getOperationsProvider();
    const [routes, vehicles, drivers] = await Promise.all([
      operations.getRoutes(),
      operations.getVehicles(),
      operations.getDrivers(),
    ]);

    const plates = new Map(vehicles.map((v) => [v.id as string, v.plate]));
    const driverNames = new Map(drivers.map((d) => [d.id as string, d.fullName]));

    return {
      generatedAt: new Date().toISOString(),
      // El listado no dibuja mapas: enviarle el corredor planificado y la
      // traza ejecutada de cada ruta anadia cientos de kilobytes de
      // coordenadas que nadie usa. La geometria se sirve en el detalle.
      routes: routes.map(({ plannedPath: _plannedPath, executedPath: _executedPath, ...route }) => ({
        ...route,
        plannedPath: [],
        executedPath: [],
        vehiclePlate: route.vehicleId ? (plates.get(route.vehicleId) ?? null) : null,
        driverName: route.driverId ? (driverNames.get(route.driverId) ?? null) : null,
      })),
    };
  }, 'las rutas');
}
