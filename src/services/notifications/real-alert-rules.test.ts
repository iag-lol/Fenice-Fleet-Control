import { describe, expect, it } from 'vitest';
import { DEFAULT_OPERATIONAL_SETTINGS } from '@/config/operational';
import { gpsHealthAlert, hardwareAlert, routeAlerts, clientActivityAlert } from './real-alert-rules';
import type { DeviceStatus, Position, GpsEvent, Route, Client } from '@/types/core';
const now = new Date('2026-10-09T08:00:00Z');
const position = { vehicleId: 'fixture-vehicle', deviceId: 'fixture-device', timestamp: '2026-10-09T07:59:45Z', lat: -33.45, lng: -70.66, speed: 0, speedKnown: true, valid: true } as Position;
describe('reglas reales conservadoras', () => {
  it('un camion parado con heartbeat no genera una alerta de desconexion por su posicion antigua', () => {
    const old = { ...position, timestamp: '2026-10-09T06:00:00Z', ignition: 'off' as const };
    const device = { vehicleId: position.vehicleId, lastCommunicationAt: '2026-10-09T07:51:00Z' } as DeviceStatus;
    expect(gpsHealthAlert(position.vehicleId, 'TEST01', old, 'fixture-device', DEFAULT_OPERATIONAL_SETTINGS, now, device)).toBeNull();
  });
  it('la desconexion real usa la fecha de la ultima comunicacion, sin afirmar una ubicacion nueva', () => {
    const device = { vehicleId: position.vehicleId, lastCommunicationAt: '2026-10-09T07:40:00Z' } as DeviceStatus;
    const alert = gpsHealthAlert(position.vehicleId, 'TEST01', { ...position, timestamp: '2026-10-09T06:00:00Z' }, 'fixture-device', DEFAULT_OPERATIONAL_SETTINGS, now, device);
    expect(alert).toMatchObject({ type: 'gps_offline', timestamp: '2026-10-09T07:51:00.000Z', position: null });
    expect(alert?.title).toContain('sin comunicación reciente');
  });
  it('un heartbeat de otra unidad no suprime la alerta de este equipo', () => {
    const device = { vehicleId: 'other-unit', lastCommunicationAt: '2026-10-09T07:59:00Z' } as DeviceStatus;
    expect(gpsHealthAlert(position.vehicleId, 'TEST01', { ...position, timestamp: '2026-10-09T06:00:00Z' },
      'fixture-device', DEFAULT_OPERATIONAL_SETTINGS, now, device)?.type).toBe('gps_offline');
  });
  it('el contacto apagado no produce una alarma critica durante el plazo de espera configurado', () => {
    const p = { ...position, timestamp: '2026-10-09T06:00:00Z', ignition: 'off' as const, speed: 0 };
    const d = { vehicleId: position.vehicleId, lastCommunicationAt: '2026-10-09T06:30:00Z' } as DeviceStatus;
    expect(gpsHealthAlert(position.vehicleId, 'TEST01', p, 'fixture-device', DEFAULT_OPERATIONAL_SETTINGS, now, d)).toBeNull();
  });
  it('la ausencia de movimiento no se interpreta como GPS desconectado', () => { expect(gpsHealthAlert(position.vehicleId, 'TEST01', position, 'fixture-device', DEFAULT_OPERATIONAL_SETTINGS, now)).toBeNull(); });
  it('un registro antiguo genera falta de posicion reciente con su instante real', () => {
    const stale = { ...position, timestamp: '2026-10-09T07:00:00Z' };
    expect(gpsHealthAlert(stale.vehicleId, 'TEST01', stale, 'fixture-device', DEFAULT_OPERATIONAL_SETTINGS, now)).toMatchObject({ type: 'gps_offline', timestamp: '2026-10-09T07:10:00.000Z', position: null });
  });
  it('no inventa perdida de señal cuando el reloj del equipo es futuro', () => { expect(gpsHealthAlert(position.vehicleId, 'TEST01', { ...position, timestamp: '2026-10-10T08:00:00Z' }, 'fixture-device', DEFAULT_OPERATIONAL_SETTINGS, now)).toBeNull(); });
  it('solo usa eventos expresamente reportados y descarta los viejos', () => {
    const event = { id: 'fixture-event', type: 'sos', vehicleId: position.vehicleId, deviceId: position.deviceId, timestamp: position.timestamp } as GpsEvent;
    expect(hardwareAlert(event, 'TEST01', now)).toMatchObject({ severity: 'critical', type: 'gps_evento_equipo' });
    expect(hardwareAlert({ ...event, timestamp: '2026-10-08T07:00:00Z' }, 'TEST01', now)).toBeNull();
  });
  it('un salto, dos puntos o muestras dudosas no prueban un desvio de ruta', () => {
    const route = { id: 'fixture-route', code: 'fixture', status: 'en_curso', vehicleId: position.vehicleId, plannedPath: [{ lat: -33.5, lng: -70.7 }, { lat: -33.51, lng: -70.71 }], authorizedCommuneCodes: [], stops: [] } as unknown as Route;
    expect(routeAlerts(route, [position], 'TEST01', DEFAULT_OPERATIONAL_SETTINGS, now)).toEqual([]);
    expect(routeAlerts(route, [{ ...position, timestamp: '2026-10-09T07:50:00Z' }, position, { ...position, motionEvidence: 'uncertain' }], 'TEST01', DEFAULT_OPERATIONAL_SETTINGS, now)).toEqual([]);
  });
  it('sin compras o visitas no afirma una transicion comercial que nunca se observo', () => {
    const client = { id: 'fixture', active: true, lastPurchaseAt: null, lastVisitAt: null } as Client;
    expect(clientActivityAlert(client, DEFAULT_OPERATIONAL_SETTINGS, now)).toBeNull();
  });
});
