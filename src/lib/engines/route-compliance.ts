import type { OperationalSettings } from '@/config/operational';
import { isUsableCoordinate, polylineLengthMeters, projectOnPolyline } from '@/lib/geo';
import type {
  Commune,
  LatLng,
  Position,
  Route,
  RouteStop,
  WorkOrderStatus,
} from '@/types/core';
import { pointInPolygon } from '@/lib/geo';

/**
 * RouteComplianceEngine — evalua el comportamiento de un vehiculo frente a su
 * ruta planificada: desvio, avance, proxima parada, detenciones y comuna.
 *
 * Todo es funcion pura sobre datos ya normalizados. El motor no consulta el
 * proveedor GPS ni conoce el mapa.
 */

export interface RouteDeviationInput {
  /** Posiciones ordenadas cronologicamente, la ultima es la actual. */
  positions: Position[];
  plannedPath: LatLng[];
  settings: OperationalSettings['route'];
}

export interface RouteDeviationResult {
  /** Distancia actual al corredor planificado, en metros. */
  distanceMeters: number | null;
  /** Esta fuera del corredor en este instante. */
  outsideCorridor: boolean;
  /** Segundos continuos fuera del corridor hasta la ultima muestra. */
  continuousSecondsOutside: number;
  /** Se cumplen distancia Y tiempo -> corresponde emitir alerta. */
  deviationConfirmed: boolean;
  /** Instante en que salio del corredor por ultima vez. */
  deviationStartedAt: string | null;
  /** Maxima separacion alcanzada durante el desvio actual. */
  maxDeviationMeters: number;
}

/**
 * Evalua desvio de ruta.
 *
 * Una sola muestra fuera del corredor NO es un desvio: los equipos GPS tienen
 * dispersion y una maniobra puntual puede alejarse. Se exige permanencia
 * continua durante `deviationTimeSeconds`.
 */
export function evaluateRouteDeviation(input: RouteDeviationInput): RouteDeviationResult {
  const { positions, plannedPath, settings } = input;

  const idle: RouteDeviationResult = {
    distanceMeters: null,
    outsideCorridor: false,
    continuousSecondsOutside: 0,
    deviationConfirmed: false,
    deviationStartedAt: null,
    maxDeviationMeters: 0,
  };

  if (positions.length === 0 || plannedPath.length < 2) return idle;

  const last = positions[positions.length - 1]!;
  const currentProjection = projectOnPolyline({ lat: last.lat, lng: last.lng }, plannedPath);
  if (!currentProjection) return idle;

  const currentDistance = currentProjection.distanceMeters;
  const outsideNow = currentDistance > settings.deviationDistanceMeters;

  if (!outsideNow) {
    return { ...idle, distanceMeters: Math.round(currentDistance) };
  }

  // Retroceder mientras las muestras sigan fuera del corredor.
  let deviationStartedAt = last.timestamp;
  let maxDeviation = currentDistance;

  for (let i = positions.length - 2; i >= 0; i -= 1) {
    const sample = positions[i]!;
    const projection = projectOnPolyline({ lat: sample.lat, lng: sample.lng }, plannedPath);
    if (!projection || projection.distanceMeters <= settings.deviationDistanceMeters) break;

    maxDeviation = Math.max(maxDeviation, projection.distanceMeters);
    deviationStartedAt = sample.timestamp;
  }

  const startMs = new Date(deviationStartedAt).getTime();
  const endMs = new Date(last.timestamp).getTime();
  const continuousSecondsOutside =
    Number.isNaN(startMs) || Number.isNaN(endMs) ? 0 : Math.max(0, Math.round((endMs - startMs) / 1000));

  return {
    distanceMeters: Math.round(currentDistance),
    outsideCorridor: true,
    continuousSecondsOutside,
    deviationConfirmed: continuousSecondsOutside >= settings.deviationTimeSeconds,
    deviationStartedAt,
    maxDeviationMeters: Math.round(maxDeviation),
  };
}

// ---------------------------------------------------------------------------
// Avance de ruta
// ---------------------------------------------------------------------------

