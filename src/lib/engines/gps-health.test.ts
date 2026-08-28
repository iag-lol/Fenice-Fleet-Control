import { describe, expect, it } from 'vitest';

import { DEFAULT_OPERATIONAL_SETTINGS } from '@/config/operational';
import {
  deriveVehicleStatus,
  evaluateConnectionState,
  normalizePosition,
  secondsSince,
} from '@/lib/engines/gps-health';
import { asDeviceId, asVehicleId, type Position } from '@/types/core';

const gps = DEFAULT_OPERATIONAL_SETTINGS.gps; // 60 / 180 / 600
const NOW = new Date('2026-08-27T12:00:00.000Z');

function agoIso(seconds: number): string {
  return new Date(NOW.getTime() - seconds * 1000).toISOString();
}

describe('secondsSince', () => {
  it('mide la antiguedad en segundos', () => {
    expect(secondsSince(agoIso(45), NOW)).toBe(45);
  });

  it('devuelve null ante una fecha ausente o invalida', () => {
    expect(secondsSince(null, NOW)).toBeNull();
    expect(secondsSince('no-es-fecha', NOW)).toBeNull();
  });

  it('no devuelve valores negativos ante relojes desfasados', () => {
    expect(secondsSince(new Date(NOW.getTime() + 5000).toISOString(), NOW)).toBe(0);
  });
});

describe('evaluateConnectionState', () => {
  it('reporta senal activa dentro del umbral', () => {
    expect(evaluateConnectionState(agoIso(20), gps, NOW).state).toBe('online');
  });

  it('escala a senal retrasada', () => {
    expect(evaluateConnectionState(agoIso(90), gps, NOW).state).toBe('stale');
  });

  it('escala a posible perdida de senal', () => {
    expect(evaluateConnectionState(agoIso(300), gps, NOW).state).toBe('lost');
  });

  it('escala a offline', () => {
    expect(evaluateConnectionState(agoIso(1200), gps, NOW).state).toBe('offline');
  });

  it('trata los umbrales como inclusivos por su limite inferior', () => {
    expect(evaluateConnectionState(agoIso(60), gps, NOW).state).toBe('stale');
    expect(evaluateConnectionState(agoIso(180), gps, NOW).state).toBe('lost');
    expect(evaluateConnectionState(agoIso(600), gps, NOW).state).toBe('offline');
  });

  it('reporta desconocido si nunca hubo posicion', () => {
    const result = evaluateConnectionState(null, gps, NOW);
    expect(result.state).toBe('unknown');
    expect(result.secondsSinceLastPosition).toBeNull();
  });

  it('responde a umbrales personalizados', () => {
    const strict = { ...gps, staleSeconds: 15, signalLostSeconds: 30, offlineSeconds: 60 };
    expect(evaluateConnectionState(agoIso(20), strict, NOW).state).toBe('stale');
    expect(evaluateConnectionState(agoIso(45), strict, NOW).state).toBe('lost');
  });
});

describe('deriveVehicleStatus', () => {
  const movingPosition: Position = {
    vehicleId: asVehicleId('veh-001'),
    deviceId: asDeviceId('dev-001'),
    timestamp: agoIso(10),
    lat: -33.45,
    lng: -70.66,
    speed: 42,
    heading: 90,
    ignition: 'on',
    valid: true,
  };

  it('marca en ruta a un vehiculo en movimiento', () => {
    expect(
      deriveVehicleStatus({ position: movingPosition, connection: 'online', gps }),
    ).toBe('en_ruta');
  });

  it('marca detenido a un vehiculo parado CON asignacion', () => {
    expect(
      deriveVehicleStatus({
        position: { ...movingPosition, speed: 0 },
        connection: 'online',
        gps,
        hasActiveAssignment: true,
      }),
    ).toBe('detenido');
  });

  it('marca inactivo a un vehiculo parado SIN asignacion', () => {
    // Distincion deliberada: un camion en base no infla el KPI de detenidos.
    expect(
      deriveVehicleStatus({
        position: { ...movingPosition, speed: 0 },
        connection: 'online',
        gps,
        hasActiveAssignment: false,
      }),
    ).toBe('inactivo');
  });

  it('marca offline cuando la conexion se perdio, aunque tenga posicion', () => {
    expect(
      deriveVehicleStatus({ position: movingPosition, connection: 'offline', gps }),
    ).toBe('offline');
  });

  it('marca offline si no hay posicion alguna', () => {
    expect(deriveVehicleStatus({ position: null, connection: 'online', gps })).toBe('offline');
  });

  it('no considera en ruta a un vehiculo con la ignicion apagada', () => {
    expect(
      deriveVehicleStatus({
        position: { ...movingPosition, ignition: 'off' },
        connection: 'online',
        gps,
        hasActiveAssignment: true,
      }),
    ).toBe('detenido');
  });

  it('el mantenimiento tiene prioridad sobre cualquier otro estado', () => {
    expect(
      deriveVehicleStatus({
        position: movingPosition,
        connection: 'online',
        gps,
        inMaintenance: true,
      }),
    ).toBe('mantenimiento');
  });
});

