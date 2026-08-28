import { describe, expect, it } from 'vitest';

import { DEFAULT_OPERATIONAL_SETTINGS } from '@/config/operational';
import { resolveVehicleActivity } from '@/lib/engines/vehicle-activity';
import { destinationPoint } from '@/lib/geo';
import {
  asAlertId,
  asDeviceId,
  asGeofenceId,
  asVehicleId,
  DEFAULT_GEOFENCE_RULES,
  type Alert,
  type Geofence,
  type Position,
} from '@/types/core';

/**
 * El color del camion en el mapa es lo primero que mira el operador. Si un
 * vehiculo con una alerta critica se pinta como "entregando", el problema
 * pasa desapercibido; si uno que descarga se pinta como "detenido", se
 * investiga una incidencia que no existe.
 */

const settings = DEFAULT_OPERATIONAL_SETTINGS;
const CENTER = { lat: -33.4489, lng: -70.6693 };

const clientGeofence: Geofence = {
  id: asGeofenceId('gf-cli'),
  name: 'Estacion de Servicio Andina - entrega',
  description: null,
  kind: 'cliente',
  geometry: { shape: 'circle', center: CENTER, radiusMeters: 80 },
  referenceId: null,
  clientId: null,
  routeId: null,
  vehicleId: null,
  communeCode: null,
  minDwellSeconds: 60,
  rules: DEFAULT_GEOFENCE_RULES,
  active: true,
  color: '#0d90ae',
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: null,
  origin: 'sistema',
};

const loadingGeofence: Geofence = {
  ...clientGeofence,
  id: asGeofenceId('gf-carga'),
  name: 'Terminal Quilicura',
  kind: 'carga',
};

function position(overrides: Partial<Position> = {}): Position {
  return {
    vehicleId: asVehicleId('veh-001'),
    deviceId: asDeviceId('dev-001'),
    timestamp: '2026-08-27T12:00:00.000Z',
    lat: CENTER.lat,
    lng: CENTER.lng,
    speed: 0,
    heading: 90,
    ignition: 'on',
    valid: true,
    ...overrides,
  };
}

function alert(severity: Alert['severity']): Alert {
  return {
    id: asAlertId('alert-1'),
    type: 'gps_offline',
    category: 'gps',
    severity,
    title: 'Vehiculo sin senal GPS',
    description: 'Sin reportar hace mas de 10 minutos.',
    timestamp: '2026-08-27T12:00:00.000Z',
    vehicleId: asVehicleId('veh-001'),
    vehiclePlate: 'GVFV78',
    clientId: null,
    clientName: null,
    workOrderId: null,
    workOrderNumber: null,
    position: null,
    state: 'nueva',
    acknowledgedAt: null,
    resolvedAt: null,
    metadata: null,
  };
}

const base = {
  geofences: [] as Geofence[],
  deviationMeters: null as number | null,
  alerts: [] as Alert[],
  settings,
};