const VISITED_STATUSES: ReadonlySet<WorkOrderStatus> = new Set<WorkOrderStatus>([
  'visita_detectada',
  'completada',
]);

const IN_PROGRESS_STATUSES: ReadonlySet<WorkOrderStatus> = new Set<WorkOrderStatus>([
  'en_cliente',
  'proxima',
]);

/**
 * Paradas que ya no requieren accion del conductor.
 *
 * Incluye `incidencia` y `cancelada`: quedaron resueltas, aunque sin exito.
 * Ofrecerlas como "proxima parada" enviaria al conductor de vuelta a una
 * direccion que ya se atendio.
 */
const CLOSED_STATUSES: ReadonlySet<WorkOrderStatus> = new Set<WorkOrderStatus>([
  'visita_detectada',
  'completada',
  'incidencia',
  'cancelada',
]);

export interface RouteProgressResult {
  totalStops: number;
  completedStops: number;
  /** Paradas cerradas con incidencia: cuentan como resueltas, no como exito. */
  incidentStops: number;
  /** Parada que el vehiculo esta atendiendo o hacia la que se dirige. */
  nextStop: RouteStop | null;
  /** 0-1. Progreso por paradas cerradas. */
  completionRatio: number;
  /** 0-1. Avance geometrico sobre el corredor planificado. */
  pathRatio: number | null;
  /** Distancia recorrida sobre el corredor, en km. */
  distanceAlongKm: number | null;
  complete: boolean;
}

/** Calcula el avance de una ruta combinando estado de paradas y geometria. */
export function evaluateRouteProgress(
  route: Route,
  currentPosition: LatLng | null,
): RouteProgressResult {
  const totalStops = route.stops.length;
  const completedStops = route.stops.filter((s) => VISITED_STATUSES.has(s.status)).length;
  const incidentStops = route.stops.filter((s) => s.status === 'incidencia').length;

  const nextStop =
    route.stops.find((s) => IN_PROGRESS_STATUSES.has(s.status)) ??
    route.stops.find((s) => !CLOSED_STATUSES.has(s.status)) ??
    null;

  let pathRatio: number | null = null;
  let distanceAlongKm: number | null = null;

  if (currentPosition && isUsableCoordinate(currentPosition) && route.plannedPath.length >= 2) {
    const projection = projectOnPolyline(currentPosition, route.plannedPath);
    const totalLength = polylineLengthMeters(route.plannedPath);
    if (projection && totalLength > 0) {
      pathRatio = Math.max(0, Math.min(1, projection.alongMeters / totalLength));
      distanceAlongKm = Math.round((projection.alongMeters / 1000) * 10) / 10;
    }
  }

  const closedStops = route.stops.filter((s) => CLOSED_STATUSES.has(s.status)).length;

  return {
    totalStops,
    completedStops,
    incidentStops,
    nextStop,
    completionRatio: totalStops === 0 ? 0 : completedStops / totalStops,
    pathRatio,
    distanceAlongKm,
    complete: totalStops > 0 && closedStops === totalStops,
  };
}

// ---------------------------------------------------------------------------
// Detenciones
// ---------------------------------------------------------------------------

export interface StopDetectionInput {
  positions: Position[];
  movingSpeedThresholdKmh: number;
  prolongedStopSeconds: number;
}

export interface DetectedStop {
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  position: LatLng;
  prolonged: boolean;
}

/** Agrupa muestras consecutivas por debajo del umbral de movimiento. */
export function detectStops(input: StopDetectionInput): DetectedStop[] {
  const { positions, movingSpeedThresholdKmh, prolongedStopSeconds } = input;
  const stops: DetectedStop[] = [];

  let startIndex: number | null = null;

  const close = (endIndex: number, endedAt: string | null): void => {
    if (startIndex === null) return;
    const first = positions[startIndex]!;
    const last = positions[endIndex]!;
    const startMs = new Date(first.timestamp).getTime();
    const endMs = new Date(endedAt ?? last.timestamp).getTime();
    const durationSeconds =
      Number.isNaN(startMs) || Number.isNaN(endMs) ? 0 : Math.max(0, Math.round((endMs - startMs) / 1000));

    stops.push({
      startedAt: first.timestamp,
      endedAt,
      durationSeconds,
      position: { lat: first.lat, lng: first.lng },
      prolonged: durationSeconds >= prolongedStopSeconds,
    });
    startIndex = null;
  };

  for (let i = 0; i < positions.length; i += 1) {
    const p = positions[i]!;
    const stopped = p.speed <= movingSpeedThresholdKmh;

    if (stopped && startIndex === null) {
      startIndex = i;
    } else if (!stopped && startIndex !== null) {
      close(i - 1, p.timestamp);
    }
  }

  if (startIndex !== null) close(positions.length - 1, null);

  return stops;
}

