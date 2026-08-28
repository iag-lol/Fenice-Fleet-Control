import { isUsableCoordinate } from '@/lib/geo';
import type { Route } from '@/types/core';
import type { RouteGeometry } from '@/types/views';

/**
 * Convierte una ruta del modelo interno a la geometria que consume el mapa.
 *
 * Existe una version equivalente en el servidor (`toRouteGeometry`); esta se
 * usa cuando la ruta llega completa desde la API y el cliente solo necesita
 * proyectarla. Ambas comparten la misma forma de salida.
 */
export function toRouteGeometryClient(route: Route, vehiclePlate: string | null): RouteGeometry {
  return {
    routeId: route.id,
    code: route.code,
    name: route.name,
    vehicleId: route.vehicleId,
    vehiclePlate,
    status: route.status,
    plannedPath: route.plannedPath,
    executedPath: route.executedPath,
    stops: route.stops
      .filter((stop) => isUsableCoordinate(stop.coordinates))
      .map((stop) => ({
        sequence: stop.sequence,
        workOrderId: stop.workOrderId,
        clientName: stop.clientName,
        addressLine: stop.addressLine,
        lat: stop.coordinates!.lat,
        lng: stop.coordinates!.lng,
        status: stop.status,
        plannedArrivalAt: stop.plannedArrivalAt,
        actualArrivalAt: stop.actualArrivalAt,
      })),
  };
}
