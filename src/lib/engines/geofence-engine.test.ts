import { describe, expect, it } from 'vitest';

import {
  calculateDwellTime,
  containsPoint,
  detectEntry,
  detectExit,
  detectTransition,
  distanceToCenter,
  evaluateDeliveryVisit,
  geofenceCenter,
  scanTrackForGeofenceEvents,
} from '@/lib/engines/geofence-engine';
import { destinationPoint } from '@/lib/geo';
import {
  asDeviceId,
  asGeofenceId,
  asVehicleId,
  DEFAULT_GEOFENCE_RULES,
  type Geofence,
  type Position,
} from '@/types/core';

const CENTER = { lat: -33.4489, lng: -70.6693 };

const circle: Geofence = {
  id: asGeofenceId('gf-1'),
  name: 'Cliente demo',
  kind: 'cliente',
  geometry: { shape: 'circle', center: CENTER, radiusMeters: 80 },
  referenceId: null,
  minDwellSeconds: 60,
  rules: { ...DEFAULT_GEOFENCE_RULES, minDwellSeconds: 60 },
  description: null,
  clientId: null,
  routeId: null,
  vehicleId: null,
  communeCode: null,
  active: true,
  color: '#0d90ae',
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: null,
  origin: 'sistema',
};

const polygon: Geofence = {
  ...circle,
  id: asGeofenceId('gf-2'),
  geometry: {
    shape: 'polygon',
    vertices: [
      { lat: -33.44, lng: -70.68 },
      { lat: -33.44, lng: -70.66 },
      { lat: -33.46, lng: -70.66 },
      { lat: -33.46, lng: -70.68 },
    ],
  },
};

/** Crea una posicion a `meters` del centro, en el instante indicado. */
function positionAt(meters: number, isoTime: string, speed = 0): Position {
  const point = destinationPoint(CENTER, 45, meters);
  return {
    vehicleId: asVehicleId('veh-001'),
    deviceId: asDeviceId('dev-001'),
    timestamp: isoTime,
    lat: point.lat,
    lng: point.lng,
    speed,
    heading: 45,
    ignition: 'on',
    valid: true,
  };
}

describe('containsPoint', () => {
  it('acepta un punto dentro del radio', () => {
    expect(containsPoint(circle, destinationPoint(CENTER, 0, 40))).toBe(true);
  });

  it('rechaza un punto fuera del radio', () => {
    expect(containsPoint(circle, destinationPoint(CENTER, 0, 120))).toBe(false);
  });

  it('acepta el punto justo en el borde', () => {
    // El contrato es inclusivo: 80 m con radio 80 esta dentro.
    expect(containsPoint(circle, destinationPoint(CENTER, 90, 79.5))).toBe(true);
  });

  it('resuelve poligonos por ray casting', () => {
    expect(containsPoint(polygon, { lat: -33.45, lng: -70.67 })).toBe(true);
    expect(containsPoint(polygon, { lat: -33.5, lng: -70.67 })).toBe(false);
  });
});

describe('geofenceCenter y distanceToCenter', () => {
  it('devuelve el centro declarado en geocercas circulares', () => {
    expect(geofenceCenter(circle)).toEqual(CENTER);
  });

  it('usa el centroide en geocercas poligonales', () => {
    const center = geofenceCenter(polygon);
    expect(center.lat).toBeCloseTo(-33.45, 4);
    expect(center.lng).toBeCloseTo(-70.67, 4);
  });

  it('mide la distancia al centro con precision suficiente', () => {
    const distance = distanceToCenter(circle, destinationPoint(CENTER, 180, 250));
    expect(distance).toBeGreaterThan(245);
    expect(distance).toBeLessThan(255);
  });
});

describe('detectTransition', () => {
  const inside = destinationPoint(CENTER, 0, 30);
  const outside = destinationPoint(CENTER, 0, 300);

  it('detecta la entrada', () => {
    expect(detectTransition(circle, outside, inside)).toBe('enter');
    expect(detectEntry(circle, outside, inside)).toBe(true);
  });

  it('detecta la salida', () => {
    expect(detectTransition(circle, inside, outside)).toBe('exit');
    expect(detectExit(circle, inside, outside)).toBe(true);
  });

  it('no reporta transicion si permanece dentro', () => {
    expect(detectTransition(circle, inside, inside)).toBe('inside');
  });

  it('trata la primera muestra dentro como entrada', () => {
    expect(detectTransition(circle, null, inside)).toBe('enter');
  });
});

describe('calculateDwellTime', () => {
  it('calcula la permanencia entre entrada y salida', () => {
    expect(
      calculateDwellTime('2026-08-27T10:00:00.000Z', '2026-08-27T10:05:30.000Z'),
    ).toBe(330);
  });

  it('mide hasta ahora cuando la visita sigue abierta', () => {
    const dwell = calculateDwellTime(
      '2026-08-27T10:00:00.000Z',
      null,
      new Date('2026-08-27T10:02:00.000Z'),
    );
    expect(dwell).toBe(120);
  });

  it('devuelve 0 ante fechas invalidas', () => {
    expect(calculateDwellTime('invalida', null, new Date())).toBe(0);
  });
});

