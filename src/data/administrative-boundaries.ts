import rmBoundaries from '@/data/communes-rm.json';
import { pointInPolygon, polygonCentroid } from '@/lib/geo';
import type { Commune, LatLng } from '@/types/core';

/**
 * AdministrativeBoundaryProvider — limites comunales oficiales de Chile.
 *
 * Los poligonos NO son dibujados a mano ni aproximados: provienen de las
 * relaciones de limite administrativo de nivel 8 de OpenStreetMap, que llevan
 * la etiqueta `dpachile:id`, el codigo de la Division Politico Administrativa
 * publicada por el Estado de Chile.
 *
 * Se importan con `npm run import:comunas` y quedan versionados en
 * `src/data/communes-<region>.json` junto a su fuente y fecha. Reemplazar la
 * cartografia mas adelante (por la del IDE Chile, por ejemplo) es sustituir
 * ese archivo: ningun motor ni componente cambia.
 *
 * ATRIBUCION: los datos son © colaboradores de OpenStreetMap, bajo licencia
 * ODbL. La atribucion se muestra en el mapa y no debe retirarse.
 */

interface BoundarySource {
  source: string;
  codeSystem: string;
  region: string;
  regionIso: string;
  importedAt: string;
  license: string;
  communes: {
    code: string;
    name: string;
    region: string;
    center: LatLng;
    boundary: LatLng[];
  }[];
}

const SOURCE = rmBoundaries as BoundarySource;

/** Procedencia de la cartografia, para la pantalla de integraciones. */
export interface BoundaryMetadata {
  source: string;
  codeSystem: string;
  region: string;
  importedAt: string;
  license: string;
  communeCount: number;
}

export const BOUNDARY_METADATA: BoundaryMetadata = {
  source: SOURCE.source,
  codeSystem: SOURCE.codeSystem,
  region: SOURCE.region,
  importedAt: SOURCE.importedAt,
  license: SOURCE.license,
  communeCount: SOURCE.communes.length,
};

export const COMMUNES: readonly Commune[] = SOURCE.communes.map((c) => ({
  code: c.code,
  name: c.name,
  region: c.region,
  center: c.center,
  boundary: c.boundary,
}));

const BY_CODE = new Map(COMMUNES.map((c) => [c.code, c]));

export function getCommune(code: string): Commune | null {
  return BY_CODE.get(code) ?? null;
}

export function getCommuneName(code: string): string {
  return BY_CODE.get(code)?.name ?? 'Sin comuna';
}

/**
 * Caja envolvente de cada comuna.
 *
 * Descartar por caja antes de evaluar punto-en-poligono evita recorrer miles
 * de vertices por consulta: con 52 comunas de hasta 700 vertices, la
 * diferencia es notable cuando se resuelve la comuna de cada posicion GPS.
 */
interface CommuneIndexEntry {
  commune: Commune;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

const SPATIAL_INDEX: CommuneIndexEntry[] = COMMUNES.map((commune) => {
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let minLng = Number.POSITIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;

  for (const point of commune.boundary) {
    if (point.lat < minLat) minLat = point.lat;
    if (point.lat > maxLat) maxLat = point.lat;
    if (point.lng < minLng) minLng = point.lng;
    if (point.lng > maxLng) maxLng = point.lng;
  }

  return { commune, minLat, maxLat, minLng, maxLng };
});

/** Cache de resoluciones. Las posiciones GPS se repiten mucho entre muestras. */
const resolutionCache = new Map<string, Commune | null>();
const CACHE_LIMIT = 20_000;

function cacheKey(point: LatLng): string {
  // Cuatro decimales son ~11 m: suficiente para que dos muestras del mismo
  // punto compartan resultado sin cruzar un limite comunal.
  return `${point.lat.toFixed(4)},${point.lng.toFixed(4)}`;
}

/**
 * Comuna que contiene una coordenada, por geometria real.
 *
 * Nunca se infiere de un texto: el nombre de la comuna en una direccion es
 * dato de captura y puede estar mal escrito, desactualizado o simplemente
 * equivocado. La geometria no.
 */
export function getCommuneForPoint(lat: number, lng: number): Commune | null {
  const point: LatLng = { lat, lng };
  const key = cacheKey(point);

  const cached = resolutionCache.get(key);
  if (cached !== undefined) return cached;

  let found: Commune | null = null;

  for (const entry of SPATIAL_INDEX) {
    if (lat < entry.minLat || lat > entry.maxLat) continue;
    if (lng < entry.minLng || lng > entry.maxLng) continue;
    if (pointInPolygon(point, entry.commune.boundary)) {
      found = entry.commune;
      break;
    }
  }

  if (resolutionCache.size >= CACHE_LIMIT) resolutionCache.clear();
  resolutionCache.set(key, found);

  return found;
}

/**
 * Encuadre inicial del mapa.
 *
 * NO es el centroide de la region: incluir las comunas rurales del poniente y
 * el sur (Alhue, San Pedro, Melipilla) desplazaria la vista lejos de donde
 * ocurre la operacion. Se ancla al Gran Santiago, que es donde esta la flota
 * y la mayor parte de la cartera.
 */
export { OPERATION_CENTER } from '@/config/map-viewport';

/** Centroide geometrico de la region, para analisis territorial. */
export const REGION_CENTROID: LatLng = polygonCentroid(COMMUNES.map((c) => c.center));

/** Caja que envuelve toda la region importada. */
export const OPERATION_BOUNDS = SPATIAL_INDEX.reduce(
  (box, entry) => ({
    minLat: Math.min(box.minLat, entry.minLat),
    maxLat: Math.max(box.maxLat, entry.maxLat),
    minLng: Math.min(box.minLng, entry.minLng),
    maxLng: Math.max(box.maxLng, entry.maxLng),
  }),
  {
    minLat: Number.POSITIVE_INFINITY,
    maxLat: Number.NEGATIVE_INFINITY,
    minLng: Number.POSITIVE_INFINITY,
    maxLng: Number.NEGATIVE_INFINITY,
  },
);
