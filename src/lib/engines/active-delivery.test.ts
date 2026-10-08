import { describe, expect, it } from 'vitest';
import { DEFAULT_OPERATIONAL_SETTINGS as settings } from '@/config/operational';
import { deliveryClock, deliveryGeofence, deliveryStillPresent, findActiveDelivery } from './active-delivery';
import type { Position, WorkOrder } from '@/types/core';
import type { ActiveDelivery } from '@/types/views';

const base = Date.parse('2026-10-07T12:00:00Z');
const coordinate = { lat: -33.45, lng: -70.66 };
const order = { id: 'wo1', number: 'OT-001', clientId: 'c1', vehicleId: 'v1', coordinates: coordinate,
  clientName: 'Cliente Uno', status: 'en_ruta', stopSequence: 1, actualArrivalAt: null, actualDepartureAt: null,
  geofenceId: null, scheduledDate: '2026-10-07', communeCode: '13101', routeId: 'r1' } as WorkOrder;
const pos = (second: number, values: Partial<Position> = {}): Position => ({ ...coordinate, vehicleId: 'v1' as Position['vehicleId'],
  deviceId: 'd1' as Position['deviceId'], valid: true, timestamp: new Date(base + second * 1000).toISOString(), speed: 0, heading: 0, ignition: 'on', ...values });
const inspect = (positions: Position[], workOrders = [order]) => findActiveDelivery({ position: positions.at(-1) ?? null,
  history: positions, workOrders, geofences: [], settings, now: new Date(Date.parse(positions.at(-1)?.timestamp ?? '2026-10-07T12:00:00Z')) });

describe('tarjeta de entrega activa', () => {
  it('se activa tras reposo consistente sin inventar una entrada entre lecturas', () => {
    const result = inspect([pos(0, { lng: -70.663, speed: 30 }), pos(15), pos(30), pos(60), pos(90)]);
    expect(result?.workOrder.id).toBe(order.id);
    expect(result?.enteredAt).toBe(pos(15).timestamp);
    expect(result?.stoppedAt).toBe(pos(15).timestamp);
    expect(result?.arrivalObserved).toBe(false);
  });
  it('no se abre por una pasada, una parada breve ni otro camión', () => {
    expect(inspect([pos(0), pos(60)])).toBeNull();
    expect(inspect([pos(60)], [{ ...order, status: 'en_cliente', actualArrivalAt: pos(0).timestamp }])).toBeNull();
    expect(inspect([pos(0), pos(30, { lng: -70.6605 }), pos(60)])).toBeNull();
    expect(inspect([pos(0), pos(30), pos(60, { accuracy: 100 })])).toBeNull();
    expect(inspect([pos(0), pos(15)])).toBeNull();
    expect(inspect([pos(0, { speed: 30 }), pos(60, { speed: 30 })])).toBeNull();
    expect(inspect([pos(0, { vehicleId: 'v2' as Position['vehicleId'] }), pos(60, { vehicleId: 'v2' as Position['vehicleId'] })])).toBeNull();
  });
  it('se apaga al salir o circular y cambia al cliente siguiente sin conservar la OT anterior', () => {
    const second = { ...order, id: 'wo2' as WorkOrder['id'], clientId: 'c2' as WorkOrder['clientId'], coordinates: { ...coordinate, lng: -70.658 }, stopSequence: 2 };
    const first = inspect([pos(0), pos(30), pos(60)], [order, second]);
    expect(first?.workOrder.id).toBe('wo1');
    expect(inspect([pos(0), pos(60, { lng: -70.659, speed: 30 })], [order, second])).toBeNull();
    const next = inspect([pos(0), pos(60), pos(90, { lng: -70.659, speed: 30 }), pos(105, { lng: -70.658 }), pos(135, { lng: -70.658 }), pos(165, { lng: -70.658 })], [order, second]);
    expect(next?.workOrder.id).toBe('wo2');
    expect(next?.stoppedAt).toBe(pos(105).timestamp);
  });
  it('no suma el corte GPS ni una visita anterior a una nueva detención', () => {
    const result = inspect([pos(0), pos(60), pos(600), pos(630), pos(660)]);
    expect(result?.stoppedAt).toBe(pos(600).timestamp);
    const reentry = inspect([pos(0), pos(60), pos(90, { lng: -70.661, speed: 30 }), pos(120), pos(150), pos(180)]);
    expect(reentry?.enteredAt).toBe(pos(120).timestamp);
  });
  it('un fix inválido, orden cancelada, salida registrada o geocerca ajena no activan la tarjeta', () => {
    expect(inspect([pos(0), pos(60, { valid: false })])).toBeNull();
    expect(inspect([pos(0), pos(60)], [{ ...order, status: 'cancelada' }])).toBeNull();
    expect(inspect([pos(0), pos(60)], [{ ...order, actualDepartureAt: pos(45).timestamp }])).toBeNull();
    const geofence = deliveryGeofence(order, [], 80)!;
    expect(deliveryGeofence({ ...order, geofenceId: geofence.id }, [{ ...geofence, clientId: 'c2' as WorkOrder['clientId'] }], 80)).toBeNull();
  });
  it('no activa una entrega actual usando una ubicación que ya está offline', () => {
    expect(findActiveDelivery({ position: pos(60), history: [pos(0), pos(60)], workOrders: [order], geofences: [], settings,
      now: new Date(base + 3600000) })).toBeNull();
  });
  it('un regreso reinicia la llegada aunque la OT conserve una hora antigua', () => {
    const result = inspect([pos(0), pos(60), pos(90, { lng: -70.661 }), pos(120), pos(150), pos(180)], [{ ...order, status: 'en_cliente', actualArrivalAt: pos(0).timestamp }]);
    expect(result?.enteredAt).toBe(pos(120).timestamp);
  });
  it('cierra con telemetría nueva sin esperar a otra respuesta de la operación; pausa el reloj sin señal', () => {
    const geofence = deliveryGeofence(order, [], 80)!;
    const delivery = { vehicleId: 'v1', geofence, stoppedAt: pos(0).timestamp, observedAt: pos(90).timestamp,
      staleSeconds: 60, movingSpeedThresholdKmh: 3 } as ActiveDelivery;
    expect(deliveryStillPresent(delivery, pos(90))).toBe(true);
    expect(deliveryStillPresent(delivery, pos(105, { speed: 10 }))).toBe(false);
    expect(deliveryStillPresent(delivery, pos(105, { lng: -70.661 }))).toBe(false);
    const frozen = deliveryClock(delivery, base + 300000);
    expect(frozen.stale).toBe(true);
    expect(deliveryClock(delivery, base + 600000).stoppedSeconds).toBe(frozen.stoppedSeconds);
  });
});