describe('evaluateDeliveryVisit', () => {
  it('confirma la visita cuando se cumple la permanencia minima', () => {
    const result = evaluateDeliveryVisit({
      geofence: circle,
      positions: [
        positionAt(400, '2026-08-27T10:00:00.000Z', 30),
        positionAt(40, '2026-08-27T10:01:00.000Z'),
        positionAt(30, '2026-08-27T10:04:00.000Z'),
        positionAt(500, '2026-08-27T10:06:00.000Z', 25),
      ],
      minDwellSeconds: 60,
      now: new Date('2026-08-27T10:10:00.000Z'),
    });

    expect(result.entered).toBe(true);
    expect(result.confirmed).toBe(true);
    expect(result.dwellSeconds).toBe(300);
    expect(result.enteredAt).toBe('2026-08-27T10:01:00.000Z');
    expect(result.exitedAt).toBe('2026-08-27T10:06:00.000Z');
    expect(result.passCount).toBe(1);
  });

  it('NO confirma la entrega si solo paso frente al domicilio', () => {
    const result = evaluateDeliveryVisit({
      geofence: circle,
      positions: [
        positionAt(400, '2026-08-27T10:00:00.000Z', 40),
        positionAt(50, '2026-08-27T10:00:20.000Z', 35),
        positionAt(400, '2026-08-27T10:00:40.000Z', 40),
      ],
      minDwellSeconds: 60,
      now: new Date('2026-08-27T10:05:00.000Z'),
    });

    expect(result.entered).toBe(true);
    expect(result.confirmed).toBe(false);
    expect(result.dwellSeconds).toBe(20);
  });

  it('usa el tramo continuo mas largo y no la suma de pasadas', () => {
    const result = evaluateDeliveryVisit({
      geofence: circle,
      positions: [
        positionAt(50, '2026-08-27T10:00:00.000Z'),
        positionAt(400, '2026-08-27T10:00:30.000Z', 30),
        positionAt(50, '2026-08-27T10:01:00.000Z'),
        positionAt(400, '2026-08-27T10:01:40.000Z', 30),
      ],
      minDwellSeconds: 60,
      now: new Date('2026-08-27T10:05:00.000Z'),
    });

    expect(result.passCount).toBe(2);
    // Dos pasadas de 30 s y 40 s no equivalen a una permanencia de 70 s.
    expect(result.dwellSeconds).toBe(40);
    expect(result.confirmed).toBe(false);
  });

  it('mide hasta ahora si el vehiculo sigue dentro', () => {
    const result = evaluateDeliveryVisit({
      geofence: circle,
      positions: [
        positionAt(400, '2026-08-27T10:00:00.000Z', 30),
        positionAt(20, '2026-08-27T10:01:00.000Z'),
      ],
      minDwellSeconds: 60,
      now: new Date('2026-08-27T10:06:00.000Z'),
    });

    expect(result.exitedAt).toBeNull();
    expect(result.dwellSeconds).toBe(300);
    expect(result.confirmed).toBe(true);
  });

  it('registra la distancia minima aunque nunca haya entrado', () => {
    const result = evaluateDeliveryVisit({
      geofence: circle,
      positions: [
        positionAt(600, '2026-08-27T10:00:00.000Z', 40),
        positionAt(140, '2026-08-27T10:01:00.000Z', 20),
        positionAt(700, '2026-08-27T10:02:00.000Z', 45),
      ],
      minDwellSeconds: 60,
    });

    expect(result.entered).toBe(false);
    expect(result.confirmed).toBe(false);
    expect(result.closestApproachMeters).toBeGreaterThan(130);
    expect(result.closestApproachMeters).toBeLessThan(150);
  });

  it('confirma con permanencia minima cero apenas entra', () => {
    const result = evaluateDeliveryVisit({
      geofence: circle,
      positions: [
        positionAt(400, '2026-08-27T10:00:00.000Z', 40),
        positionAt(30, '2026-08-27T10:00:10.000Z', 5),
      ],
      minDwellSeconds: 0,
      now: new Date('2026-08-27T10:00:10.000Z'),
    });

    expect(result.confirmed).toBe(true);
  });

  it('devuelve un resultado vacio sin posiciones', () => {
    const result = evaluateDeliveryVisit({ geofence: circle, positions: [], minDwellSeconds: 60 });
    expect(result.entered).toBe(false);
    expect(result.closestApproachMeters).toBeNull();
  });
});

describe('scanTrackForGeofenceEvents', () => {
  it('emite entrada y salida en el orden correcto', () => {
    const { events } = scanTrackForGeofenceEvents(
      [
        positionAt(500, '2026-08-27T10:00:00.000Z', 40),
        positionAt(30, '2026-08-27T10:01:00.000Z'),
        positionAt(30, '2026-08-27T10:02:00.000Z'),
        positionAt(500, '2026-08-27T10:03:00.000Z', 40),
      ],
      [circle],
    );

    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe('enter');
    expect(events[1]?.type).toBe('exit');
  });

  it('ignora geocercas inactivas', () => {
    const { events } = scanTrackForGeofenceEvents(
      [positionAt(500, '2026-08-27T10:00:00.000Z'), positionAt(30, '2026-08-27T10:01:00.000Z')],
      [{ ...circle, active: false }],
    );
    expect(events).toHaveLength(0);
  });
});
