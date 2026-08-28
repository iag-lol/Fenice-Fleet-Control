import type { OperationalSettings } from '@/config/operational';
import { containsPoint, geofenceCenter } from '@/lib/engines/geofence-engine';
import { haversineMeters } from '@/lib/geo';
import type {
  Alert,
  Geofence,
  LatLng,
  Position,
  VehicleActivityStatus,
  VehicleOperationalStatus,
} from '@/types/core';

/**
 * Estado de actividad del vehiculo.
 *
 * Un unico lugar decide de que color se pinta un camion en el mapa. Ningun
 * componente elige colores por su cuenta: cuando Fenice quiera cambiar el
 * significado de un estado, se cambia aqui y se propaga a todas las vistas.
 */

export interface VehicleActivityInput {
  operationalStatus: VehicleOperationalStatus;
  position: Position | null;
  /** Geocercas activas cercanas, para detectar presencia. */
  geofences: readonly Geofence[];
  /** Distancia actual al corredor planificado, en metros. */
  deviationMeters: number | null;
  /** Alertas abiertas del vehiculo. */
  alerts: readonly Alert[];
  settings: OperationalSettings;
  /** Segundos que lleva detenido, si se conoce. */
  stoppedSeconds?: number | null;
}

export interface VehicleActivityResult {
  status: VehicleActivityStatus;
  insideGeofence: Geofence | null;
  deviationMeters: number | null;
  /** Explica al operador por que el camion tiene ese color. */
  reason: string;
}

/**
 * Resuelve el estado de actividad.
 *
 * Prioridad, de mayor a menor: sin comunicacion, alerta critica, desvio
 * confirmado, entregando, detenido, en movimiento.
 *
 * El orden importa: un camion dentro de la geocerca de un cliente Y con una
 * alerta critica debe verse como problema, no como entrega en curso.
 */
export function resolveVehicleActivity(input: VehicleActivityInput): VehicleActivityResult {
  const { position, settings } = input;

  // 1. Sin comunicacion: no se puede afirmar nada mas.
  if (input.operationalStatus === 'offline' || position === null) {
    return {
      status: 'offline',
      insideGeofence: null,
      deviationMeters: null,
      reason: 'El equipo no esta reportando posicion.',
    };
  }

  const point: LatLng = { lat: position.lat, lng: position.lng };

  const insideGeofence =
    input.geofences.find((geofence) => geofence.active && containsPoint(geofence, point)) ?? null;

  // 2. Alerta critica abierta.
  const critical = input.alerts.find((a) => a.severity === 'critical' && a.state !== 'resuelta');
  if (critical) {
    return {
      status: 'warning',
      insideGeofence,
      deviationMeters: input.deviationMeters,
      reason: critical.title,
    };
  }

  // 3. Fuera del corredor planificado.
  if (
    input.deviationMeters !== null &&
    input.deviationMeters > settings.route.deviationDistanceMeters
  ) {
    return {
      status: 'deviated',
      insideGeofence,
      deviationMeters: input.deviationMeters,
      reason: `A ${Math.round(input.deviationMeters)} m del corredor planificado.`,
    };
  }

  const moving = position.speed > settings.gps.movingSpeedThresholdKmh;

  // 4. Dentro de la geocerca de un cliente y detenido: esta descargando.
  if (
    insideGeofence !== null &&
    !moving &&
    (insideGeofence.kind === 'cliente' ||
      insideGeofence.kind === 'descarga' ||
      insideGeofence.kind === 'carga')
  ) {
    return {
      status: 'delivering',
      insideGeofence,
      deviationMeters: input.deviationMeters,
      reason:
        insideGeofence.kind === 'carga'
          ? `Cargando en ${insideGeofence.name}.`
          : `Descargando en ${insideGeofence.name}.`,
    };
  }

  // 5. Detenido mas alla del umbral, fuera de una zona donde tenga sentido.
  if (!moving) {
    const prolonged =
      input.stoppedSeconds !== null &&
      input.stoppedSeconds !== undefined &&
      input.stoppedSeconds >= settings.route.prolongedStopSeconds;

    return {
      status: 'stopped',
      insideGeofence,
      deviationMeters: input.deviationMeters,
      reason: prolonged
        ? `Detenido hace mas de ${Math.round(settings.route.prolongedStopSeconds / 60)} minutos.`
        : 'Detenido.',
    };
  }

  // 6. Circulando con normalidad.
  return {
    status: 'moving',
    insideGeofence,
    deviationMeters: input.deviationMeters,
    reason: `En movimiento a ${Math.round(position.speed)} km/h.`,
  };
}

export const ACTIVITY_LABEL: Record<VehicleActivityStatus, string> = {
  moving: 'En movimiento',
  delivering: 'Entregando',
  stopped: 'Detenido',
  deviated: 'Fuera de ruta',
  warning: 'Alerta critica',
  offline: 'Sin comunicacion',
};

/**
 * Colores canonicos del estado de actividad.
 *
 * Verde para lo normal, azul para la operacion en curso, ambar para lo que
 * merece atencion, naranjo para el desvio, rojo para lo urgente y gris para
 * lo que no reporta.
 */
export const ACTIVITY_COLOR: Record<VehicleActivityStatus, string> = {
  moving: '#15803d',
  delivering: '#0d90ae',
  stopped: '#b45309',
  deviated: '#c2410c',
  warning: '#dc2626',
  offline: '#64748b',
};

/** Distancia maxima a la que se busca una geocerca, para no recorrerlas todas. */
export const GEOFENCE_SEARCH_RADIUS_METERS = 3_000;

/** Filtra las geocercas cercanas a una posicion. */
export function nearbyGeofences(
  geofences: readonly Geofence[],
  point: LatLng,
  radiusMeters = GEOFENCE_SEARCH_RADIUS_METERS,
): Geofence[] {
  return geofences.filter(
    (geofence) => haversineMeters(geofenceCenter(geofence), point) <= radiusMeters,
  );
}