describe('normalizePosition', () => {
  const base = {
    vehicleId: 'veh-001',
    deviceId: 'dev-001',
    timestamp: '2026-08-27T12:00:00.000Z',
    lat: -33.45,
    lng: -70.66,
  };

  it('normaliza una posicion valida', () => {
    const result = normalizePosition({ ...base, speed: 42.5, heading: 91, ignition: true });

    expect(result).not.toBeNull();
    expect(result?.speed).toBe(42.5);
    expect(result?.heading).toBe(91);
    expect(result?.ignition).toBe('on');
    expect(result?.valid).toBe(true);
  });

  it('descarta coordenadas fuera de rango', () => {
    expect(normalizePosition({ ...base, lat: 120 })).toBeNull();
    expect(normalizePosition({ ...base, lng: -400 })).toBeNull();
  });

  it('descarta el marcador (0,0) de coordenada no resuelta', () => {
    expect(normalizePosition({ ...base, lat: 0, lng: 0 })).toBeNull();
  });

  it('descarta coordenadas no numericas', () => {
    expect(normalizePosition({ ...base, lat: 'abc' })).toBeNull();
  });

  it('descarta una marca de tiempo invalida', () => {
    expect(normalizePosition({ ...base, timestamp: 'ayer' })).toBeNull();
  });

  it('acota la velocidad a un rango plausible', () => {
    expect(normalizePosition({ ...base, speed: -20 })?.speed).toBe(0);
    expect(normalizePosition({ ...base, speed: 9999 })?.speed).toBe(200);
  });

  it('normaliza el rumbo al rango 0-359', () => {
    expect(normalizePosition({ ...base, heading: 370 })?.heading).toBe(10);
    expect(normalizePosition({ ...base, heading: -90 })?.heading).toBe(270);
  });

  it('acota la bateria al rango 0-100', () => {
    expect(normalizePosition({ ...base, batteryLevel: 150 })?.batteryLevel).toBe(100);
    expect(normalizePosition({ ...base, batteryLevel: -5 })?.batteryLevel).toBe(0);
  });

  it('interpreta la ignicion en sus distintas representaciones', () => {
    expect(normalizePosition({ ...base, ignition: false })?.ignition).toBe('off');
    expect(normalizePosition({ ...base, ignition: 'on' })?.ignition).toBe('on');
    expect(normalizePosition({ ...base, ignition: undefined })?.ignition).toBe('unknown');
  });

  it('serializa siempre la marca de tiempo en ISO', () => {
    const result = normalizePosition({ ...base, timestamp: '2026-08-27T09:00:00-03:00' });
    expect(result?.timestamp).toBe('2026-08-27T12:00:00.000Z');
  });

  it('omite campos opcionales ausentes en vez de inventarlos', () => {
    const result = normalizePosition(base);
    expect(result?.odometerKm).toBeUndefined();
    expect(result?.batteryLevel).toBeUndefined();
    expect(result?.address).toBeUndefined();
  });
});
