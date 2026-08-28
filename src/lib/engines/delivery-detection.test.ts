import { describe, expect, it } from 'vitest';

import { DEFAULT_OPERATIONAL_SETTINGS } from '@/config/operational';
import { evaluateDelivery, isTrackingAllowed } from '@/lib/engines/delivery-detection';
import { destinationPoint } from '@/lib/geo';
import {
  asClientId,
  asDeviceId,
  asGeofenceId,
  asOrderId,
  asVehicleId,
  asWorkOrderId,
  DEFAULT_GEOFENCE_RULES,
  type Geofence,
  type Position,
  type WorkOrder,
} from '@/types/core';

/**
 * Este motor decide cuando un pedido queda entregado sin que nadie lo declare.
 * Una deteccion de mas es una entrega que no ocurrio; una de menos hace que un
 * camion vuelva a un cliente ya atendido. Ambas erosionan la confianza en la
 * plataforma, asi que cada regla tiene su caso.
 */

const settings = DEFAULT_OPERATIONAL_SETTINGS;
const CLIENT_POINT = { lat: -33.4489, lng: -70.6693 };

const geofence: Geofence = {
  id: asGeofenceId('gf-cli-1'),
  name: 'Estacion de Servicio Andina - entrega',
  description: null,
  kind: 'cliente',
  geometry: { shape: 'circle', center: CLIENT_POINT, radiusMeters: 80 },
  referenceId: null,
  clientId: null,
  routeId: null,
  vehicleId: null,
  communeCode: null,
  minDwellSeconds: 60,
  rules: { ...DEFAULT_GEOFENCE_RULES, minDwellSeconds: 60 },
  active: true,
  color: '#0d90ae',
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: null,
  origin: 'sistema',
};

function workOrder(overrides: Partial<WorkOrder> = {}): WorkOrder {
  return {
    id: asWorkOrderId('wo-1'),
    number: 'OT-2026-001501',
    orderId: asOrderId('ord-1'),
    orderNumber: 'PED-2026-001501',
    clientId: asClientId('cli-1'),
    clientName: 'Estacion de Servicio Andina',
    locationId: 'loc-1',
    addressLine: 'Av. Matta 1200',
    communeCode: '13101',
    communeName: 'Santiago',
    coordinates: CLIENT_POINT,
    vehicleId: asVehicleId('veh-001'),
    driverId: null,
    routeId: null,
    stopSequence: 1,
    scheduledDate: '2026-08-27T00:00:00.000Z',
    scheduledWindowStart: '2026-08-27T10:00:00.000Z',
    scheduledWindowEnd: '2026-08-27T12:00:00.000Z',
    estimatedArrivalAt: null,
    actualArrivalAt: null,
    actualDepartureAt: null,
    priority: 'normal',
    status: 'proxima',
    geofenceId: asGeofenceId('gf-cli-1'),
    deliveryConfirmation: 'none',
    closestApproachMeters: null,
    dwellSeconds: null,
    notes: null,
    trackingToken: 'TRK00001123',
    ...overrides,
  };
}

/** Posicion a `meters` del domicilio, del vehiculo indicado. */
function at(meters: number, iso: string, vehicleId = 'veh-001', speed = 0): Position {
  const point = destinationPoint(CLIENT_POINT, 30, meters);
  return {
    vehicleId: asVehicleId(vehicleId),
    deviceId: asDeviceId('dev-001'),
    timestamp: iso,
    lat: point.lat,
    lng: point.lng,
    speed,
    heading: 30,
    ignition: 'on',
    valid: true,
  };
}

/** Trayecto que entra, permanece diez minutos y sale. */
const validVisit: Position[] = [
  at(500, '2026-08-27T10:00:00.000Z', 'veh-001', 40),
  at(30, '2026-08-27T10:02:00.000Z'),
  at(25, '2026-08-27T10:12:00.000Z'),
  at(600, '2026-08-27T10:14:00.000Z', 'veh-001', 35),
];

const now = new Date('2026-08-27T10:30:00.000Z');
const base = { settings, now };

describe('validacion del vehiculo', () => {
  it('NO entrega si la orden no tiene camion asignado', () => {
    const result = evaluateDelivery({
      ...base,
      workOrder: workOrder({ vehicleId: null }),
      geofence,
      positions: validVisit,
      mode: 'dwell',
    });

    expect(result.detected).toBe(false);
    expect(result.rejection).toBe('sin_vehiculo_asignado');
  });

  it('NO entrega si el camion que entro no es el asignado', () => {
    // En una distribuidora con varias rutas por comuna, esto ocurriria a
    // diario: sin esta validacion un camion cerraria el pedido de otro.
    const result = evaluateDelivery({
      ...base,
      workOrder: workOrder(),
      geofence,
      positions: [
        at(500, '2026-08-27T10:00:00.000Z', 'veh-009', 40),
        at(30, '2026-08-27T10:02:00.000Z', 'veh-009'),
        at(25, '2026-08-27T10:12:00.000Z', 'veh-009'),
      ],
      mode: 'dwell',
    });

    expect(result.detected).toBe(false);
    expect(result.rejection).toBe('vehiculo_incorrecto');
  });
});

