import { haversineMeters, pointInPolygon, polygonCentroid } from '@/lib/geo';
import type {
  AlertSeverity,
  AlertType,
  Geofence,
  GeofenceEvent,
  IsoDateTime,
  LatLng,
  Position,
  VehicleId,
} from '@/types/core';

/**
 * GeofenceEngine — evaluacion pura de pertenencia, entradas, salidas y
 * permanencia. Sin estado global, sin dependencias de React ni del mapa.
 *
 * El componente del mapa dibuja; este motor decide.
 */

/** Centro geometrico de cualquier geocerca. */
export function geofenceCenter(geofence: Geofence): LatLng {
  return geofence.geometry.shape === 'circle'
    ? geofence.geometry.center
    : polygonCentroid(geofence.geometry.vertices);
}

/** Determina si un punto esta dentro de la geocerca. */
export function containsPoint(geofence: Geofence, point: LatLng): boolean {
  if (geofence.geometry.shape === 'circle') {
    return haversineMeters(geofence.geometry.center, point) <= geofence.geometry.radiusMeters;
  }
  return pointInPolygon(point, geofence.geometry.vertices);
}

/**
 * Distancia al centro en metros. Para poligonos usa el centroide, que es la
 * referencia que la operacion entiende como "el domicilio".
 */
export function distanceToCenter(geofence: Geofence, point: LatLng): number {
  return haversineMeters(geofenceCenter(geofence), point);
}

/** Estado de la relacion vehiculo-geocerca entre dos muestras consecutivas. */
export type GeofenceTransition = 'enter' | 'exit' | 'inside' | 'outside';

export function detectTransition(
  geofence: Geofence,
  previous: LatLng | null,
  current: LatLng,
): GeofenceTransition {
  const isInside = containsPoint(geofence, current);
  const wasInside = previous ? containsPoint(geofence, previous) : false;

  if (isInside && !wasInside) return 'enter';
  if (!isInside && wasInside) return 'exit';
  return isInside ? 'inside' : 'outside';
}

export function detectEntry(
  geofence: Geofence,
  previous: LatLng | null,
  current: LatLng,
): boolean {
  return detectTransition(geofence, previous, current) === 'enter';
}

export function detectExit(
  geofence: Geofence,
  previous: LatLng | null,
  current: LatLng,
): boolean {
  return detectTransition(geofence, previous, current) === 'exit';
}

/** Permanencia en segundos entre dos marcas de tiempo ISO. */
export function calculateDwellTime(
  enteredAt: IsoDateTime,
  exitedAt: IsoDateTime | null,
  now: Date = new Date(),
): number {
  const start = new Date(enteredAt).getTime();
  if (Number.isNaN(start)) return 0;
  const end = exitedAt ? new Date(exitedAt).getTime() : now.getTime();
  if (Number.isNaN(end)) return 0;
  return Math.max(0, Math.round((end - start) / 1000));
}

// ---------------------------------------------------------------------------
// Evaluacion de visita de entrega
// ---------------------------------------------------------------------------

export interface DeliveryVisitInput {
  geofence: Geofence;
  /** Trayecto GPS ordenado cronologicamente que se desea evaluar. */
  positions: Position[];
  /** Permanencia minima exigida. Si es 0, basta con entrar. */
  minDwellSeconds: number;
  now?: Date;
}

export interface DeliveryVisitResult {
  /** Hubo al menos una entrada al perimetro. */
  entered: boolean;
  /** Se cumplio la permanencia minima -> evidencia valida de visita. */
  confirmed: boolean;
  enteredAt: IsoDateTime | null;
  exitedAt: IsoDateTime | null;
  dwellSeconds: number;
  /** Menor distancia registrada al domicilio en todo el trayecto. */
  closestApproachMeters: number | null;
  entryPosition: LatLng | null;
  /** Cantidad de entradas distintas: mas de una sugiere maniobras o reintentos. */
  passCount: number;
}

/**
 * Evalua si un trayecto constituye una visita valida a la geocerca de entrega.
 *
 * Reglas:
 *  - Se considera la permanencia del tramo continuo mas largo dentro del
 *    perimetro, no la suma de tramos: dos pasadas rapidas no equivalen a una
 *    detencion real.
 *  - Si el vehiculo sigue dentro al final del trayecto, la permanencia se mide
 *    hasta `now`, permitiendo confirmar visitas en curso.
 *  - `closestApproachMeters` se calcula sobre TODO el trayecto, incluso si
 *    nunca entro: es la evidencia de "paso por la direccion del cliente".
 */
export function evaluateDeliveryVisit(input: DeliveryVisitInput): DeliveryVisitResult {
  const { geofence, positions, minDwellSeconds } = input;
  const now = input.now ?? new Date();

  const empty: DeliveryVisitResult = {
    entered: false,
    confirmed: false,
    enteredAt: null,
    exitedAt: null,
    dwellSeconds: 0,
    closestApproachMeters: null,
    entryPosition: null,
    passCount: 0,
  };

  if (positions.length === 0) return empty;

  const center = geofenceCenter(geofence);
  let closest = Number.POSITIVE_INFINITY;
  let passCount = 0;

  let bestDwell = 0;
  let bestEnteredAt: IsoDateTime | null = null;
  let bestExitedAt: IsoDateTime | null = null;
  let bestEntryPosition: LatLng | null = null;

  let currentEnteredAt: IsoDateTime | null = null;
  let currentEntryPosition: LatLng | null = null;
  let wasInside = false;

  const commit = (exitedAt: IsoDateTime | null): void => {
    if (!currentEnteredAt) return;
    const dwell = calculateDwellTime(currentEnteredAt, exitedAt, now);
    if (dwell >= bestDwell) {
      bestDwell = dwell;
      bestEnteredAt = currentEnteredAt;
      bestExitedAt = exitedAt;
      bestEntryPosition = currentEntryPosition;
    }
    currentEnteredAt = null;
    currentEntryPosition = null;
  };

  for (const position of positions) {
    const point: LatLng = { lat: position.lat, lng: position.lng };
    closest = Math.min(closest, haversineMeters(center, point));

    const isInside = containsPoint(geofence, point);

    if (isInside && !wasInside) {
      passCount += 1;
      currentEnteredAt = position.timestamp;
      currentEntryPosition = point;
    } else if (!isInside && wasInside) {
      commit(position.timestamp);
    }
    wasInside = isInside;
  }

  // Si el trayecto termina dentro, la visita sigue abierta.
  if (wasInside) commit(null);

  const entered = passCount > 0;

  return {
    entered,
    confirmed: entered && bestDwell >= minDwellSeconds,
    enteredAt: bestEnteredAt,
    exitedAt: bestExitedAt,
    dwellSeconds: bestDwell,
    closestApproachMeters: Number.isFinite(closest) ? Math.round(closest) : null,
    entryPosition: bestEntryPosition,
    passCount,
  };
}