// ---------------------------------------------------------------------------
// Control por comuna
// ---------------------------------------------------------------------------

export interface CommuneComplianceInput {
  positions: Position[];
  communes: Commune[];
  authorizedCommuneCodes: string[];
  toleranceSeconds: number;
}

export interface CommuneComplianceResult {
  currentCommune: Commune | null;
  authorized: boolean;
  /** Segundos continuos fuera de las comunas autorizadas. */
  continuousSecondsOutside: number;
  /** Se supero la tolerancia -> corresponde emitir alerta. */
  violationConfirmed: boolean;
}

/**
 * Resuelve la comuna que contiene una coordenada.
 *
 * Recorre la lista recibida por punto-en-poligono. La aplicacion usa la
 * version indexada y cacheada de `administrative-boundaries`; esta se
 * mantiene porque el motor debe poder evaluarse contra cualquier conjunto de
 * comunas, incluido uno de prueba.
 */
export function resolveCommune(point: LatLng, communes: Commune[]): Commune | null {
  for (const commune of communes) {
    if (pointInPolygon(point, commune.boundary)) return commune;
  }
  return null;
}

/**
 * Evalua si el vehiculo circula fuera de las comunas que su ruta autoriza.
 *
 * Se aplica tolerancia temporal porque los limites comunales son atravesados
 * legitimamente al transitar por vias que los bordean.
 */
export function evaluateCommuneCompliance(
  input: CommuneComplianceInput,
): CommuneComplianceResult {
  const { positions, communes, authorizedCommuneCodes, toleranceSeconds } = input;

  const idle: CommuneComplianceResult = {
    currentCommune: null,
    authorized: true,
    continuousSecondsOutside: 0,
    violationConfirmed: false,
  };

  if (positions.length === 0) return idle;
  // Sin restriccion declarada no hay nada que hacer cumplir.
  if (authorizedCommuneCodes.length === 0) {
    const last = positions[positions.length - 1]!;
    return { ...idle, currentCommune: resolveCommune({ lat: last.lat, lng: last.lng }, communes) };
  }

  const authorized = new Set(authorizedCommuneCodes);
  const last = positions[positions.length - 1]!;
  const currentCommune = resolveCommune({ lat: last.lat, lng: last.lng }, communes);

  // Fuera de toda comuna conocida no es una violacion: es falta de cobertura
  // cartografica, y alertar por eso genera ruido.
  if (!currentCommune) return { ...idle, currentCommune: null };

  if (authorized.has(currentCommune.code)) {
    return { ...idle, currentCommune, authorized: true };
  }

  let outsideSince = last.timestamp;
  for (let i = positions.length - 2; i >= 0; i -= 1) {
    const sample = positions[i]!;
    const commune = resolveCommune({ lat: sample.lat, lng: sample.lng }, communes);
    if (!commune || authorized.has(commune.code)) break;
    outsideSince = sample.timestamp;
  }

  const startMs = new Date(outsideSince).getTime();
  const endMs = new Date(last.timestamp).getTime();
  const continuousSecondsOutside =
    Number.isNaN(startMs) || Number.isNaN(endMs) ? 0 : Math.max(0, Math.round((endMs - startMs) / 1000));

  return {
    currentCommune,
    authorized: false,
    continuousSecondsOutside,
    violationConfirmed: continuousSecondsOutside >= toleranceSeconds,
  };
}