describe('validacion de la geocerca', () => {
  it('NO entrega sin geocerca definida', () => {
    const result = evaluateDelivery({
      ...base,
      workOrder: workOrder(),
      geofence: null,
      positions: validVisit,
      mode: 'dwell',
    });

    expect(result.rejection).toBe('sin_geocerca');
  });

  it('NO entrega si la geocerca pertenece a otra orden', () => {
    const result = evaluateDelivery({
      ...base,
      workOrder: workOrder({ geofenceId: asGeofenceId('gf-cli-99') }),
      geofence,
      positions: validVisit,
      mode: 'dwell',
    });

    expect(result.rejection).toBe('geocerca_ajena');
  });
});

describe('validacion de la presencia', () => {
  it('NO entrega si el vehiculo nunca entro al perimetro', () => {
    const result = evaluateDelivery({
      ...base,
      workOrder: workOrder(),
      geofence,
      positions: [
        at(600, '2026-08-27T10:00:00.000Z', 'veh-001', 40),
        at(300, '2026-08-27T10:05:00.000Z', 'veh-001', 30),
      ],
      mode: 'dwell',
    });

    expect(result.detected).toBe(false);
    expect(result.presenceConfirmed).toBe(false);
    expect(result.rejection).toBe('nunca_entro');
  });

  it('NO entrega si solo paso por delante sin detenerse', () => {
    const result = evaluateDelivery({
      ...base,
      workOrder: workOrder(),
      geofence,
      positions: [
        at(500, '2026-08-27T10:00:00.000Z', 'veh-001', 45),
        at(50, '2026-08-27T10:00:20.000Z', 'veh-001', 40),
        at(500, '2026-08-27T10:00:40.000Z', 'veh-001', 45),
      ],
      mode: 'dwell',
    });

    expect(result.detected).toBe(false);
    // Hubo presencia: es evidencia util aunque no acredite la entrega.
    expect(result.presenceConfirmed).toBe(true);
    expect(result.rejection).toBe('permanencia_insuficiente');
  });

  it('NO entrega sin telemetria en la ventana', () => {
    const result = evaluateDelivery({
      ...base,
      workOrder: workOrder(),
      geofence,
      positions: [],
      mode: 'dwell',
    });

    expect(result.rejection).toBe('sin_posiciones');
  });
});

describe('modos de deteccion', () => {
  it('modo ENTER acredita la entrega con solo cruzar el perimetro', () => {
    const result = evaluateDelivery({
      ...base,
      workOrder: workOrder(),
      geofence,
      positions: [
        at(500, '2026-08-27T10:00:00.000Z', 'veh-001', 45),
        at(40, '2026-08-27T10:00:20.000Z', 'veh-001', 20),
      ],
      mode: 'enter',
    });

    expect(result.detected).toBe(true);
    expect(result.evidence?.mode).toBe('enter');
    expect(result.evidence?.requiredDwellSeconds).toBe(0);
  });

  it('modo DWELL exige la permanencia minima', () => {
    const result = evaluateDelivery({
      ...base,
      workOrder: workOrder(),
      geofence,
      positions: validVisit,
      mode: 'dwell',
    });

    expect(result.detected).toBe(true);
    expect(result.evidence?.dwellSeconds).toBe(720);
    expect(result.evidence?.requiredDwellSeconds).toBe(60);
  });

  it('modo DRIVER espera la confirmacion del conductor', () => {
    const sinConfirmar = evaluateDelivery({
      ...base,
      workOrder: workOrder(),
      geofence,
      positions: validVisit,
      mode: 'driver',
    });

    expect(sinConfirmar.detected).toBe(false);
    expect(sinConfirmar.rejection).toBe('pendiente_confirmacion_conductor');
    expect(sinConfirmar.presenceConfirmed).toBe(true);

    const confirmado = evaluateDelivery({
      ...base,
      workOrder: workOrder(),
      geofence,
      positions: validVisit,
      mode: 'driver',
      driverConfirmed: true,
    });

    expect(confirmado.detected).toBe(true);
    expect(confirmado.evidence?.source).toBe('driver');
  });

  it('modo HYBRID exige presencia GPS Y confirmacion del conductor', () => {
    // Solo con la confirmacion del conductor, sin presencia, no basta.
    const sinPresencia = evaluateDelivery({
      ...base,
      workOrder: workOrder(),
      geofence,
      positions: [at(700, '2026-08-27T10:00:00.000Z', 'veh-001', 40)],
      mode: 'hybrid',
      driverConfirmed: true,
    });

    expect(sinPresencia.detected).toBe(false);

    const ambas = evaluateDelivery({
      ...base,
      workOrder: workOrder(),
      geofence,
      positions: validVisit,
      mode: 'hybrid',
      driverConfirmed: true,
    });

    expect(ambas.detected).toBe(true);
    expect(ambas.reason).toContain('conductor');
  });
});