// ---------------------------------------------------------------------------
// Deteccion incremental sobre un lote de posiciones
// ---------------------------------------------------------------------------

export interface GeofenceScanResult {
  events: Omit<GeofenceEvent, 'id'>[];
}

/**
 * Recorre un trayecto contra varias geocercas y produce los eventos crudos de
 * entrada/salida. Pensado para el simulador y para el futuro procesador de
 * posiciones de Traccar.
 */
export function scanTrackForGeofenceEvents(
  positions: Position[],
  geofences: Geofence[],
): GeofenceScanResult {
  const events: Omit<GeofenceEvent, 'id'>[] = [];
  const insideState = new Map<string, boolean>();

  for (const position of positions) {
    const point: LatLng = { lat: position.lat, lng: position.lng };

    for (const geofence of geofences) {
      if (!geofence.active) continue;

      const wasInside = insideState.get(geofence.id) ?? false;
      const isInside = containsPoint(geofence, point);
      if (wasInside === isInside) continue;

      events.push({
        geofenceId: geofence.id,
        geofenceName: geofence.name,
        vehicleId: position.vehicleId,
        workOrderId: null,
        orderId: null,
        clientId: null,
        type: isInside ? 'enter' : 'exit',
        timestamp: position.timestamp,
        position: point,
        distanceMeters: Math.round(distanceToCenter(geofence, point)),
      });

      insideState.set(geofence.id, isInside);
    }
  }

  return { events };
}

// ---------------------------------------------------------------------------
// Decision de alerta a partir de una transicion real (usado por
// `geofence-detector.ts`, que es quien la persiste)
// ---------------------------------------------------------------------------

/** `allowedFrom`/`allowedTo` en formato "HH:mm". Sin ventana definida, siempre dentro. */
export function isWithinAllowedWindow(from: string | null, to: string | null, at: Date): boolean {
  if (!from || !to) return true;

  const parse = (value: string): number | null => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  };

  const fromMinutes = parse(from);
  const toMinutes = parse(to);
  if (fromMinutes === null || toMinutes === null) return true;

  const nowMinutes = at.getHours() * 60 + at.getMinutes();
  // Ventana que cruza medianoche (ej. 22:00 a 06:00).
  if (fromMinutes <= toMinutes) return nowMinutes >= fromMinutes && nowMinutes <= toMinutes;
  return nowMinutes >= fromMinutes || nowMinutes <= toMinutes;
}

export interface GeofenceAlertDecision {
  alertType: AlertType;
  severity: AlertSeverity;
  title: string;
  reason: 'trigger' | 'vehiculo_no_autorizado' | 'fuera_de_horario';
}

/**
 * Decide si una transicion enter/exit debe generar una alerta, y con que
 * severidad y titulo, segun las reglas de la geocerca. `null` si ninguna
 * regla pide alertar por ella (el evento crudo se registra siempre, esto
 * solo decide la alerta).
 */
export function resolveGeofenceAlertDecision(
  geofence: Geofence,
  type: 'enter' | 'exit',
  vehicleId: VehicleId,
  at: Date,
): GeofenceAlertDecision | null {
  const rules = geofence.rules;
  const authorized = rules.allowedVehicleIds.length === 0 || rules.allowedVehicleIds.includes(vehicleId);
  const withinWindow = isWithinAllowedWindow(rules.allowedFrom, rules.allowedTo, at);

  const unauthorizedEntry = type === 'enter' && !authorized && rules.triggers.includes('vehiculo_no_autorizado');
  const outOfWindow =
    !withinWindow &&
    ((type === 'enter' && rules.triggers.includes('entrada_fuera_horario')) ||
      (type === 'exit' && rules.triggers.includes('salida_fuera_horario')));
  const plainTrigger = type === 'enter' ? rules.triggers.includes('entrada') : rules.triggers.includes('salida');

  if (!unauthorizedEntry && !outOfWindow && !plainTrigger) return null;

  const accion = type === 'enter' ? 'entro a' : 'salio de';
  const title = unauthorizedEntry
    ? `Vehiculo no autorizado entro a "${geofence.name}"`
    : outOfWindow
      ? `${type === 'enter' ? 'Entrada' : 'Salida'} fuera de horario en "${geofence.name}"`
      : `Vehiculo ${accion} "${geofence.name}"`;

  return {
    alertType: type === 'enter' ? 'geocerca_entrada' : 'geocerca_salida',
    severity: unauthorizedEntry ? 'critical' : rules.severity,
    title,
    reason: unauthorizedEntry ? 'vehiculo_no_autorizado' : outOfWindow ? 'fuera_de_horario' : 'trigger',
  };
}
