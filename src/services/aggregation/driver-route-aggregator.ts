import 'server-only';

import { getServerEnv } from '@/config/env';
import { containsPoint } from '@/lib/engines/geofence-engine';
import { isUsableCoordinate } from '@/lib/geo';
import { getProofs } from '@/services/deliveries/proof-store';
import { getGpsProvider, getOperationsProvider } from '@/services/registry';
import { verifyRouteToken, type RouteTokenFailure } from '@/services/drivers/route-token';
import type {
  DriverRouteSession,
  DriverStop,
  Geofence,
  RouteId,
  WorkOrder,
  WorkOrderId,
  WorkOrderStatus,
} from '@/types/core';

/**
 * Vista de la jornada para el conductor.
 *
 * AISLAMIENTO: un enlace da acceso EXCLUSIVAMENTE a las paradas de su ruta.
 * Todo lo que se devuelve se filtra por `routeId` verificado en el token; no
 * se acepta ningun identificador de ruta o de parada que venga del cliente
 * sin contrastarlo contra esa ruta. Un conductor jamas ve la carga de otro,
 * ni la flota, ni los datos comerciales del cliente.
 */

/** Paradas que ya no admiten declaracion del conductor. */
const CLOSED_STATUSES: ReadonlySet<WorkOrderStatus> = new Set<WorkOrderStatus>([
  'visita_detectada',
  'completada',
  'incidencia',
  'cancelada',
]);

export type DriverSessionFailure = RouteTokenFailure | 'ruta_no_encontrada';

export type DriverSessionResult =
  | { ok: true; session: DriverRouteSession; routeId: RouteId; token: string }
  | { ok: false; reason: DriverSessionFailure };

function geofenceForWorkOrder(
  workOrder: WorkOrder,
  geofences: Geofence[],
): Geofence | null {
  if (workOrder.geofenceId) {
    return geofences.find((g) => g.id === workOrder.geofenceId) ?? null;
  }
  return (
    geofences.find((g) => g.kind === 'cliente' && g.clientId === workOrder.clientId) ?? null
  );
}

