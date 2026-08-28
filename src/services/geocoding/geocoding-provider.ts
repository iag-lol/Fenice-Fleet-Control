import 'server-only';

import { getServerEnv } from '@/config/env';
import type { LatLng } from '@/types/core';

/**
 * GeocodingProvider — resolucion de direccion a coordenadas.
 *
 * Regla operativa deliberada: NUNCA se geocodifica masivamente de forma
 * automatica. Los proveedores cobran por consulta y aplican limites de tasa;
 * una base con miles de direcciones puede generar un costo inesperado o un
 * bloqueo. La geocodificacion se dispara SIEMPRE por accion explicita y se
 * cachea para no repetir la misma consulta.
 */

export interface GeocodeRequest {
  addressLine: string;
  communeName?: string;
  region?: string;
  country?: string;
}

export interface GeocodeResult {
  coordinates: LatLng;
  formattedAddress: string;
  /** 0-1. Permite decidir si se acepta automaticamente o requiere revision. */
  confidence: number;
  provider: string;
}

export interface GeocodingProvider {
  readonly id: string;
  readonly available: boolean;
  geocode(request: GeocodeRequest): Promise<GeocodeResult | null>;
}

/** Cache en memoria. En produccion se persiste junto a `ClientLocation`. */
const cache = new Map<string, GeocodeResult | null>();

function cacheKey(request: GeocodeRequest): string {
  return [request.addressLine, request.communeName, request.region, request.country]
    .filter(Boolean)
    .join('|')
    .toLowerCase();
}

/** Proveedor inactivo: devuelve `null` sin llamar a ningun servicio. */
class DisabledGeocodingProvider implements GeocodingProvider {
  readonly id = 'none';
  readonly available = false;

  async geocode(): Promise<null> {
    return null;
  }
}

/**
 * Nominatim (OpenStreetMap). Gratuito, con politica de uso justo: exige
 * identificarse y limita a ~1 consulta por segundo. Adecuado para resolver
 * direcciones puntuales, no para cargas masivas.
 */
class NominatimGeocodingProvider implements GeocodingProvider {
  readonly id = 'nominatim';
  readonly available = true;

  private lastRequestAt = 0;

  async geocode(request: GeocodeRequest): Promise<GeocodeResult | null> {
    // Respeto explicito del limite de tasa del servicio publico.
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < 1_100) await new Promise((resolve) => setTimeout(resolve, 1_100 - elapsed));
    this.lastRequestAt = Date.now();

    const query = [request.addressLine, request.communeName, request.region ?? 'Region Metropolitana', request.country ?? 'Chile']
      .filter(Boolean)
      .join(', ');

    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    url.searchParams.set('countrycodes', 'cl');

    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'FeniceFleetControl/1.0 (contacto@fenice.cl)' },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) return null;

      const payload = (await response.json()) as {
        lat: string;
        lon: string;
        display_name: string;
        importance?: number;
      }[];

      const first = payload[0];
      if (!first) return null;

      return {
        coordinates: { lat: Number(first.lat), lng: Number(first.lon) },
        formattedAddress: first.display_name,
        confidence: Math.min(1, first.importance ?? 0.5),
        provider: this.id,
      };
    } catch {
      return null;
    }
  }
}

let cachedProvider: GeocodingProvider | null = null;

export function getGeocodingProvider(): GeocodingProvider {
  if (cachedProvider) return cachedProvider;

  const env = getServerEnv();

  // MapTiler / Mapbox / Google se agregan siguiendo el mismo patron cuando
  // Fenice defina proveedor y contrate la clave correspondiente.
  cachedProvider =
    env.GEOCODING_PROVIDER === 'nominatim'
      ? new NominatimGeocodingProvider()
      : new DisabledGeocodingProvider();

  return cachedProvider;
}

/** Geocodifica una direccion, reutilizando el resultado si ya fue consultada. */
export async function geocodeAddress(request: GeocodeRequest): Promise<GeocodeResult | null> {
  const key = cacheKey(request);
  if (cache.has(key)) return cache.get(key) ?? null;

  const result = await getGeocodingProvider().geocode(request);
  cache.set(key, result);
  return result;
}
