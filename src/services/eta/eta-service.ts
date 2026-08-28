import 'server-only';

import { getServerEnv } from '@/config/env';
import { haversineMeters, projectOnPolyline } from '@/lib/geo';
import type { LatLng } from '@/types/core';

/**
 * EtaService — estimacion de tiempo de llegada.
 *
 * Desacoplado del proveedor: hoy calcula internamente, manana consulta OSRM,
 * Mapbox, Google o MapTiler sin que cambie ningun consumidor. Toda la UI que
 * muestra un ETA (seguimiento publico, popup de camion, detalle de OT) pasa
 * por aqui.
 */

export interface EtaRequest {
  origin: LatLng;
  destination: LatLng;
  /** Corredor planificado, si existe: mejora notablemente la estimacion. */
  path?: LatLng[];
  /** Velocidad instantanea del vehiculo en km/h. */
  currentSpeedKmh?: number;
  /** Paradas pendientes antes del destino: cada una suma tiempo de servicio. */
  remainingStops?: number;
  now?: Date;
}

export interface EtaResult {
  minutes: number | null;
  arrivalAt: string | null;
  distanceKm: number | null;
  source: 'routing_provider' | 'estimated';
  /** Explica al operador de donde sale la cifra. */
  basis: string;
}

export interface RoutingProvider {
  readonly id: string;
  estimate(request: EtaRequest): Promise<EtaResult | null>;
}

/** Minutos de servicio asumidos por cada parada intermedia pendiente. */
const SERVICE_MINUTES_PER_STOP = 9;

/**
 * Velocidad efectiva urbana. No es la velocidad instantanea: incorpora
 * semaforos, congestion y maniobras. Un camion que marca 60 km/h en una
 * avenida no promedia 60 km/h hasta el cliente.
 */
function effectiveSpeedKmh(distanceKm: number, currentSpeedKmh: number | undefined): number {
  // A mayor distancia, mas probable es incorporar vias rapidas.
  const base = distanceKm > 15 ? 42 : distanceKm > 6 ? 32 : 24;

  if (currentSpeedKmh === undefined) return base;
  // Un vehiculo detenido no implica ETA infinito: pondera poco.
  const blended = base * 0.75 + Math.min(currentSpeedKmh, 80) * 0.25;
  return Math.max(12, blended);
}

/**
 * Estimador interno. Usa el corredor planificado cuando esta disponible
 * (distancia real por calle) y cae a distancia geodesica corregida cuando no.
 */
export class EstimatedRoutingProvider implements RoutingProvider {
  readonly id = 'estimated';

  async estimate(request: EtaRequest): Promise<EtaResult> {
    const now = request.now ?? new Date();

    let distanceMeters: number;
    let basis: string;

    // Factor de sinuosidad urbana: la calle siempre es mas larga que la recta.
    const directMeters = haversineMeters(request.origin, request.destination) * 1.35;

    const projected = (():

      | { meters: number; basis: string }
      | null => {
      if (!request.path || request.path.length < 2) return null;

      const originProjection = projectOnPolyline(request.origin, request.path);
      const destinationProjection = projectOnPolyline(request.destination, request.path);
      if (!originProjection || !destinationProjection) return null;

      const along = destinationProjection.alongMeters - originProjection.alongMeters;

      // Un avance nulo o negativo significa que el vehiculo ya paso el punto de
      // proyeccion del destino: seguir el corredor mediria la distancia hasta
      // el FINAL de la ruta, no hasta la entrega. Se usa la distancia directa.
      if (along <= 0) return null;

      return { meters: along, basis: 'Distancia sobre el corredor planificado' };
    })();

    // La proyeccion sobre el corredor solo se acepta si es coherente con la
    // distancia real al destino; de lo contrario un corredor con desvios
    // largos inflaria el ETA de una entrega que esta a la vuelta de la esquina.
    if (projected && projected.meters <= Math.max(directMeters * 2.5, directMeters + 1_500)) {
      distanceMeters = projected.meters;
      basis = projected.basis;
    } else {
      distanceMeters = directMeters;
      basis = 'Distancia directa corregida por trazado urbano';
    }

    if (!Number.isFinite(distanceMeters) || distanceMeters < 0) {
      return { minutes: null, arrivalAt: null, distanceKm: null, source: 'estimated', basis: 'Sin datos suficientes' };
    }

    const distanceKm = distanceMeters / 1000;
    const speed = effectiveSpeedKmh(distanceKm, request.currentSpeedKmh);
    const travelMinutes = (distanceKm / speed) * 60;
    const serviceMinutes = (request.remainingStops ?? 0) * SERVICE_MINUTES_PER_STOP;
    const minutes = Math.max(1, Math.round(travelMinutes + serviceMinutes));

    return {
      minutes,
      arrivalAt: new Date(now.getTime() + minutes * 60_000).toISOString(),
      distanceKm: Math.round(distanceKm * 10) / 10,
      source: 'estimated',
      basis:
        serviceMinutes > 0
          ? `${basis}, mas ${request.remainingStops} entrega(s) intermedia(s)`
          : basis,
    };
  }
}

/**
 * Proveedor OSRM. Servicio abierto y autohospedable; la opcion natural cuando
 * Fenice quiera ETA real sin costo por consulta.
 */
export class OsrmRoutingProvider implements RoutingProvider {
  readonly id = 'osrm';

  constructor(private readonly baseUrl: string) {}

  async estimate(request: EtaRequest): Promise<EtaResult | null> {
    const now = request.now ?? new Date();
    const coordinates = `${request.origin.lng},${request.origin.lat};${request.destination.lng},${request.destination.lat}`;
    const url = `${this.baseUrl.replace(/\/+$/, '')}/route/v1/driving/${coordinates}?overview=false`;

    try {
      const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(6_000) });
      if (!response.ok) return null;

      const payload = (await response.json()) as {
        routes?: { duration: number; distance: number }[];
      };
      const route = payload.routes?.[0];
      if (!route) return null;

      const serviceMinutes = (request.remainingStops ?? 0) * SERVICE_MINUTES_PER_STOP;
      const minutes = Math.max(1, Math.round(route.duration / 60 + serviceMinutes));

      return {
        minutes,
        arrivalAt: new Date(now.getTime() + minutes * 60_000).toISOString(),
        distanceKm: Math.round((route.distance / 1000) * 10) / 10,
        source: 'routing_provider',
        basis: 'Ruteo calculado por OSRM',
      };
    } catch {
      // Un proveedor de routing caido no puede dejar sin ETA al cliente final.
      return null;
    }
  }
}

let cachedProvider: RoutingProvider | null = null;

function createRoutingProvider(): RoutingProvider {
  const env = getServerEnv();

  if (env.ROUTING_PROVIDER === 'osrm' && env.OSRM_BASE_URL) {
    return new OsrmRoutingProvider(env.OSRM_BASE_URL);
  }

  // Mapbox / Google / MapTiler: mismo patron que OSRM, se agregan como clases
  // adicionales cuando Fenice defina proveedor y contrate su API key.
  return new EstimatedRoutingProvider();
}

export function getRoutingProvider(): RoutingProvider {
  if (!cachedProvider) cachedProvider = createRoutingProvider();
  return cachedProvider;
}

/**
 * Punto de entrada unico para calcular un ETA. Degrada al estimador interno si
 * el proveedor externo falla: la operacion nunca se queda sin cifra.
 */
export async function estimateEta(request: EtaRequest): Promise<EtaResult> {
  const provider = getRoutingProvider();
  const result = await provider.estimate(request);
  if (result) return result;
  return new EstimatedRoutingProvider().estimate(request);
}
