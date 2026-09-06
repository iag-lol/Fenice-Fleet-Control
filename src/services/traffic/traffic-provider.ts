import 'server-only';

import { getServerEnv } from '@/config/env';
import type { LatLng } from '@/types/core';

/**
 * TrafficProvider — congestion vial en tiempo real.
 *
 * REGLA INNEGOCIABLE: nunca se genera trafico ficticio. Presentar congestion
 * inventada como real llevaria a decisiones de despacho equivocadas: se
 * reasignarian camiones, se avisaria a clientes de retrasos inexistentes y se
 * perderia la confianza en el resto de la plataforma.
 *
 * Sin proveedor configurado, la funcion se declara `requires-provider` y la
 * interfaz lo dice explicitamente.
 */

export type CongestionLevel = 'fluido' | 'moderado' | 'congestionado' | 'muy_congestionado';

export const CONGESTION_LABEL: Record<CongestionLevel, string> = {
  fluido: 'Fluido',
  moderado: 'Moderado',
  congestionado: 'Congestionado',
  muy_congestionado: 'Muy congestionado',
};

export const CONGESTION_COLOR: Record<CongestionLevel, string> = {
  fluido: '#15803d',
  moderado: '#b45309',
  congestionado: '#c2410c',
  muy_congestionado: '#b91c1c',
};

export interface TrafficSegment {
  id: string;
  level: CongestionLevel;
  path: LatLng[];
  /** Velocidad actual del tramo, en km/h. */
  currentSpeedKmh: number | null;
  /** Velocidad habitual del tramo, en km/h. */
  freeFlowSpeedKmh: number | null;
  /** Demora acumulada respecto a la circulacion normal, en segundos. */
  delaySeconds: number | null;
}

export interface RouteTrafficImpact {
  /** Tiempo de viaje sin considerar congestion, en minutos. */
  baselineMinutes: number;
  /** Tiempo de viaje con la congestion actual, en minutos. */
  withTrafficMinutes: number;
  /** Diferencia entre ambos, en minutos. */
  delayMinutes: number;
  /** Tramos congestionados que atraviesa la ruta. */
  segments: TrafficSegment[];
}

export interface TrafficProviderInfo {
  id: 'none' | 'mapbox' | 'tomtom' | 'google';
  label: string;
  /** `true` cuando hay credenciales y el proveedor puede responder. */
  available: boolean;
  /** Motivo por el que no esta disponible, listo para mostrar. */
  unavailableReason: string | null;
}

export interface TrafficProvider {
  readonly info: TrafficProviderInfo;

  /** Congestion dentro de una caja geografica. */
  getSegments(bounds: {
    minLat: number;
    minLng: number;
    maxLat: number;
    maxLng: number;
  }): Promise<TrafficSegment[]>;

  /** Impacto de la congestion sobre un corredor concreto. */
  getRouteImpact(path: LatLng[]): Promise<RouteTrafficImpact | null>;

  /** Diagnostico: una consulta real de prueba, para saber si la clave sirve. */
  healthCheck(): Promise<{ ok: boolean; message: string; latencyMs: number | null }>;
}

const UNAVAILABLE_MESSAGE =
  'El trafico en tiempo real requiere un proveedor configurado. Define TRAFFIC_PROVIDER y TRAFFIC_API_KEY.';

/**
 * Proveedor inactivo.
 *
 * Devuelve vacio en lugar de datos simulados. La diferencia no es cosmetica:
 * un array vacio significa "no lo se", y la interfaz puede decirlo; un array
 * inventado significa "esto es asi", y seria mentira.
 */
class UnavailableTrafficProvider implements TrafficProvider {
  readonly info: TrafficProviderInfo = {
    id: 'none',
    label: 'Sin proveedor',
    available: false,
    unavailableReason: UNAVAILABLE_MESSAGE,
  };

  async getSegments(): Promise<TrafficSegment[]> {
    return [];
  }

  async getRouteImpact(): Promise<null> {
    return null;
  }

  async healthCheck(): Promise<{ ok: boolean; message: string; latencyMs: number | null }> {
    return { ok: false, message: UNAVAILABLE_MESSAGE, latencyMs: null };
  }
}

/**
 * Proveedor TomTom.
 *
 * ESTADO: implementado, sin ejecutar contra el servicio real porque todavia no
 * existe una clave contratada. Se activa con TRAFFIC_PROVIDER=tomtom.
 *
 * La clave vive solo en el servidor: el navegador consume /api/trafico.
 */
class TomTomTrafficProvider implements TrafficProvider {
  readonly info: TrafficProviderInfo = {
    id: 'tomtom',
    label: 'TomTom Traffic',
    available: true,
    unavailableReason: null,
  };

  constructor(private readonly apiKey: string) {}

  /** Traduce la relacion velocidad actual / velocidad libre a un nivel. */
  private classify(currentSpeed: number, freeFlowSpeed: number): CongestionLevel {
    if (freeFlowSpeed <= 0) return 'fluido';
    const ratio = currentSpeed / freeFlowSpeed;
    if (ratio >= 0.8) return 'fluido';
    if (ratio >= 0.6) return 'moderado';
    if (ratio >= 0.35) return 'congestionado';
    return 'muy_congestionado';
  }

