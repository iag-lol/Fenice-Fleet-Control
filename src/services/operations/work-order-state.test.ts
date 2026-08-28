import { describe, expect, it } from 'vitest';

import { evaluateDeliveryVisit } from '@/lib/engines/geofence-engine';
import { evaluateRouteProgress } from '@/lib/engines/route-compliance';
import { destinationPoint } from '@/lib/geo';
import {
  asClientId,
  asDeviceId,
  asGeofenceId,
  asRouteId,
  asVehicleId,
  asWorkOrderId,
  type Geofence,
  type Position,
  type Route,
  type WorkOrderStatus,
  DEFAULT_GEOFENCE_RULES,
} from '@/types/core';

/**
 * Ciclo de vida de una orden de trabajo.
 *
 * Verifica la regla mas delicada del sistema: distinguir la EVIDENCIA de que
 * un camion paso por la direccion de la CONFIRMACION de que la entrega
 * ocurrio. Confundirlas haria que la plataforma declare entregas inexistentes.
 */

const CLIENT_POINT = { lat: -33.4489, lng: -70.6693 };

const geofence: Geofence = {
  id: asGeofenceId('gf-1'),
  name: 'Cliente demo - entrega',
  kind: 'cliente',
  geometry: { shape: 'circle', center: CLIENT_POINT, radiusMeters: 80 },
  referenceId: 'cli-0001',
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

function sample(meters: number, isoTime: string, speed = 0): Position {
  const point = destinationPoint(CLIENT_POINT, 30, meters);
  return {
    vehicleId: asVehicleId('veh-001'),
    deviceId: asDeviceId('dev-001'),
    timestamp: isoTime,
    lat: point.lat,
    lng: point.lng,
    speed,
    heading: 30,
    ignition: 'on',
    valid: true,
  };
}

/**
 * Reproduce la regla que aplica el proveedor operacional para decidir el
 * estado y la confirmacion de una parada visitada.
 */
function deriveStopOutcome(
  positions: Position[],
  options: { minDwellSeconds: number; autoConfirm: boolean; now: Date },
): { status: WorkOrderStatus; confirmation: 'gps' | 'none' } {
  const visit = evaluateDeliveryVisit({
    geofence,
    positions,
    minDwellSeconds: options.minDwellSeconds,
    now: options.now,
  });

  if (!visit.confirmed) {
    return { status: 'visita_detectada', confirmation: 'none' };
  }

  return {
    status: visit.exitedAt === null ? 'en_cliente' : 'visita_detectada',
    confirmation: options.autoConfirm ? 'gps' : 'none',
  };
}

describe('derivacion del estado de una OT desde la telemetria', () => {
  const now = new Date('2026-08-27T10:30:00.000Z');

  it('confirma la entrega por GPS tras cumplir la permanencia', () => {
    const outcome = deriveStopOutcome(
      [
        sample(500, '2026-08-27T10:00:00.000Z', 35),
        sample(30, '2026-08-27T10:02:00.000Z'),
        sample(25, '2026-08-27T10:10:00.000Z'),
        sample(600, '2026-08-27T10:12:00.000Z', 30),
      ],
      { minDwellSeconds: 60, autoConfirm: true, now },
    );

    expect(outcome.status).toBe('visita_detectada');
    expect(outcome.confirmation).toBe('gps');
  });

  it('marca en cliente mientras el vehiculo sigue dentro de la geocerca', () => {
    const outcome = deriveStopOutcome(
      [
        sample(500, '2026-08-27T10:00:00.000Z', 35),
        sample(20, '2026-08-27T10:05:00.000Z'),
      ],
      { minDwellSeconds: 60, autoConfirm: true, now },
    );

    expect(outcome.status).toBe('en_cliente');
    expect(outcome.confirmation).toBe('gps');
  });

  it('registra la visita SIN confirmar la entrega si solo paso por el frente', () => {
    const outcome = deriveStopOutcome(
      [
        sample(500, '2026-08-27T10:00:00.000Z', 40),
        sample(60, '2026-08-27T10:00:15.000Z', 30),
        sample(500, '2026-08-27T10:00:30.000Z', 40),
      ],
      { minDwellSeconds: 60, autoConfirm: true, now },
    );

    // Evidencia de paso, no de entrega: la distincion se mantiene.
    expect(outcome.status).toBe('visita_detectada');
    expect(outcome.confirmation).toBe('none');
  });

  it('respeta la desactivacion de la confirmacion automatica', () => {
    const outcome = deriveStopOutcome(
      [
        sample(500, '2026-08-27T10:00:00.000Z', 35),
        sample(30, '2026-08-27T10:02:00.000Z'),
        sample(600, '2026-08-27T10:12:00.000Z', 30),
      ],
      { minDwellSeconds: 60, autoConfirm: false, now },
    );

    // La evidencia GPS existe, pero la entrega queda a confirmacion humana.
    expect(outcome.status).toBe('visita_detectada');
    expect(outcome.confirmation).toBe('none');
  });

  it('conserva la trazabilidad completa de la visita', () => {
    const visit = evaluateDeliveryVisit({
      geofence,
      positions: [
        sample(500, '2026-08-27T10:00:00.000Z', 35),
        sample(18, '2026-08-27T10:02:00.000Z'),
        sample(22, '2026-08-27T10:09:00.000Z'),
        sample(600, '2026-08-27T10:11:00.000Z', 30),
      ],
      minDwellSeconds: 60,
      now,
    });

    expect(visit.enteredAt).toBe('2026-08-27T10:02:00.000Z');
    expect(visit.exitedAt).toBe('2026-08-27T10:11:00.000Z');
    expect(visit.dwellSeconds).toBe(540);
    expect(visit.closestApproachMeters).toBeGreaterThan(15);
    expect(visit.closestApproachMeters).toBeLessThan(25);
    expect(visit.entryPosition).not.toBeNull();
  });
});

describe('progreso automatico de la ruta', () => {
  function routeWith(statuses: WorkOrderStatus[]): Route {
    return {
      id: asRouteId('rt-001'),
      code: 'R-001',
      name: 'Ruta demo',
      date: '2026-08-27T00:00:00.000Z',
      vehicleId: asVehicleId('veh-001'),
      driverId: null,
      status: 'en_curso',
      authorizedCommuneCodes: ['13101'],
      stops: statuses.map((status, index) => ({
        sequence: index + 1,
        workOrderId: asWorkOrderId(`wo-${index + 1}`),
        clientId: asClientId(`cli-${index + 1}`),
        clientName: `Cliente ${index + 1}`,
        addressLine: 'Direccion demo',
        communeName: 'Santiago Centro',
        coordinates: CLIENT_POINT,
        plannedArrivalAt: null,
        actualArrivalAt: null,
        status,
      })),
      plannedPath: [
        { lat: -33.46, lng: -70.68 },
        { lat: -33.44, lng: -70.65 },
      ],
      executedPath: [],
      plannedDistanceKm: 4,
      startedAt: '2026-08-27T08:10:00.000Z',
      completedAt: null,
    };
  }

  it('refleja 2 de 5 entregas detectadas', () => {
    const progress = evaluateRouteProgress(
      routeWith(['visita_detectada', 'visita_detectada', 'proxima', 'en_ruta', 'en_ruta']),
      null,
    );

    expect(progress.completedStops).toBe(2);
    expect(progress.totalStops).toBe(5);
    expect(progress.nextStop?.sequence).toBe(3);
    expect(progress.complete).toBe(false);
  });

  it('avanza la parada siguiente al confirmarse la anterior', () => {
    const before = evaluateRouteProgress(routeWith(['proxima', 'en_ruta', 'en_ruta']), null);
    const after = evaluateRouteProgress(
      routeWith(['visita_detectada', 'proxima', 'en_ruta']),
      null,
    );

    expect(before.nextStop?.sequence).toBe(1);
    expect(after.nextStop?.sequence).toBe(2);
    expect(after.completedStops).toBe(1);
  });

  it('cierra la ruta cuando todas las paradas quedan resueltas', () => {
    const progress = evaluateRouteProgress(
      routeWith(['visita_detectada', 'completada', 'incidencia']),
      null,
    );

    expect(progress.complete).toBe(true);
    expect(progress.nextStop).toBeNull();
  });
});

describe('integridad del cierre de ruta', () => {
  /**
   * Reproduce la regla que aplica el proveedor operacional al derivar el
   * estado de cada parada segun el avance real del vehiculo.
   */
  function deriveStatuses(options: {
    sequences: number[];
    visited: number[];
    routeEnded: boolean;
    stopMode?: boolean;
  }): WorkOrderStatus[] {
    const visited = new Set(options.visited);
    const routeComplete = options.sequences.every((s) => visited.has(s));
    let nextAssigned = false;

    return options.sequences.map((sequence) => {
      if (visited.has(sequence)) {
        return routeComplete ? 'completada' : 'visita_detectada';
      }
      if (options.routeEnded) return 'incidencia';
      if (!nextAssigned) {
        nextAssigned = true;
        return options.stopMode ? 'en_cliente' : 'proxima';
      }
      return 'en_ruta';
    });
  }

  it('NO declara entregada una parada a la que el vehiculo nunca llego', () => {
    const statuses = deriveStatuses({
      sequences: [1, 2, 3],
      visited: [1, 2],
      routeEnded: true,
    });

    // La regla critica: cerrar la ruta no puede cerrar entregas inexistentes.
    expect(statuses[2]).toBe('incidencia');
    expect(statuses[2]).not.toBe('completada');
  });

  it('cierra como completadas las paradas de una ruta terminada por entero', () => {
    const statuses = deriveStatuses({
      sequences: [1, 2, 3],
      visited: [1, 2, 3],
      routeEnded: true,
    });

    expect(statuses).toEqual(['completada', 'completada', 'completada']);
  });

  it('mantiene las paradas visitadas como evidencia mientras la ruta sigue', () => {
    const statuses = deriveStatuses({
      sequences: [1, 2, 3, 4],
      visited: [1, 2],
      routeEnded: false,
    });

    expect(statuses).toEqual(['visita_detectada', 'visita_detectada', 'proxima', 'en_ruta']);
  });

  it('marca en cliente la parada en curso cuando el vehiculo esta detenido en ella', () => {
    const statuses = deriveStatuses({
      sequences: [1, 2, 3],
      visited: [1],
      routeEnded: false,
      stopMode: true,
    });

    expect(statuses[1]).toBe('en_cliente');
  });

  it('una ruta sin ninguna parada visitada no se considera completa', () => {
    const statuses = deriveStatuses({
      sequences: [1, 2],
      visited: [],
      routeEnded: false,
    });

    expect(statuses).toEqual(['proxima', 'en_ruta']);
  });
});

describe('progreso mostrado al cliente final', () => {
  /**
   * Reproduce la regla del seguimiento publico. La barra tiene tres tramos
   * (en preparacion, en camino, entregado) y solo se completa cuando el
   * pedido esta realmente entregado: un 100 % sobre un pedido que aun viaja
   * le comunica al cliente que ya lo recibio.
   */
  const FLOOR = 0.12;
  const CEILING = 0.85;
  const AT_DESTINATION = 0.94;

  function publicProgress(options: {
    status: WorkOrderStatus;
    stopIndex: number;
    visitedBefore: number;
  }): number {
    const closed = ['visita_detectada', 'completada', 'cancelada'].includes(options.status);
    if (closed) return 1;
    if (options.status === 'en_cliente') return AT_DESTINATION;
    if (!['en_ruta', 'proxima'].includes(options.status)) return FLOOR / 2;

    const ratio = options.stopIndex === 0 ? 0.5 : options.visitedBefore / options.stopIndex;
    return FLOOR + (CEILING - FLOOR) * Math.min(1, ratio);
  }

  it('nunca llega al 100 % con el pedido aun en camino', () => {
    // Caso que producia un 100 % enganoso: primera parada de la ruta, ya
    // visitada la anterior.
    const progress = publicProgress({ status: 'proxima', stopIndex: 1, visitedBefore: 1 });

    expect(progress).toBeLessThan(1);
    expect(progress).toBeLessThanOrEqual(CEILING);
  });

  it('llega al 100 % solo cuando el pedido esta entregado', () => {
    expect(publicProgress({ status: 'completada', stopIndex: 3, visitedBefore: 3 })).toBe(1);
    expect(publicProgress({ status: 'visita_detectada', stopIndex: 3, visitedBefore: 3 })).toBe(1);
  });

  it('muestra un avance minimo mientras el pedido no sale a ruta', () => {
    const progress = publicProgress({ status: 'pendiente', stopIndex: 0, visitedBefore: 0 });

    expect(progress).toBeGreaterThan(0);
    expect(progress).toBeLessThan(FLOOR);
  });

  it('avanza a medida que se completan las entregas previas', () => {
    const early = publicProgress({ status: 'en_ruta', stopIndex: 4, visitedBefore: 1 });
    const late = publicProgress({ status: 'en_ruta', stopIndex: 4, visitedBefore: 3 });

    expect(late).toBeGreaterThan(early);
    expect(late).toBeLessThanOrEqual(CEILING);
  });

  it('marca casi completo cuando el vehiculo ya esta en el domicilio', () => {
    const progress = publicProgress({ status: 'en_cliente', stopIndex: 2, visitedBefore: 2 });

    expect(progress).toBe(AT_DESTINATION);
    expect(progress).toBeLessThan(1);
  });
});
