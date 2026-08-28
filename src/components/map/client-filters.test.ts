import { describe, expect, it } from 'vitest';

import { applyClientFilters } from '@/components/map/client-filters-panel';
import { DEFAULT_CLIENT_FILTERS, type ClientFilters } from '@/stores/map-store';
import type { ClientMapPoint } from '@/types/views';

/**
 * Los filtros del mapa deciden que ve la operacion comercial. Un filtro que
 * oculta clientes de mas es indistinguible de un dato faltante, por eso se
 * verifica cada criterio por separado.
 */

function client(overrides: Partial<ClientMapPoint>): ClientMapPoint {
  return {
    clientId: 'cli-0001',
    code: 'F10001',
    name: 'Minimarket Andina',
    lat: -33.45,
    lng: -70.66,
    communeCode: '13101',
    communeName: 'Santiago Centro',
    addressLine: 'Av. Matta 1200',
    status: 'active',
    daysSincePurchase: 5,
    daysSinceVisit: 5,
    hasPendingOrder: false,
    visitedToday: false,
    lifetimeValue: 5_000_000,
    segment: 'estacion_servicio',
    salesRep: 'Marcela Fuentes',
    ...overrides,
  };
}

const SAMPLE: ClientMapPoint[] = [
  client({ clientId: 'a', name: 'Almacen Cordillera', status: 'active', daysSincePurchase: 3 }),
  client({
    clientId: 'b',
    name: 'Panaderia Maipo',
    code: 'F10002',
    status: 'warning',
    daysSincePurchase: 40,
    daysSinceVisit: 40,
    communeCode: '13119b',
    communeName: 'Maipu',
    hasPendingOrder: true,
  }),
  client({
    clientId: 'c',
    name: 'Restaurante Pacifico',
    code: 'F10003',
    status: 'dormant',
    daysSincePurchase: 300,
    daysSinceVisit: 250,
    communeCode: '13114',
    communeName: 'Las Condes',
    visitedToday: true,
  }),
  client({
    clientId: 'd',
    name: 'Bodega Sin Compras',
    code: 'F10004',
    status: 'dormant',
    daysSincePurchase: null,
    daysSinceVisit: null,
    addressLine: 'Camino Lo Echevers 900',
  }),
];

function filters(overrides: Partial<ClientFilters> = {}): ClientFilters {
  return { ...DEFAULT_CLIENT_FILTERS, ...overrides };
}

describe('applyClientFilters', () => {
  it('sin filtros devuelve la lista completa', () => {
    expect(applyClientFilters(SAMPLE, filters())).toHaveLength(4);
  });

  it('filtra por estado comercial', () => {
    const result = applyClientFilters(SAMPLE, filters({ statuses: ['dormant'] }));
    expect(result.map((c) => c.clientId)).toEqual(['c', 'd']);
  });

  it('combina varios estados', () => {
    const result = applyClientFilters(SAMPLE, filters({ statuses: ['active', 'warning'] }));
    expect(result.map((c) => c.clientId)).toEqual(['a', 'b']);
  });

  it('filtra por comuna', () => {
    const result = applyClientFilters(SAMPLE, filters({ communeCodes: ['13119b'] }));
    expect(result.map((c) => c.clientId)).toEqual(['b']);
  });

  it('acepta varias comunas a la vez', () => {
    const result = applyClientFilters(SAMPLE, filters({ communeCodes: ['13119b', '13114'] }));
    expect(result).toHaveLength(2);
  });

  it('busca por nombre sin distinguir mayusculas', () => {
    expect(applyClientFilters(SAMPLE, filters({ search: 'panaderia' }))).toHaveLength(1);
  });

  it('busca por codigo de cliente', () => {
    expect(applyClientFilters(SAMPLE, filters({ search: 'F10003' }))).toHaveLength(1);
  });

  it('busca por direccion', () => {
    expect(applyClientFilters(SAMPLE, filters({ search: 'Lo Echevers' }))).toHaveLength(1);
  });

  it('busca por comuna', () => {
    expect(applyClientFilters(SAMPLE, filters({ search: 'Las Condes' }))).toHaveLength(1);
  });

  it('filtra por presencia de pedido pendiente', () => {
    expect(applyClientFilters(SAMPLE, filters({ orderState: 'con_pedido' }))).toHaveLength(1);
    expect(applyClientFilters(SAMPLE, filters({ orderState: 'sin_pedido' }))).toHaveLength(3);
  });

  it('filtra por visitas del dia', () => {
    expect(applyClientFilters(SAMPLE, filters({ visitState: 'visitados_hoy' }))).toHaveLength(1);
    expect(applyClientFilters(SAMPLE, filters({ visitState: 'no_visitados' }))).toHaveLength(3);
  });

  it('filtra por antiguedad minima sin compra', () => {
    const result = applyClientFilters(SAMPLE, filters({ minDaysSincePurchase: 30 }));
    // El cliente sin compra registrada supera cualquier minimo exigido.
    expect(result.map((c) => c.clientId)).toEqual(['b', 'c', 'd']);
  });

  it('filtra por antiguedad maxima sin compra', () => {
    const result = applyClientFilters(SAMPLE, filters({ maxDaysSincePurchase: 50 }));
    // El cliente sin compra NO cabe bajo un maximo: su antiguedad es infinita.
    expect(result.map((c) => c.clientId)).toEqual(['a', 'b']);
  });

  it('combina rango minimo y maximo', () => {
    const result = applyClientFilters(
      SAMPLE,
      filters({ minDaysSincePurchase: 20, maxDaysSincePurchase: 100 }),
    );
    expect(result.map((c) => c.clientId)).toEqual(['b']);
  });

  it('filtra por antiguedad maxima sin visita', () => {
    const result = applyClientFilters(SAMPLE, filters({ maxDaysSinceVisit: 60 }));
    expect(result.map((c) => c.clientId)).toEqual(['a', 'b']);
  });

  it('acumula criterios de forma conjuntiva', () => {
    const result = applyClientFilters(
      SAMPLE,
      filters({ statuses: ['dormant'], communeCodes: ['13114'], visitState: 'visitados_hoy' }),
    );
    expect(result.map((c) => c.clientId)).toEqual(['c']);
  });

  it('devuelve vacio cuando ningun cliente cumple', () => {
    const result = applyClientFilters(
      SAMPLE,
      filters({ statuses: ['active'], communeCodes: ['13114'] }),
    );
    expect(result).toHaveLength(0);
  });

  it('ignora espacios sobrantes en la busqueda', () => {
    expect(applyClientFilters(SAMPLE, filters({ search: '   ' }))).toHaveLength(4);
  });
});
