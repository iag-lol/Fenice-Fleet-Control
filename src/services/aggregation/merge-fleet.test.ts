import { describe, expect, it } from 'vitest';

import { mergeFleet } from './fleet-aggregator';
import type { DeviceId, Vehicle, VehicleId } from '@/types/core';

function vehiculo(id: string, overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: id as VehicleId,
    plate: id.toUpperCase(),
    fleetCode: `C-${id}`,
    brand: 'Volvo',
    model: 'FH 460',
    year: 2020,
    type: 'cisterna_rigido',
    capacityLiters: 30_000,
    compartments: 4,
    device: null,
    driverId: null,
    depotName: 'Planta Maipu',
    active: true,
    ...overrides,
  };
}

function conImei(id: string, imei: string, overrides: Partial<Vehicle> = {}): Vehicle {
  return vehiculo(id, {
    device: { id: imei as DeviceId, imei, model: '3DTracking' },
    ...overrides,
  });
}

describe('union del parque ERP + telemetria', () => {
  it('sin ERP conectado, muestra los camiones que reporta el GPS', () => {
    // Es el caso de la puesta en marcha: el GPS real llega antes que la base
    // de Fenice. Sin esto el mapa saldria vacio pese a recibir posiciones.
    const resultado = mergeFleet([], [vehiculo('gps-1'), vehiculo('gps-2')]);
    expect(resultado.map((v) => String(v.id))).toEqual(['gps-1', 'gps-2']);
  });

  it('el ERP manda cuando el vehiculo esta en ambos', () => {
    // Capacidad, planta y compartimentos son datos comerciales que el GPS
    // desconoce: si se pisaran, se planificarian cargas imposibles.
    const erp = vehiculo('v1', { capacityLiters: 39_000, depotName: 'Planta Quilicura' });
    const gps = vehiculo('v1', { capacityLiters: 0, depotName: '' });

    const [unido] = mergeFleet([erp], [gps]);
    expect(unido!.capacityLiters).toBe(39_000);
    expect(unido!.depotName).toBe('Planta Quilicura');
  });

  it('no duplica un vehiculo que el ERP identifica con otro codigo', () => {
    // El ERP lo llama "veh-77" y el GPS "unit-abc", pero es el mismo equipo
    // instalado: el IMEI es lo que de verdad une ambos mundos.
    const erp = conImei('veh-77', '356938035643809');
    const gps = conImei('unit-abc', '356938035643809');

    const resultado = mergeFleet([erp], [gps]);
    expect(resultado).toHaveLength(1);
    expect(String(resultado[0]!.id)).toBe('veh-77');
  });

  it('agrega el camion que reporta pero no figura en el ERP', () => {
    const resultado = mergeFleet([conImei('veh-1', '111')], [conImei('unit-9', '999')]);
    expect(resultado.map((v) => String(v.id))).toEqual(['veh-1', 'unit-9']);
  });

  it('sin telemetria conectada, deja el parque del ERP intacto', () => {
    const erp = [vehiculo('v1'), vehiculo('v2')];
    expect(mergeFleet(erp, [])).toHaveLength(2);
  });

  it('no falla con ambas fuentes vacias', () => {
    expect(mergeFleet([], [])).toEqual([]);
  });
});
