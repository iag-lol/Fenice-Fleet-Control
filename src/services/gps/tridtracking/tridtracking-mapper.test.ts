import { describe, expect, it } from 'vitest';

import {
  isUsableFix,
  mapUnitToDeviceStatus,
  mapUnitToPosition,
  mapUnitToVehicle,
  toIgnition,
  toIsoUtc,
  toKmh,
  toPlate,
  toVehicleType,
} from './tridtracking-mapper';
import type { TridUnit } from './tridtracking-types';

const UMBRALES = { staleSeconds: 60, lostSeconds: 180, offlineSeconds: 600 };

/** Unidad tal como la devuelve `latestpositionslist`. */
function unidad(overrides: Partial<TridUnit> = {}): TridUnit {
  return {
    Uid: 'u-001',
    Name: 'HDYB95',
    Imei: '356938035643809',
    Status: 'Active',
    GroupName: 'C-101',
    UnitType: 'Truck',
    LastReportedTimeUTC: '2026-09-01T14:30:00Z',
    Position: {
      Latitude: -33.4489,
      Longitude: -70.6693,
      Speed: 54,
      SpeedMeasure: 'km/h',
      Heading: 187,
      Ignition: 'On',
      Odometer: 128450.7,
      GPSTimeUtc: '2026-09-01T14:30:00Z',
      ServerTimeUTC: '2026-09-01T14:30:05Z',
      Address: 'Av. Matta 6892, Santiago',
    },
    ...overrides,
  };
}

describe('velocidad', () => {
  it('deja en km/h lo que ya viene en km/h', () => {
    expect(toKmh(54, 'km/h')).toBeCloseTo(54, 3);
    expect(toKmh(54, 'kph')).toBeCloseTo(54, 3);
  });

  it('convierte millas por hora', () => {
    // 62 mph son ~100 km/h: leerlo mal dispararia solo el exceso de velocidad.
    expect(toKmh(62, 'mph')).toBeCloseTo(99.78, 1);
    expect(toKmh(62, 'Miles/Hour')).toBeCloseTo(99.78, 1);
  });

  it('convierte nudos y metros por segundo', () => {
    expect(toKmh(10, 'knots')).toBeCloseTo(18.52, 2);
    expect(toKmh(10, 'm/s')).toBeCloseTo(36, 2);
  });

  it('ante una unidad desconocida asume km/h', () => {
    expect(toKmh(54, 'no se sabe')).toBe(54);
    expect(toKmh(54, null)).toBe(54);
  });

  it('nunca devuelve velocidades imposibles', () => {
    expect(toKmh(null, 'km/h')).toBe(0);
    expect(toKmh(-5, 'km/h')).toBe(0);
    expect(toKmh(Number.NaN, 'km/h')).toBe(0);
  });
});

describe('ignicion', () => {
  it('interpreta el texto libre del proveedor', () => {
    expect(toIgnition('On')).toBe('on');
    expect(toIgnition('OFF')).toBe('off');
    expect(toIgnition('1')).toBe('on');
    expect(toIgnition('0')).toBe('off');
  });

  it('no inventa un estado cuando no consta', () => {
    // Suponer "apagado" haria aparecer detenciones que nadie observo.
    expect(toIgnition('')).toBe('unknown');
    expect(toIgnition(null)).toBe('unknown');
    expect(toIgnition('vaya usted a saber')).toBe('unknown');
  });
});

describe('fechas', () => {
  it('trata como UTC las marcas sin zona horaria', () => {
    // Sin esto, en Chile se leerian con 3 o 4 horas de desfase y el sistema
    // creeria que toda la flota lleva horas sin reportar.
    expect(toIsoUtc('2026-09-01T14:30:00')).toBe('2026-09-01T14:30:00.000Z');
  });

  it('respeta la zona cuando si viene declarada', () => {
    expect(toIsoUtc('2026-09-01T14:30:00Z')).toBe('2026-09-01T14:30:00.000Z');
    expect(toIsoUtc('2026-09-01T10:30:00-04:00')).toBe('2026-09-01T14:30:00.000Z');
  });

  it('devuelve null en vez de una fecha invalida', () => {
    expect(toIsoUtc('')).toBeNull();
    expect(toIsoUtc(null)).toBeNull();
    expect(toIsoUtc('no es una fecha')).toBeNull();
  });
});

describe('coordenadas', () => {
  it('acepta una posicion real de Santiago', () => {
    expect(isUsableFix(-33.4489, -70.6693)).toBe(true);
  });

  it('rechaza el (0,0) del equipo sin fijacion satelital', () => {
    // Aceptarlo pondria camiones chilenos en mitad del Atlantico.
    expect(isUsableFix(0, 0)).toBe(false);
  });

  it('rechaza coordenadas fuera de rango o ausentes', () => {
    expect(isUsableFix(120, -70)).toBe(false);
    expect(isUsableFix(-33, 200)).toBe(false);
    expect(isUsableFix(null, null)).toBe(false);
  });
});

