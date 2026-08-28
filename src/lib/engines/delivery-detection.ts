import type { OperationalSettings } from '@/config/operational';
import { evaluateDeliveryVisit, geofenceCenter } from '@/lib/engines/geofence-engine';
import type {
  DeliveryDetectionEvidence,
  DeliveryDetectionMode,
  Geofence,
  Position,
  WorkOrder,
} from '@/types/core';

/**
 * DeliveryDetectionEngine — convierte telemetria en entregas.
 *
 * Es el motor mas delicado de la plataforma: decide cuando un pedido pasa a
 * estar entregado sin que nadie lo declare. Una deteccion de mas es una
 * entrega que no ocurrio; una de menos es un camion que vuelve a un cliente ya
 * atendido.
 *
 * Responsabilidades, en orden:
 *   1. validar que el camion sea el ASIGNADO a esa OT,
 *   2. validar que la geocerca corresponda a ESE pedido,
 *   3. validar la presencia segun la regla configurada,
 *   4. producir evidencia trazable,
 *   5. garantizar idempotencia.
 */

export type DeliveryRejectionReason =
  | 'sin_vehiculo_asignado'
  | 'vehiculo_incorrecto'
  | 'sin_geocerca'
  | 'geocerca_ajena'
  | 'sin_posiciones'
  | 'nunca_entro'
  | 'permanencia_insuficiente'
  | 'pendiente_confirmacion_conductor'
  | 'ya_entregada'
  | 'orden_cancelada';

export const REJECTION_LABEL: Record<DeliveryRejectionReason, string> = {
  sin_vehiculo_asignado: 'La orden no tiene camion asignado.',
  vehiculo_incorrecto: 'El camion que entro no es el asignado a esta orden.',
  sin_geocerca: 'La direccion de despacho no tiene geocerca definida.',
  geocerca_ajena: 'La geocerca no corresponde a esta orden de trabajo.',
  sin_posiciones: 'No hay telemetria en la ventana evaluada.',
  nunca_entro: 'El vehiculo no ingreso al perimetro de entrega.',
  permanencia_insuficiente: 'El vehiculo paso por el domicilio sin permanecer lo suficiente.',
  pendiente_confirmacion_conductor: 'Presencia confirmada por GPS, falta la confirmacion del conductor.',
  ya_entregada: 'La entrega ya fue registrada.',
  orden_cancelada: 'La orden esta cancelada.',
};

export interface DeliveryDetectionInput {
  workOrder: WorkOrder;
  geofence: Geofence | null;
  /** Posiciones del vehiculo, ordenadas cronologicamente. */
  positions: Position[];
  settings: OperationalSettings;
  mode: DeliveryDetectionMode;
  /** El conductor ya confirmo la entrega desde su portal. */
  driverConfirmed?: boolean;
  /** Detecciones ya registradas, para no duplicar. */
  alreadyDetectedWorkOrderIds?: ReadonlySet<string>;
  now?: Date;
}

export interface DeliveryDetectionResult {
  /** La entrega queda registrada. */
  detected: boolean;
  /** Hubo presencia en el domicilio, se confirme o no la entrega. */
  presenceConfirmed: boolean;
  evidence: DeliveryDetectionEvidence | null;
  rejection: DeliveryRejectionReason | null;
  /** Explicacion lista para mostrar al operador. */
  reason: string;
}

function reject(reason: DeliveryRejectionReason, presence = false): DeliveryDetectionResult {
  return {
    detected: false,
    presenceConfirmed: presence,
    evidence: null,
    rejection: reason,
    reason: REJECTION_LABEL[reason],
  };
}

/**
 * Evalua si corresponde registrar la entrega de una orden.
 *
 * Cada validacion existe por un motivo concreto, anotado junto a ella. Ninguna
 * es defensiva "por si acaso".
 */