  async getSegments(bounds: {
    minLat: number;
    minLng: number;
    maxLat: number;
    maxLng: number;
  }): Promise<TrafficSegment[]> {
    // TomTom entrega el estado de un tramo a partir de un punto; se muestrea
    // el area para no pedir la red completa, que seria inviable.
    const samples = sampleGrid(bounds, 4);
    const segments: TrafficSegment[] = [];

    for (const [index, point] of samples.entries()) {
      const url = new URL(
        'https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json',
      );
      url.searchParams.set('key', this.apiKey);
      url.searchParams.set('point', `${point.lat},${point.lng}`);

      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
        if (!response.ok) continue;

        const payload = (await response.json()) as {
          flowSegmentData?: {
            currentSpeed: number;
            freeFlowSpeed: number;
            currentTravelTime: number;
            freeFlowTravelTime: number;
            coordinates: { coordinate: { latitude: number; longitude: number }[] };
          };
        };

        const flow = payload.flowSegmentData;
        if (!flow) continue;

        segments.push({
          id: `tomtom-${index}`,
          level: this.classify(flow.currentSpeed, flow.freeFlowSpeed),
          path: flow.coordinates.coordinate.map((c) => ({
            lat: c.latitude,
            lng: c.longitude,
          })),
          currentSpeedKmh: flow.currentSpeed,
          freeFlowSpeedKmh: flow.freeFlowSpeed,
          delaySeconds: Math.max(0, flow.currentTravelTime - flow.freeFlowTravelTime),
        });
      } catch (error) {
        // Un tramo que falla no invalida el resto del muestreo, pero se
        // registra: sin esto, una clave invalida o vencida fallaba en las
        // 16 muestras sin dejar rastro, y el mapa se veia "conectado" pero
        // sin una sola linea de trafico, sin ninguna pista de por que.
        console.error('[trafico] TomTom fallo para un punto de muestreo:', error);
        continue;
      }
    }

    return segments;
  }

  async healthCheck(): Promise<{ ok: boolean; message: string; latencyMs: number | null }> {
    const url = new URL('https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json');
    url.searchParams.set('key', this.apiKey);
    // Centro de Santiago: sirve solo para confirmar que la clave responde,
    // no para traer trafico real de una zona en particular.
    url.searchParams.set('point', '-33.4489,-70.6693');

    const started = performance.now();
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      const latencyMs = Math.round(performance.now() - started);

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        return {
          ok: false,
          message: `TomTom respondio ${response.status}: ${body.slice(0, 200) || response.statusText}`,
          latencyMs,
        };
      }

      const payload = (await response.json()) as { flowSegmentData?: unknown };
      if (!payload.flowSegmentData) {
        return { ok: false, message: 'TomTom respondio 200 pero sin datos de trafico reconocibles.', latencyMs };
      }

      return { ok: true, message: 'Conexion correcta con TomTom Traffic.', latencyMs };
    } catch (error) {
      return {
        ok: false,
        message: `No fue posible conectar con TomTom: ${error instanceof Error ? error.message : String(error)}`,
        latencyMs: Math.round(performance.now() - started),
      };
    }
  }

  async getRouteImpact(path: LatLng[]): Promise<RouteTrafficImpact | null> {
    if (path.length < 2) return null;

    const bounds = boundsOfPath(path);
    const segments = await this.getSegments(bounds);
    if (segments.length === 0) return null;

    const congested = segments.filter(
      (s) => s.level === 'congestionado' || s.level === 'muy_congestionado',
    );

    const delaySeconds = congested.reduce((sum, s) => sum + (s.delaySeconds ?? 0), 0);
    const baselineMinutes = estimateBaselineMinutes(path);

    return {
      baselineMinutes,
      withTrafficMinutes: Math.round(baselineMinutes + delaySeconds / 60),
      delayMinutes: Math.round(delaySeconds / 60),
      segments: congested,
    };
  }
}

/** Puntos de muestreo repartidos por el area, evitando los bordes. */
function sampleGrid(
  bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number },
  steps: number,
): LatLng[] {
  const points: LatLng[] = [];
  for (let i = 1; i <= steps; i += 1) {
    for (let j = 1; j <= steps; j += 1) {
      points.push({
        lat: bounds.minLat + ((bounds.maxLat - bounds.minLat) * i) / (steps + 1),
        lng: bounds.minLng + ((bounds.maxLng - bounds.minLng) * j) / (steps + 1),
      });
    }
  }
  return points;
}

function boundsOfPath(path: LatLng[]): {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
} {
  return path.reduce(
    (box, point) => ({
      minLat: Math.min(box.minLat, point.lat),
      maxLat: Math.max(box.maxLat, point.lat),
      minLng: Math.min(box.minLng, point.lng),
      maxLng: Math.max(box.maxLng, point.lng),
    }),
    {
      minLat: Number.POSITIVE_INFINITY,
      maxLat: Number.NEGATIVE_INFINITY,
      minLng: Number.POSITIVE_INFINITY,
      maxLng: Number.NEGATIVE_INFINITY,
    },
  );
}

/** Minutos de recorrido sin congestion, a velocidad urbana media. */
function estimateBaselineMinutes(path: LatLng[]): number {
  let meters = 0;
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const dLat = (b.lat - a.lat) * 111_320;
    const dLng = (b.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
    meters += Math.hypot(dLat, dLng);
  }
  return Math.round((meters / 1000 / 38) * 60);
}

let cached: TrafficProvider | null = null;

export function getTrafficProvider(): TrafficProvider {
  if (cached) return cached;

  const env = getServerEnv();

  if (env.TRAFFIC_PROVIDER === 'tomtom' && env.TRAFFIC_API_KEY) {
    cached = new TomTomTrafficProvider(env.TRAFFIC_API_KEY);
    return cached;
  }

  // Mapbox y Google siguen el mismo patron; se agregan cuando Fenice defina
  // proveedor y contrate la clave correspondiente.
  cached = new UnavailableTrafficProvider();
  return cached;
}