describe('resolveVehicleActivity', () => {
  it('marca en movimiento un vehiculo circulando con normalidad', () => {
    const result = resolveVehicleActivity({
      ...base,
      operationalStatus: 'en_ruta',
      position: position({ speed: 45 }),
    });

    expect(result.status).toBe('moving');
  });

  it('marca sin comunicacion cuando el equipo no reporta', () => {
    const result = resolveVehicleActivity({
      ...base,
      operationalStatus: 'offline',
      position: position({ speed: 40 }),
    });

    expect(result.status).toBe('offline');
  });

  it('marca sin comunicacion cuando no hay posicion alguna', () => {
    const result = resolveVehicleActivity({
      ...base,
      operationalStatus: 'detenido',
      position: null,
    });

    expect(result.status).toBe('offline');
  });

  it('marca entregando cuando esta detenido dentro de la geocerca del cliente', () => {
    const result = resolveVehicleActivity({
      ...base,
      operationalStatus: 'detenido',
      position: position({ speed: 0 }),
      geofences: [clientGeofence],
    });

    expect(result.status).toBe('delivering');
    expect(result.insideGeofence?.id).toBe(clientGeofence.id);
    expect(result.reason).toContain('Descargando');
  });

  it('distingue la carga en terminal de la descarga en cliente', () => {
    const result = resolveVehicleActivity({
      ...base,
      operationalStatus: 'detenido',
      position: position({ speed: 0 }),
      geofences: [loadingGeofence],
    });

    expect(result.status).toBe('delivering');
    expect(result.reason).toContain('Cargando');
  });

  it('NO marca entregando si atraviesa la geocerca en movimiento', () => {
    // Pasar por delante del cliente sin detenerse no es una entrega.
    const result = resolveVehicleActivity({
      ...base,
      operationalStatus: 'en_ruta',
      position: position({ speed: 38 }),
      geofences: [clientGeofence],
    });

    expect(result.status).toBe('moving');
  });

  it('marca detenido fuera de cualquier geocerca', () => {
    const result = resolveVehicleActivity({
      ...base,
      operationalStatus: 'detenido',
      position: position({ speed: 0, lat: -33.5, lng: -70.8 }),
      geofences: [clientGeofence],
    });

    expect(result.status).toBe('stopped');
    expect(result.insideGeofence).toBeNull();
  });

  it('senala la detencion prolongada en el motivo', () => {
    const result = resolveVehicleActivity({
      ...base,
      operationalStatus: 'detenido',
      position: position({ speed: 0, lat: -33.5, lng: -70.8 }),
      stoppedSeconds: settings.route.prolongedStopSeconds + 60,
    });

    expect(result.status).toBe('stopped');
    expect(result.reason).toContain('minutos');
  });

  it('marca fuera de ruta al superar la tolerancia del corredor', () => {
    const result = resolveVehicleActivity({
      ...base,
      operationalStatus: 'en_ruta',
      position: position({ speed: 42 }),
      deviationMeters: settings.route.deviationDistanceMeters + 250,
    });

    expect(result.status).toBe('deviated');
    expect(result.reason).toContain('corredor');
  });

  it('NO marca fuera de ruta dentro de la tolerancia', () => {
    const result = resolveVehicleActivity({
      ...base,
      operationalStatus: 'en_ruta',
      position: position({ speed: 42 }),
      deviationMeters: settings.route.deviationDistanceMeters - 50,
    });

    expect(result.status).toBe('moving');
  });

  it('la alerta critica prevalece sobre la entrega en curso', () => {
    // Un camion con problema critico no puede verse como operacion normal
    // solo porque este dentro de la geocerca de un cliente.
    const result = resolveVehicleActivity({
      ...base,
      operationalStatus: 'detenido',
      position: position({ speed: 0 }),
      geofences: [clientGeofence],
      alerts: [alert('critical')],
    });

    expect(result.status).toBe('warning');
    expect(result.insideGeofence?.id).toBe(clientGeofence.id);
  });

  it('la alerta critica prevalece sobre el desvio', () => {
    const result = resolveVehicleActivity({
      ...base,
      operationalStatus: 'en_ruta',
      position: position({ speed: 40 }),
      deviationMeters: 900,
      alerts: [alert('critical')],
    });

    expect(result.status).toBe('warning');
  });

  it('una advertencia no critica no cambia el estado', () => {
    const result = resolveVehicleActivity({
      ...base,
      operationalStatus: 'en_ruta',
      position: position({ speed: 40 }),
      alerts: [alert('warning')],
    });

    expect(result.status).toBe('moving');
  });

  it('una alerta critica ya resuelta no cuenta', () => {
    const result = resolveVehicleActivity({
      ...base,
      operationalStatus: 'en_ruta',
      position: position({ speed: 40 }),
      alerts: [{ ...alert('critical'), state: 'resuelta' }],
    });

    expect(result.status).toBe('moving');
  });

  it('ignora las geocercas desactivadas', () => {
    const result = resolveVehicleActivity({
      ...base,
      operationalStatus: 'detenido',
      position: position({ speed: 0 }),
      geofences: [{ ...clientGeofence, active: false }],
    });

    expect(result.status).toBe('stopped');
    expect(result.insideGeofence).toBeNull();
  });

  it('siempre entrega un motivo legible', () => {
    for (const input of [
      { operationalStatus: 'en_ruta' as const, position: position({ speed: 50 }) },
      { operationalStatus: 'offline' as const, position: null },
      { operationalStatus: 'detenido' as const, position: position({ speed: 0 }) },
    ]) {
      const result = resolveVehicleActivity({ ...base, ...input });
      expect(result.reason.length).toBeGreaterThan(5);
    }
  });

  it('detecta la geocerca por geometria, no por cercania aproximada', () => {
    // Justo fuera del radio de 80 m: no esta dentro.
    const outside = destinationPoint(CENTER, 45, 140);
    const result = resolveVehicleActivity({
      ...base,
      operationalStatus: 'detenido',
      position: position({ speed: 0, lat: outside.lat, lng: outside.lng }),
      geofences: [clientGeofence],
    });

    expect(result.status).toBe('stopped');
    expect(result.insideGeofence).toBeNull();
  });
});