export function evaluateDelivery(input: DeliveryDetectionInput): DeliveryDetectionResult {
  const { workOrder, geofence, positions, settings, mode } = input;
  const now = input.now ?? new Date();

  // --- Idempotencia: una entrada repetida no produce dos entregas ----------
  if (input.alreadyDetectedWorkOrderIds?.has(workOrder.id)) {
    return reject('ya_entregada', true);
  }
  if (workOrder.status === 'cancelada') return reject('orden_cancelada');
  if (workOrder.deliveryConfirmation !== 'none') return reject('ya_entregada', true);

  // --- El camion debe ser el asignado -------------------------------------
  //
  // Sin esta validacion, cualquier camion que pasara cerca del domicilio
  // cerraria el pedido de otro. En una distribuidora con varias rutas por
  // comuna, eso ocurriria a diario.
  if (!workOrder.vehicleId) return reject('sin_vehiculo_asignado');

  const foreignVehicle = positions.some((p) => p.vehicleId !== workOrder.vehicleId);
  if (foreignVehicle) return reject('vehiculo_incorrecto');

  // --- La geocerca debe ser la de ESTA orden -------------------------------
  if (!geofence) return reject('sin_geocerca');
  if (workOrder.geofenceId !== null && workOrder.geofenceId !== geofence.id) {
    return reject('geocerca_ajena');
  }

  if (positions.length === 0) return reject('sin_posiciones');

  // --- Permanencia exigida segun la regla ---------------------------------
  //
  // En modo `enter` basta con cruzar el perimetro; en el resto se exige la
  // permanencia minima de la geocerca, o la global si no declara una propia.
  const requiredDwellSeconds =
    mode === 'enter'
      ? 0
      : (geofence.rules.minDwellSeconds ??
        geofence.minDwellSeconds ??
        settings.geofence.minDwellSeconds);

  const visit = evaluateDeliveryVisit({
    geofence,
    positions,
    minDwellSeconds: requiredDwellSeconds,
    now,
  });

  if (!visit.entered || visit.enteredAt === null || visit.entryPosition === null) {
    return reject('nunca_entro');
  }
  if (!visit.confirmed) return reject('permanencia_insuficiente', true);

  // --- Confirmacion del conductor cuando la regla la exige ----------------
  if ((mode === 'driver' || mode === 'hybrid') && input.driverConfirmed !== true) {
    return reject('pendiente_confirmacion_conductor', true);
  }

  const source: DeliveryDetectionEvidence['source'] =
    mode === 'driver' ? 'driver' : mode === 'hybrid' ? 'gps' : 'gps';

  const evidence: DeliveryDetectionEvidence = {
    workOrderId: workOrder.id,
    orderId: workOrder.orderId,
    clientId: workOrder.clientId,
    vehicleId: workOrder.vehicleId,
    deviceId: positions[positions.length - 1]!.deviceId,
    geofenceId: geofence.id,
    mode,
    enteredAt: visit.enteredAt,
    exitedAt: visit.exitedAt,
    dwellSeconds: visit.dwellSeconds,
    closestApproachMeters: visit.closestApproachMeters ?? 0,
    position: visit.entryPosition,
    requiredDwellSeconds,
    radiusMeters:
      geofence.geometry.shape === 'circle'
        ? geofence.geometry.radiusMeters
        : Math.round(
            Math.max(
              ...geofence.geometry.vertices.map((v) =>
                haversineApprox(geofenceCenter(geofence), v),
              ),
            ),
          ),
    detectedAt: now.toISOString(),
    source,
  };

  return {
    detected: true,
    presenceConfirmed: true,
    evidence,
    rejection: null,
    reason:
      mode === 'hybrid'
        ? 'Presencia GPS confirmada y validada por el conductor.'
        : mode === 'driver'
          ? 'Entrega confirmada por el conductor.'
          : `Permanencia de ${Math.round(visit.dwellSeconds / 60)} min a ${visit.closestApproachMeters ?? 0} m del domicilio.`,
  };
}

/** Distancia aproximada en metros, suficiente para dimensionar un poligono. */
function haversineApprox(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = (b.lat - a.lat) * 111_320;
  const dLng = (b.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

/**
 * Determina si el seguimiento publico debe seguir compartiendo la posicion.
 *
 * Regla obligatoria de privacidad: en cuanto la entrega queda registrada, el
 * cliente deja de ver donde esta el camion. No es solo dejar de pintarlo en el
 * mapa; el backend tampoco debe devolver la coordenada, ni recargando la
 * pagina, porque a partir de ese momento la posicion del vehiculo ya no es
 * asunto del destinatario.
 */
export function isTrackingAllowed(workOrder: WorkOrder): boolean {
  const closed = ['visita_detectada', 'completada', 'cancelada'].includes(workOrder.status);
  if (closed) return false;
  return workOrder.deliveryConfirmation === 'none';
}
