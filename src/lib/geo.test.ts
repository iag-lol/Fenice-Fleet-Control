import { describe, expect, it } from 'vitest';

import {
  bearingDegrees,
  boundsOf,
  circleToPolygon,
  destinationPoint,
  distanceToSegment,
  haversineMeters,
  interpolate,
  isUsableCoordinate,
  pointInPolygon,
  polygonCentroid,
  polylineLengthMeters,
  projectOnPolyline,
  sliceCorridor,
} from '@/lib/geo';

/** Referencias reales usadas para validar las formulas geodesicas. */
const SANTIAGO = { lat: -33.4489, lng: -70.6693 };
const VALPARAISO = { lat: -33.0472, lng: -71.6127 };

describe('haversineMeters', () => {
  it('mide una distancia conocida con error menor al 1 %', () => {
    // Santiago - Valparaiso: aproximadamente 97 km en linea recta.
    const distance = haversineMeters(SANTIAGO, VALPARAISO);
    expect(distance).toBeGreaterThan(95_000);
    expect(distance).toBeLessThan(99_000);
  });

  it('devuelve cero entre un punto y si mismo', () => {
    expect(haversineMeters(SANTIAGO, SANTIAGO)).toBe(0);
  });

  it('es simetrica', () => {
    expect(haversineMeters(SANTIAGO, VALPARAISO)).toBeCloseTo(
      haversineMeters(VALPARAISO, SANTIAGO),
      6,
    );
  });
});

describe('bearingDegrees y destinationPoint', () => {
  it('calcula rumbo norte', () => {
    expect(bearingDegrees(SANTIAGO, { lat: -33.4, lng: -70.6693 })).toBeCloseTo(0, 1);
  });

  it('calcula rumbo este', () => {
    expect(bearingDegrees(SANTIAGO, { lat: -33.4489, lng: -70.6 })).toBeCloseTo(90, 0);
  });

  it('proyecta un punto a la distancia indicada', () => {
    const target = destinationPoint(SANTIAGO, 90, 1000);
    expect(haversineMeters(SANTIAGO, target)).toBeCloseTo(1000, 0);
  });

  it('es consistente con el rumbo utilizado', () => {
    const target = destinationPoint(SANTIAGO, 135, 5000);
    expect(bearingDegrees(SANTIAGO, target)).toBeCloseTo(135, 0);
  });
});

describe('interpolate', () => {
  it('devuelve los extremos en t=0 y t=1', () => {
    expect(interpolate(SANTIAGO, VALPARAISO, 0)).toEqual(SANTIAGO);
    expect(interpolate(SANTIAGO, VALPARAISO, 1)).toEqual(VALPARAISO);
  });

  it('acota t fuera del rango [0,1]', () => {
    expect(interpolate(SANTIAGO, VALPARAISO, -2)).toEqual(SANTIAGO);
    expect(interpolate(SANTIAGO, VALPARAISO, 5)).toEqual(VALPARAISO);
  });
});

describe('distanceToSegment', () => {
  const a = { lat: -33.45, lng: -70.7 };
  const b = { lat: -33.45, lng: -70.6 };

  it('mide la perpendicular a un segmento', () => {
    const result = distanceToSegment({ lat: -33.4545, lng: -70.65 }, a, b);
    // 0.0045 grados de latitud son unos 500 m.
    expect(result.distanceMeters).toBeGreaterThan(450);
    expect(result.distanceMeters).toBeLessThan(550);
    expect(result.t).toBeCloseTo(0.5, 1);
  });

  it('se proyecta al extremo cuando el punto queda fuera del segmento', () => {
    const result = distanceToSegment({ lat: -33.45, lng: -70.9 }, a, b);
    expect(result.t).toBe(0);
    expect(result.closest).toEqual(a);
  });

  it('trata un segmento degenerado como un punto', () => {
    const result = distanceToSegment({ lat: -33.46, lng: -70.7 }, a, a);
    expect(result.t).toBe(0);
    expect(result.distanceMeters).toBeGreaterThan(0);
  });
});

describe('projectOnPolyline', () => {
  const path = [
    { lat: -33.45, lng: -70.7 },
    { lat: -33.45, lng: -70.65 },
    { lat: -33.45, lng: -70.6 },
  ];

  it('identifica el segmento mas cercano', () => {
    const result = projectOnPolyline({ lat: -33.451, lng: -70.62 }, path);
    expect(result?.segmentIndex).toBe(1);
  });

  it('acumula la distancia recorrida sobre la polilinea', () => {
    const result = projectOnPolyline({ lat: -33.45, lng: -70.65 }, path);
    const total = polylineLengthMeters(path);
    expect(result?.alongMeters).toBeCloseTo(total / 2, 0);
  });

  it('devuelve null con una polilinea vacia', () => {
    expect(projectOnPolyline(SANTIAGO, [])).toBeNull();
  });

  it('maneja una polilinea de un solo punto', () => {
    const result = projectOnPolyline(SANTIAGO, [VALPARAISO]);
    expect(result?.alongMeters).toBe(0);
    expect(result?.closest).toEqual(VALPARAISO);
  });
});