export async function loadDriverSession(token: string): Promise<DriverSessionResult> {
  const verification = await verifyRouteToken(token);
  if (!verification.valid) return { ok: false, reason: verification.reason };

  const { routeId, expiresAt } = verification.claims;
  const operations = getOperationsProvider();
  const gps = getGpsProvider();
  const env = getServerEnv();
  const now = new Date();

  const route = await operations.getRouteById(routeId);
  if (!route) return { ok: false, reason: 'ruta_no_encontrada' };

  // Solo las OT de esta ruta. El filtro va en la consulta, no despues: si el
  // proveedor devolviera de mas, no debe llegar a construirse la respuesta.
  const [workOrders, geofences, drivers, vehicles] = await Promise.all([
    operations.getWorkOrders({ routeId }),
    operations.getGeofences(),
    operations.getDrivers(),
    operations.getVehicles(),
  ]);

  const ownWorkOrders = workOrders.filter((wo) => wo.routeId === routeId);
  const driver = route.driverId ? drivers.find((d) => d.id === route.driverId) ?? null : null;
  const vehicle = route.vehicleId ? vehicles.find((v) => v.id === route.vehicleId) ?? null : null;

  const position = route.vehicleId ? await gps.getVehiclePosition(route.vehicleId) : null;
  const proofs = await getProofs(ownWorkOrders.map((wo) => wo.id));

  // Los pedidos se piden por cliente de esta ruta y se cruzan por id de
  // pedido; el conductor necesita saber que producto y cuantos litros lleva
  // a cada parada, no el historial comercial del cliente.
  const orders = await Promise.all(
    [...new Set(ownWorkOrders.map((wo) => wo.orderId))].map((id) => operations.getOrderById(id)),
  );
  const orderById = new Map(orders.filter((o) => o !== null).map((o) => [o.id, o]));

  const clients = await Promise.all(
    [...new Set(ownWorkOrders.map((wo) => wo.clientId))].map((id) => operations.getClientById(id)),
  );
  const clientById = new Map(clients.filter((c) => c !== null).map((c) => [c.id, c]));

  const stops: DriverStop[] = ownWorkOrders
    .map((workOrder): DriverStop => {
      const order = orderById.get(workOrder.orderId) ?? null;
      const client = clientById.get(workOrder.clientId) ?? null;
      const geofence = geofenceForWorkOrder(workOrder, geofences);
      const proof = proofs.get(workOrder.id) ?? null;

      // "Dentro de la geocerca" se calcula con la posicion del CAMION, no con
      // la del telefono: es la evidencia que respalda la entrega automatica.
      // El telefono puede estar dentro con el camion aun en la calle.
      const truckPoint = position && isUsableCoordinate(position) ? { lat: position.lat, lng: position.lng } : null;
      const radius =
        geofence?.geometry.shape === 'circle' ? geofence.geometry.radiusMeters : null;
      const insideGeofence =
        truckPoint !== null && geofence !== null && containsPoint(geofence, truckPoint);

      const lines = (order?.lines ?? []).map((line) => ({
        productName: line.description,
        liters: line.liters,
        hazardClass: line.hazardClass,
        compartment: line.compartment,
      }));

      return {
        sequence: workOrder.stopSequence ?? 0,
        workOrderId: workOrder.id,
        workOrderNumber: workOrder.number,
        orderNumber: workOrder.orderNumber,
        clientName: workOrder.clientName,
        addressLine: workOrder.addressLine,
        communeName: workOrder.communeName,
        coordinates: workOrder.coordinates,
        // Contacto de terreno unicamente: sirve para avisar que se llego.
        contactName: client?.contactName ?? null,
        contactPhone: client?.phone ?? null,
        scheduledWindowStart: workOrder.scheduledWindowStart,
        scheduledWindowEnd: workOrder.scheduledWindowEnd,
        estimatedArrivalAt: workOrder.estimatedArrivalAt,
        status: workOrder.status,
        priority: workOrder.priority,
        lines,
        totalLiters: lines.reduce((sum, line) => sum + line.liters, 0),
        notes: workOrder.notes,
        insideGeofence,
        geofenceRadiusMeters: radius,
        proof,
        actionable: !CLOSED_STATUSES.has(workOrder.status) && proof === null,
      };
    })
    .sort((a, b) => a.sequence - b.sequence);

  const completedStops = stops.filter(
    (s) => s.status === 'visita_detectada' || s.status === 'completada',
  ).length;
  const incidentStops = stops.filter((s) => s.status === 'incidencia').length;
  const pendingStops = stops.filter((s) => s.actionable).length;

  return {
    ok: true,
    routeId,
    token,
    session: {
      routeId,
      routeCode: route.code,
      routeName: route.name,
      date: route.date,
      status: route.status,
      driverName: driver?.fullName ?? null,
      vehiclePlate: vehicle?.plate ?? null,
      vehicleLabel: vehicle ? `${vehicle.fleetCode} · ${vehicle.brand} ${vehicle.model}` : null,
      vehicleCapacityLiters: vehicle?.capacityLiters ?? null,
      stops,
      totalStops: stops.length,
      completedStops,
      incidentStops,
      pendingStops,
      totalLiters: stops.reduce((sum, stop) => sum + stop.totalLiters, 0),
      nextStopSequence: stops.find((s) => s.actionable)?.sequence ?? null,
      deliveryMode: env.DELIVERY_DETECTION_MODE,
      tokenExpiresAt: expiresAt,
      serverTime: now.toISOString(),
    },
  };
}

/**
 * Resuelve una parada dentro de la sesion verificada.
 *
 * Es el punto que impide que un conductor cierre la parada de otra ruta
 * enviando un identificador ajeno: la parada tiene que estar en SU sesion.
 */
export function findOwnStop(
  session: DriverRouteSession,
  workOrderId: WorkOrderId,
): DriverStop | null {
  return session.stops.find((stop) => stop.workOrderId === workOrderId) ?? null;
}
