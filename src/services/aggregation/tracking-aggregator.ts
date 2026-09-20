import 'server-only';

import { getOperationalSettings } from '@/services/settings/settings-store';
import { evaluateConnectionState } from '@/lib/engines/gps-health';
import { isUsableCoordinate, projectOnPolyline, sliceCorridor } from '@/lib/geo';
import { isTrackingAllowed } from '@/lib/engines/delivery-detection';
import { estimateEta } from '@/services/eta/eta-service';
import { getGpsProvider, getOperationsProvider } from '@/services/registry';
import type { LatLng, TrackingSession, WorkOrderStatus } from '@/types/core';

/**
 * Seguimiento publico por numero de orden.
 *
 * PRIVACIDAD: esta es la unica superficie sin autenticacion que expone datos.
 * La proyeccion es deliberadamente minima. NO se entrega:
 *   - otros clientes ni otras OT,
 *   - la ruta completa del camion ni su historial,
 *   - datos comerciales, telefonos o informacion interna,
 *   - la patente completa del vehiculo.
 *
 * Se muestra la posicion del vehiculo unicamente mientras el pedido esta en
 * curso: una vez entregado, deja de compartirse.
 */

const PUBLIC_STATUS_LABEL: Record<WorkOrderStatus, string> = {
  pendiente: 'En preparacion',
  asignada: 'En preparacion',
  preparando: 'En preparacion',
  en_ruta: 'En camino',
  proxima: 'Proxima entrega',
  en_cliente: 'El vehiculo llego a destino',
  visita_detectada: 'Entregado',
  completada: 'Entregado',
  incidencia: 'Entrega con incidencia',
  cancelada: 'Pedido cancelado',
};

/** Estados en los que compartir la posicion del vehiculo tiene sentido. */
const SHARE_POSITION_STATUSES: ReadonlySet<WorkOrderStatus> = new Set<WorkOrderStatus>([
  'en_ruta',
  'proxima',
  'en_cliente',
]);

const CLOSED_STATUSES: ReadonlySet<WorkOrderStatus> = new Set<WorkOrderStatus>([
  'visita_detectada',
  'completada',
  'cancelada',
]);

/** Etiqueta anonimizada del vehiculo: nunca la patente completa. */
function publicVehicleLabel(plate: string, fleetCode: string): string {
  return `${fleetCode} · ${plate.slice(0, 2)}••${plate.slice(-2)}`;
}

export interface TrackingLookup {
  /** Numero de OT, numero de pedido o token de seguimiento. */
  reference: string;
}