describe('idempotencia', () => {
  it('NO duplica una entrega ya registrada', () => {
    const result = evaluateDelivery({
      ...base,
      workOrder: workOrder({ deliveryConfirmation: 'gps' }),
      geofence,
      positions: validVisit,
      mode: 'dwell',
    });

    expect(result.detected).toBe(false);
    expect(result.rejection).toBe('ya_entregada');
  });

  it('NO vuelve a entregar una orden ya presente en el registro', () => {
    const result = evaluateDelivery({
      ...base,
      workOrder: workOrder(),
      geofence,
      positions: validVisit,
      mode: 'dwell',
      alreadyDetectedWorkOrderIds: new Set(['wo-1']),
    });

    expect(result.rejection).toBe('ya_entregada');
  });

  it('diez posiciones dentro del perimetro producen UNA sola entrega', () => {
    // El vehiculo reporta cada 15 s: durante una descarga de 10 minutos hay
    // decenas de muestras dentro de la geocerca.
    const many: Position[] = [at(500, '2026-08-27T10:00:00.000Z', 'veh-001', 40)];
    for (let i = 0; i < 40; i += 1) {
      many.push(at(30, new Date(Date.UTC(2026, 7, 27, 10, 2 + i * 0.25)).toISOString()));
    }

    const first = evaluateDelivery({
      ...base,
      workOrder: workOrder(),
      geofence,
      positions: many,
      mode: 'dwell',
    });
    expect(first.detected).toBe(true);

    // Registrada la primera, cualquier evaluacion posterior la rechaza.
    const second = evaluateDelivery({
      ...base,
      workOrder: workOrder(),
      geofence,
      positions: many,
      mode: 'dwell',
      alreadyDetectedWorkOrderIds: new Set([first.evidence!.workOrderId]),
    });
    expect(second.detected).toBe(false);
  });

  it('NO entrega una orden cancelada', () => {
    const result = evaluateDelivery({
      ...base,
      workOrder: workOrder({ status: 'cancelada' }),
      geofence,
      positions: validVisit,
      mode: 'dwell',
    });

    expect(result.rejection).toBe('orden_cancelada');
  });
});

describe('trazabilidad de la evidencia', () => {
  it('registra todo lo necesario para auditar la decision', () => {
    const result = evaluateDelivery({
      ...base,
      workOrder: workOrder(),
      geofence,
      positions: validVisit,
      mode: 'dwell',
    });

    const evidence = result.evidence!;

    // Nunca se cambia el estado de una OT sin dejar constancia de por que.
    expect(evidence.workOrderId).toBe('wo-1');
    expect(evidence.orderId).toBe('ord-1');
    expect(evidence.clientId).toBe('cli-1');
    expect(evidence.vehicleId).toBe('veh-001');
    expect(evidence.deviceId).toBe('dev-001');
    expect(evidence.geofenceId).toBe('gf-cli-1');
    expect(evidence.enteredAt).toBe('2026-08-27T10:02:00.000Z');
    expect(evidence.exitedAt).toBe('2026-08-27T10:14:00.000Z');
    expect(evidence.dwellSeconds).toBe(720);
    expect(evidence.closestApproachMeters).toBeGreaterThan(0);
    expect(evidence.radiusMeters).toBe(80);
    expect(evidence.requiredDwellSeconds).toBe(60);
    expect(evidence.mode).toBe('dwell');
    expect(evidence.position).not.toBeNull();
    expect(evidence.detectedAt).toBe(now.toISOString());
  });
});

describe('corte del seguimiento publico tras la entrega', () => {
  it('permite el seguimiento mientras el pedido viaja', () => {
    expect(isTrackingAllowed(workOrder({ status: 'en_ruta' }))).toBe(true);
    expect(isTrackingAllowed(workOrder({ status: 'proxima' }))).toBe(true);
    expect(isTrackingAllowed(workOrder({ status: 'en_cliente' }))).toBe(true);
  });

  it('CORTA el seguimiento en cuanto la entrega queda detectada', () => {
    // Requisito obligatorio de privacidad: entregado el pedido, la posicion
    // del camion deja de ser asunto del destinatario.
    expect(isTrackingAllowed(workOrder({ status: 'visita_detectada' }))).toBe(false);
    expect(isTrackingAllowed(workOrder({ status: 'completada' }))).toBe(false);
  });

  it('corta el seguimiento en una orden cancelada', () => {
    expect(isTrackingAllowed(workOrder({ status: 'cancelada' }))).toBe(false);
  });

  it('corta el seguimiento con la entrega confirmada, sea cual sea el origen', () => {
    for (const source of ['gps', 'driver', 'admin', 'manual'] as const) {
      expect(
        isTrackingAllowed(workOrder({ status: 'en_ruta', deliveryConfirmation: source })),
        `origen ${source} deberia cortar el seguimiento`,
      ).toBe(false);
    }
  });
});