describe('unidad a vehiculo', () => {
  it('traduce los campos que si constan', () => {
    const v = mapUnitToVehicle(unidad())!;
    expect(v.id).toBe('u-001');
    expect(v.plate).toBe('HDYB95');
    expect(v.fleetCode).toBe('C-101');
    expect(v.device?.imei).toBe('356938035643809');
    expect(v.device?.externalId).toBe('u-001');
    expect(v.active).toBe(true);
  });

  it('no inventa capacidad de estanque, que es dato del ERP', () => {
    // Suponer litros llevaria a planificar cargas imposibles.
    const v = mapUnitToVehicle(unidad())!;
    expect(v.capacityLiters).toBe(0);
    expect(v.compartments).toBe(0);
    expect(v.depotName).toBe('');
  });

  it('cae al IMEI cuando la unidad no tiene nombre', () => {
    expect(toPlate(unidad({ Name: '  ' }))).toBe('IMEI 356938035643809');
    expect(toPlate(unidad({ Name: '', Imei: '' }))).toBe('Sin identificar');
  });

  it('descarta una unidad sin identificador', () => {
    expect(mapUnitToVehicle(unidad({ Uid: '' }))).toBeNull();
  });

  it('marca como inactiva la unidad dada de baja', () => {
    expect(mapUnitToVehicle(unidad({ Status: 'Inactive' }))!.active).toBe(false);
  });

  it('deduce el tipo del texto del proveedor', () => {
    expect(toVehicleType('Semi Trailer')).toBe('cisterna_semirremolque');
    expect(toVehicleType('Pickup')).toBe('camioneta_estanque');
    expect(toVehicleType('Truck')).toBe('cisterna_rigido');
  });
});

describe('unidad a posicion', () => {
  it('traduce una posicion completa', () => {
    const p = mapUnitToPosition(unidad())!;
    expect(p.vehicleId).toBe('u-001');
    expect(p.lat).toBeCloseTo(-33.4489, 4);
    expect(p.speed).toBe(54);
    expect(p.heading).toBe(187);
    expect(p.ignition).toBe('on');
    expect(p.valid).toBe(true);
    expect(p.odometerKm).toBeCloseTo(128450.7, 1);
    expect(p.address).toContain('Av. Matta');
  });

  it('normaliza la velocidad segun la unidad declarada', () => {
    const u = unidad();
    u.Position!.Speed = 62;
    u.Position!.SpeedMeasure = 'mph';
    expect(mapUnitToPosition(u)!.speed).toBeCloseTo(99.8, 1);
  });

  it('marca invalida la posicion sin fijacion, sin descartarla', () => {
    // Se conserva para poder decir "reporta pero sin GPS", que no es lo mismo
    // que "no reporta".
    const u = unidad();
    u.Position!.Latitude = 0;
    u.Position!.Longitude = 0;
    const p = mapUnitToPosition(u)!;
    expect(p.valid).toBe(false);
  });

  it('normaliza el rumbo al rango 0-359', () => {
    const u = unidad();
    u.Position!.Heading = 375;
    expect(mapUnitToPosition(u)!.heading).toBe(15);
    u.Position!.Heading = -90;
    expect(mapUnitToPosition(u)!.heading).toBe(270);
  });

  it('descarta la unidad sin posicion o sin fecha utilizable', () => {
    expect(mapUnitToPosition(unidad({ Position: null }))).toBeNull();
    const sinFecha = unidad();
    sinFecha.LastReportedTimeUTC = null;
    sinFecha.Position = { ...sinFecha.Position, GPSTimeUtc: null, ServerTimeUTC: null };
    expect(mapUnitToPosition(sinFecha)).toBeNull();
  });

  it('sobrevive a una respuesta con casi todo vacio', () => {
    // Una unidad recien instalada llega asi, y no puede tumbar la carga.
    const minima: TridUnit = { Uid: 'u-9', LastReportedTimeUTC: '2026-09-01T14:00:00Z', Position: {} };
    const p = mapUnitToPosition(minima)!;
    expect(p.speed).toBe(0);
    expect(p.ignition).toBe('unknown');
    expect(p.valid).toBe(false);
  });
});

describe('estado del equipo', () => {
  const ahora = new Date('2026-09-01T14:30:30Z');

  it('en linea cuando acaba de reportar', () => {
    // 30 s de silencio, por debajo del umbral de 60.
    expect(mapUnitToDeviceStatus(unidad(), ahora, UMBRALES)!.connection).toBe('online');
  });

  it('el umbral se alcanza, no se supera: 60 s exactos ya es intermitente', () => {
    const justo = new Date('2026-09-01T14:31:00Z');
    expect(mapUnitToDeviceStatus(unidad(), justo, UMBRALES)!.connection).toBe('stale');
  });

  it('escala a intermitente, sin señal y offline segun el silencio', () => {
    const en = (min: number) =>
      mapUnitToDeviceStatus(
        unidad({ LastReportedTimeUTC: new Date(ahora.getTime() - min * 60_000).toISOString() }),
        ahora,
        UMBRALES,
      )!.connection;

    expect(en(2)).toBe('stale');
    expect(en(5)).toBe('lost');
    expect(en(30)).toBe('offline');
  });

  it('no afirma nada cuando la unidad nunca reporto', () => {
    const nueva = unidad({ LastReportedTimeUTC: null, Position: {} });
    const estado = mapUnitToDeviceStatus(nueva, ahora, UMBRALES)!;
    expect(estado.connection).toBe('unknown');
    expect(estado.secondsSinceLastPosition).toBeNull();
  });
});