describe('sliceCorridor', () => {
  const path = [
    { lat: -33.45, lng: -70.7 },
    { lat: -33.45, lng: -70.65 },
    { lat: -33.45, lng: -70.6 },
    { lat: -33.45, lng: -70.55 },
  ];

  it('recorta el tramo entre dos proyecciones sobre el mismo corredor', () => {
    const from = projectOnPolyline({ lat: -33.451, lng: -70.68 }, path)!;
    const to = projectOnPolyline({ lat: -33.451, lng: -70.58 }, path)!;
    const slice = sliceCorridor(path, from, to);

    // Incluye los dos vertices intermedios del corredor (-70.65 y -70.6),
    // ademas de los puntos proyectados en los extremos.
    expect(slice[0]).toEqual(from.closest);
    expect(slice.at(-1)).toEqual(to.closest);
    expect(slice).toContainEqual(path[1]);
    expect(slice).toContainEqual(path[2]);
  });

  it('devuelve solo los dos extremos cuando ambos caen en el mismo segmento', () => {
    const from = projectOnPolyline({ lat: -33.451, lng: -70.69 }, path)!;
    const to = projectOnPolyline({ lat: -33.451, lng: -70.66 }, path)!;
    expect(sliceCorridor(path, from, to)).toEqual([from.closest, to.closest]);
  });

  it('devuelve un tramo vacio si el destino queda detras del origen', () => {
    const from = projectOnPolyline({ lat: -33.451, lng: -70.58 }, path)!;
    const to = projectOnPolyline({ lat: -33.451, lng: -70.68 }, path)!;
    expect(sliceCorridor(path, from, to)).toEqual([]);
  });
});

describe('pointInPolygon', () => {
  const square = [
    { lat: -33.4, lng: -70.7 },
    { lat: -33.4, lng: -70.6 },
    { lat: -33.5, lng: -70.6 },
    { lat: -33.5, lng: -70.7 },
  ];

  it('detecta un punto interior', () => {
    expect(pointInPolygon({ lat: -33.45, lng: -70.65 }, square)).toBe(true);
  });

  it('rechaza un punto exterior', () => {
    expect(pointInPolygon({ lat: -33.3, lng: -70.65 }, square)).toBe(false);
  });

  it('rechaza poligonos degenerados', () => {
    expect(pointInPolygon(SANTIAGO, [SANTIAGO, VALPARAISO])).toBe(false);
  });
});

describe('polygonCentroid y boundsOf', () => {
  const square = [
    { lat: -33.4, lng: -70.7 },
    { lat: -33.4, lng: -70.6 },
    { lat: -33.5, lng: -70.6 },
    { lat: -33.5, lng: -70.7 },
  ];

  it('calcula el centroide de un cuadrado', () => {
    const centroid = polygonCentroid(square);
    expect(centroid.lat).toBeCloseTo(-33.45, 5);
    expect(centroid.lng).toBeCloseTo(-70.65, 5);
  });

  it('calcula la caja envolvente', () => {
    expect(boundsOf(square)).toEqual({
      minLat: -33.5,
      maxLat: -33.4,
      minLng: -70.7,
      maxLng: -70.6,
    });
  });

  it('devuelve null sin puntos', () => {
    expect(boundsOf([])).toBeNull();
  });
});

describe('circleToPolygon', () => {
  it('genera un anillo cerrado', () => {
    const ring = circleToPolygon(SANTIAGO, 100, 16);
    expect(ring).toHaveLength(17);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('mantiene todos los vertices a la distancia del radio', () => {
    const ring = circleToPolygon(SANTIAGO, 250, 24);
    for (const vertex of ring) {
      expect(haversineMeters(SANTIAGO, vertex)).toBeCloseTo(250, 0);
    }
  });
});

describe('isUsableCoordinate', () => {
  it('acepta una coordenada valida', () => {
    expect(isUsableCoordinate(SANTIAGO)).toBe(true);
  });

  it('rechaza el marcador (0,0)', () => {
    expect(isUsableCoordinate({ lat: 0, lng: 0 })).toBe(false);
  });

  it('rechaza valores fuera de rango, nulos o no finitos', () => {
    expect(isUsableCoordinate({ lat: 95, lng: 0 })).toBe(false);
    expect(isUsableCoordinate({ lat: 0, lng: 200 })).toBe(false);
    expect(isUsableCoordinate(null)).toBe(false);
    expect(isUsableCoordinate({ lat: Number.NaN, lng: -70 })).toBe(false);
  });
});