export async function loadTrackingSession(
  lookup: TrackingLookup,
): Promise<TrackingSession | null> {
  const reference = lookup.reference.trim();
  if (reference.length < 4) return null;

  const operations = getOperationsProvider();
  const gps = getGpsProvider();
  const settings = getOperationalSettings();
  const now = new Date();

  const workOrder = await operations.getWorkOrderByNumber(reference);
  if (!workOrder) return null;

  const status = workOrder.status;
  const closed = CLOSED_STATUSES.has(status);

  /**
   * Corte del seguimiento.
   *
   * Es la decision de privacidad mas importante de esta superficie. En cuanto
   * la entrega queda registrada, el backend DEJA DE DEVOLVER la posicion del
   * vehiculo: no basta con ocultarla en la interfaz, porque recargar la pagina
   * o mirar la respuesta de la API la recuperaria.
   *
   * A partir de ese momento donde esta el camion ya no es asunto del
   * destinatario: puede ir camino de otro cliente.
   */
  const trackingAllowed = isTrackingAllowed(workOrder);

  // --- Progreso dentro de la ruta ------------------------------------------
  //
  // El progreso alimenta una barra de tres tramos (en preparacion, en camino,
  // entregado). La barra SOLO llega al final cuando el pedido esta entregado:
  // mostrar 100 % en un pedido que aun viaja le dice al cliente que ya lo
  // recibio. Mientras el pedido esta en curso, el avance se acota por debajo
  // del cierre.
  const PROGRESS_DISPATCH_FLOOR = 0.12;
  const PROGRESS_EN_ROUTE_CEILING = 0.85;
  const PROGRESS_AT_DESTINATION = 0.94;

  let remainingStops = 0;
  let progress: number;

  if (closed) {
    progress = 1;
  } else if (status === 'en_cliente') {
    progress = PROGRESS_AT_DESTINATION;
  } else if (SHARE_POSITION_STATUSES.has(status)) {
    progress = PROGRESS_DISPATCH_FLOOR;
  } else {
    // Todavia en preparacion: el pedido existe pero no ha salido.
    progress = PROGRESS_DISPATCH_FLOOR / 2;
  }

  if (workOrder.routeId) {
    const route = await operations.getRouteById(workOrder.routeId);
    if (route && route.stops.length > 0) {
      const index = route.stops.findIndex((s) => s.workOrderId === workOrder.id);
      if (index >= 0) {
        const visited = route.stops
          .slice(0, index)
          .filter((s) => ['visita_detectada', 'completada'].includes(s.status)).length;
        remainingStops = Math.max(0, index - visited);

        if (!closed && status !== 'en_cliente' && SHARE_POSITION_STATUSES.has(status)) {
          // Fraccion de las entregas previas ya realizadas, proyectada sobre
          // el tramo "en camino" de la barra.
          const ratio = index === 0 ? 0.5 : visited / index;
          progress =
            PROGRESS_DISPATCH_FLOOR +
            (PROGRESS_EN_ROUTE_CEILING - PROGRESS_DISPATCH_FLOOR) * Math.min(1, ratio);
        }
      }
    }
  }

  // --- Vehiculo -------------------------------------------------------------
  let vehicle: TrackingSession['vehicle'] = null;
  let eta: TrackingSession['eta'] = null;
  let trajectory: TrackingSession['trajectory'] = null;

  if (trackingAllowed && workOrder.vehicleId && SHARE_POSITION_STATUSES.has(status)) {
    const [vehicles, position] = await Promise.all([
      operations.getVehicles(),
      gps.getVehiclePosition(workOrder.vehicleId),
    ]);

    const record = vehicles.find((v) => v.id === workOrder.vehicleId) ?? null;
    const connection = evaluateConnectionState(position?.timestamp ?? null, settings.gps, now);

    if (record) {
      vehicle = {
        label: publicVehicleLabel(record.plate, record.fleetCode),
        // Si la senal esta perdida no se publica una posicion vieja como si
        // fuera actual: se informa la ultima actualizacion y nada mas.
        position:
          position && connection.state !== 'offline' ? { lat: position.lat, lng: position.lng } : null,
        heading: position?.heading ?? 0,
        lastUpdateAt: position?.timestamp ?? null,
        moving: (position?.speed ?? 0) > settings.gps.movingSpeedThresholdKmh,
      };
    }

    if (position && isUsableCoordinate(workOrder.coordinates)) {
      const route = workOrder.routeId ? await operations.getRouteById(workOrder.routeId) : null;
      const result = await estimateEta({
        origin: { lat: position.lat, lng: position.lng },
        destination: workOrder.coordinates,
        path: route?.plannedPath,
        currentSpeedKmh: position.speed,
        remainingStops: Math.max(0, remainingStops),
        now,
      });

      eta = {
        minutes: result.minutes,
        arrivalAt: result.arrivalAt,
        distanceKm: result.distanceKm,
        source: result.source,
      };

      // Solo el tramo entre el vehiculo y ESTE domicilio, nunca la ruta
      // completa: el resto de las paradas de la ruta no son asunto de este
      // destinatario. Sin corredor real que recortar, se prefiere no dibujar
      // nada a inventar una linea recta que aparente ser trazado vial.
      if (route && route.plannedPath.length >= 2) {
        const origin: LatLng = { lat: position.lat, lng: position.lng };
        const originProjection = projectOnPolyline(origin, route.plannedPath);
        const destinationProjection = projectOnPolyline(workOrder.coordinates, route.plannedPath);

        if (originProjection && destinationProjection) {
          const slice = sliceCorridor(route.plannedPath, originProjection, destinationProjection);
          if (slice.length >= 2) trajectory = slice;
        }
      }
    }
  }

  // --- Visita al domicilio ---------------------------------------------------
  //
  // A diferencia de la posicion del vehiculo, esto es un hecho puntual sobre
  // ESTE pedido (no revela donde anda el camion ahora), asi que se informa
  // incluso despues de cortar el seguimiento en vivo.
  const arrival: TrackingSession['arrival'] = workOrder.actualArrivalAt
    ? {
        arrivedAt: workOrder.actualArrivalAt,
        departedAt: workOrder.actualDepartureAt,
        dwellMinutes:
          workOrder.dwellSeconds !== null
            ? Math.round(workOrder.dwellSeconds / 60)
            : workOrder.actualDepartureAt === null
              ? Math.max(
                  0,
                  Math.round((now.getTime() - new Date(workOrder.actualArrivalAt).getTime()) / 60_000),
                )
              : null,
      }
    : null;

  /**
   * Etiqueta que ve el cliente.
   *
   * Si la entrega ya fue detectada, se dice "Entregado" aunque el camion siga
   * dentro del perimetro descargando. Mostrar "el vehiculo llego a destino"
   * mientras el seguimiento ya se corto dejaria al cliente sin entender por
   * que desaparecio el mapa.
   */
  const delivered = closed || workOrder.deliveryConfirmation !== 'none';

  return {
    orderNumber: workOrder.orderNumber,
    workOrderNumber: workOrder.number,
    status,
    statusLabel: delivered ? 'Entregado' : PUBLIC_STATUS_LABEL[status],
    destination: {
      addressLine: workOrder.addressLine,
      communeName: workOrder.communeName,
      coordinates: workOrder.coordinates,
    },
    vehicle,
    progress: delivered ? 1 : Math.max(0, Math.min(1, progress)),
    eta: trackingAllowed ? eta : null,
    arrival,
    trajectory: trackingAllowed ? trajectory : null,
    deliveredAt: delivered ? workOrder.actualArrivalAt : null,
    trackingAllowed,
    lastUpdateAt: now.toISOString(),
  };
}
