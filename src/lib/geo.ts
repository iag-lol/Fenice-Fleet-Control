import type { BoundingBox, LatLng } from '@/types/core';

/** Radio medio terrestre en metros (WGS-84). */
const EARTH_RADIUS_M = 6_371_008.8;

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/**
 * Distancia haversine en metros entre dos coordenadas.
 * Precision suficiente para geocercas urbanas (error < 0.5 %).
 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rumbo inicial en grados (0-359) desde `a` hacia `b`. */
export function bearingDegrees(a: LatLng, b: LatLng): number {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Proyecta un punto a `distanceMeters` siguiendo `bearing` grados. */
export function destinationPoint(
  origin: LatLng,
  bearing: number,
  distanceMeters: number,
): LatLng {
  const angular = distanceMeters / EARTH_RADIUS_M;
  const brng = toRad(bearing);
  const lat1 = toRad(origin.lat);
  const lng1 = toRad(origin.lng);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(brng),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { lat: toDeg(lat2), lng: ((toDeg(lng2) + 540) % 360) - 180 };
}

/** Interpolacion lineal entre dos coordenadas. `t` en [0,1]. */
export function interpolate(a: LatLng, b: LatLng, t: number): LatLng {
  const clamped = Math.max(0, Math.min(1, t));
  return {
    lat: a.lat + (b.lat - a.lat) * clamped,
    lng: a.lng + (b.lng - a.lng) * clamped,
  };
}

/**
 * Proyeccion plana local en metros, anclada a una latitud de referencia.
 * A escala urbana (< 50 km) el error es despreciable y evita el coste de una
 * proyeccion cartografica completa en los motores de reglas.
 */
function toLocalMeters(point: LatLng, originLat: number): { x: number; y: number } {
  const latScale = 111_320;
  const lngScale = 111_320 * Math.cos(toRad(originLat));
  return { x: point.lng * lngScale, y: point.lat * latScale };
}

/**
 * Distancia perpendicular en metros desde `point` al segmento `a`-`b`.
 * Devuelve tambien el punto mas cercano sobre el segmento y la fraccion
 * recorrida, que el motor de rutas usa para medir avance.
 */
export function distanceToSegment(
  point: LatLng,
  a: LatLng,
  b: LatLng,
): { distanceMeters: number; closest: LatLng; t: number } {
  const originLat = point.lat;
  const p = toLocalMeters(point, originLat);
  const pa = toLocalMeters(a, originLat);
  const pb = toLocalMeters(b, originLat);

  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    return { distanceMeters: haversineMeters(point, a), closest: a, t: 0 };
  }

  const t = Math.max(0, Math.min(1, ((p.x - pa.x) * dx + (p.y - pa.y) * dy) / lengthSq));
  const closest = interpolate(a, b, t);

  return { distanceMeters: haversineMeters(point, closest), closest, t };
}

export interface PolylineProjection {
  /** Distancia perpendicular minima a la polilinea, en metros. */
  distanceMeters: number;
  /** Indice del segmento mas cercano. */
  segmentIndex: number;
  /** Punto mas cercano sobre la polilinea. */
  closest: LatLng;
  /** Distancia recorrida a lo largo de la polilinea hasta `closest`, en metros. */
  alongMeters: number;
}

/** Proyecta un punto sobre una polilinea completa. */
export function projectOnPolyline(point: LatLng, path: LatLng[]): PolylineProjection | null {
  if (path.length === 0) return null;

  const first = path[0]!;
  if (path.length === 1) {
    return {
      distanceMeters: haversineMeters(point, first),
      segmentIndex: 0,
      closest: first,
      alongMeters: 0,
    };
  }

  let best: PolylineProjection = {
    distanceMeters: Number.POSITIVE_INFINITY,
    segmentIndex: 0,
    closest: first,
    alongMeters: 0,
  };

  let cumulative = 0;

  for (let i = 0; i < path.length - 1; i += 1) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const segmentLength = haversineMeters(a, b);
    const result = distanceToSegment(point, a, b);

    if (result.distanceMeters < best.distanceMeters) {
      best = {
        distanceMeters: result.distanceMeters,
        segmentIndex: i,
        closest: result.closest,
        alongMeters: cumulative + segmentLength * result.t,
      };
    }
    cumulative += segmentLength;
  }

  return best;
}

/** Longitud total de una polilinea en metros. */
export function polylineLengthMeters(path: LatLng[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i += 1) {
    total += haversineMeters(path[i]!, path[i + 1]!);
  }
  return total;
}

/**
 * Punto-en-poligono por ray casting. El poligono se asume cerrado
 * implicitamente (el ultimo vertice se une al primero).
 */
export function pointInPolygon(point: LatLng, vertices: LatLng[]): boolean {
  if (vertices.length < 3) return false;

  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i, i += 1) {
    const vi = vertices[i]!;
    const vj = vertices[j]!;

    const intersects =
      vi.lat > point.lat !== vj.lat > point.lat &&
      point.lng < ((vj.lng - vi.lng) * (point.lat - vi.lat)) / (vj.lat - vi.lat) + vi.lng;

    if (intersects) inside = !inside;
  }
  return inside;
}

/** Centroide aritmetico de un conjunto de vertices. */
export function polygonCentroid(vertices: LatLng[]): LatLng {
  if (vertices.length === 0) return { lat: 0, lng: 0 };
  const sum = vertices.reduce(
    (acc, v) => ({ lat: acc.lat + v.lat, lng: acc.lng + v.lng }),
    { lat: 0, lng: 0 },
  );
  return { lat: sum.lat / vertices.length, lng: sum.lng / vertices.length };
}

/** Caja envolvente de un conjunto de puntos. */
export function boundsOf(points: LatLng[]): BoundingBox | null {
  if (points.length === 0) return null;

  const first = points[0]!;
  let box: BoundingBox = {
    minLat: first.lat,
    maxLat: first.lat,
    minLng: first.lng,
    maxLng: first.lng,
  };

  for (const p of points) {
    box = {
      minLat: Math.min(box.minLat, p.lat),
      maxLat: Math.max(box.maxLat, p.lat),
      minLng: Math.min(box.minLng, p.lng),
      maxLng: Math.max(box.maxLng, p.lng),
    };
  }
  return box;
}

/** Genera los vertices de un circulo, util para dibujar geocercas en el mapa. */
export function circleToPolygon(center: LatLng, radiusMeters: number, steps = 64): LatLng[] {
  const vertices: LatLng[] = [];
  for (let i = 0; i < steps; i += 1) {
    vertices.push(destinationPoint(center, (360 / steps) * i, radiusMeters));
  }
  vertices.push(vertices[0]!);
  return vertices;
}

/** Valida que una coordenada sea utilizable (no 0,0 ni fuera de rango). */
export function isUsableCoordinate(point: LatLng | null | undefined): point is LatLng {
  if (!point) return false;
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return false;
  if (Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) return false;
  // (0,0) es el marcador clasico de coordenada no resuelta.
  return !(point.lat === 0 && point.lng === 0);
}
