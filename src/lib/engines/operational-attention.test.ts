import { describe, expect, it } from 'vitest';

import {
  buildAttentionList,
  countLateRoutes,
  dayCompletionRatio,
  dispatchStages,
} from './operational-attention';
import type { AlertsKpis, ClientsKpis, FleetKpis, OrdersKpis, RouteSummary } from '@/types/views';

const AHORA = new Date('2026-08-28T15:00:00.000Z');

const v = (value: number) => ({ value, trend: null });

const FLOTA: FleetKpis = {
  total: v(12), enRuta: v(5), detenidos: v(4), offline: v(0), conAlertas: v(1),
};
const PEDIDOS: OrdersKpis = {
  despachosHoy: v(40), pendientes: v(0), enRuta: v(10), proximasEntregas: v(6),
  visitados: v(12), finalizados: v(8), conIncidencia: v(0),
};
const CLIENTES: ClientsKpis = {
  total: v(500), activos: v(300), enObservacion: v(100), dormidos: v(0), visitadosHoy: v(15),
};
const ALERTAS: AlertsKpis = { criticas: v(0), advertencias: v(0), informativas: v(20) };

function ruta(overrides: Partial<RouteSummary> = {}): RouteSummary {
  return {
    routeId: 'r1', code: 'R-001', name: 'Ruta', vehicleId: 'v1', vehiclePlate: 'AA11',
    driverName: 'Conductor', status: 'en_curso', totalStops: 5, completedStops: 2,
    nextStopName: 'Cliente', nextStopEta: null, plannedDistanceKm: 30, progressRatio: 0.4,
    ...overrides,
  };
}

const base = { fleet: FLOTA, orders: PEDIDOS, clients: CLIENTES, alerts: ALERTAS, activeRoutes: [], now: AHORA };

describe('que requiere atencion', () => {
  it('no muestra nada cuando la operacion esta en orden', () => {
    // Un panel que enumera ceros entrena al operador a ignorarlo.
    expect(buildAttentionList(base)).toEqual([]);
  });

  it('ordena por gravedad antes que por cantidad', () => {
    const lista = buildAttentionList({
      ...base,
      fleet: { ...FLOTA, offline: v(1) },
      clients: { ...CLIENTES, dormidos: v(150) },
      alerts: { ...ALERTAS, advertencias: v(9) },
    });

    // 1 vehiculo sin señal pesa mas que 150 clientes dormidos.
    expect(lista.map((i) => i.id)).toEqual([
      'vehiculos-offline',
      'alertas-advertencia',
      'clientes-dormidos',
    ]);
  });

  it('dentro de la misma gravedad, ordena por cantidad', () => {
    const lista = buildAttentionList({
      ...base,
      orders: { ...PEDIDOS, conIncidencia: v(2), pendientes: v(11) },
    });

    expect(lista.map((i) => i.id)).toEqual(['ot-pendientes', 'ot-incidencia']);
  });

  it('cada elemento dice donde se resuelve', () => {
    const lista = buildAttentionList({ ...base, alerts: { ...ALERTAS, criticas: v(3) } });

    expect(lista[0]?.href).toBe('/alertas?severidad=critical');
    expect(lista[0]?.actionLabel).toBeTruthy();
    expect(lista[0]?.detail).toBeTruthy();
  });
});

describe('rutas atrasadas', () => {
  it('da holgura antes de declarar un atraso', () => {
    // Cinco minutos pasada la ETA todavia no es un atraso accionable.
    const apenas = ruta({ nextStopEta: '2026-08-28T14:55:00.000Z' });
    expect(countLateRoutes([apenas], AHORA)).toBe(0);

    const real = ruta({ nextStopEta: '2026-08-28T14:30:00.000Z' });
    expect(countLateRoutes([real], AHORA)).toBe(1);
  });

  it('ignora rutas que no estan en curso', () => {
    const completada = ruta({ status: 'completada', nextStopEta: '2026-08-28T10:00:00.000Z' });
    expect(countLateRoutes([completada], AHORA)).toBe(0);
  });

  it('ignora rutas sin hora estimada en vez de suponer atraso', () => {
    expect(countLateRoutes([ruta({ nextStopEta: null })], AHORA)).toBe(0);
    expect(countLateRoutes([ruta({ nextStopEta: 'no es una fecha' })], AHORA)).toBe(0);
  });
});

/**
 * Reparto real de una jornada de 49 despachos, tomado del sistema:
 * 5 pendientes, 10 en ruta, 2 proxima + 9 en cliente, 15 visita_detectada,
 * 8 completada. `visitados` y `finalizados` se solapan a proposito.
 */
const JORNADA: OrdersKpis = {
  despachosHoy: v(49), pendientes: v(5), enRuta: v(10), proximasEntregas: v(11),
  visitados: v(23), finalizados: v(8), conIncidencia: v(0),
};

describe('tramos del despacho', () => {
  it('los tramos suman exactamente el total de despachos', () => {
    // Si no sumaran, la barra representaria una operacion que no existe.
    const suma = dispatchStages(JORNADA).reduce((acc, t) => acc + t.value, 0);
    expect(suma).toBe(JORNADA.despachosHoy.value);
  });

  it('no cuenta dos veces las finalizadas, que ya estan dentro de visitados', () => {
    const tramos = dispatchStages(JORNADA);
    expect(tramos.find((t) => t.id === 'finalizados')?.value).toBe(8);
    // 23 visitados - 8 finalizados = 15 aun sin cerrar.
    expect(tramos.find((t) => t.id === 'visitados')?.value).toBe(15);
  });

  it('incluye las proximas entregas, que estan en el domicilio', () => {
    expect(dispatchStages(JORNADA).find((t) => t.id === 'proximas')?.value).toBe(11);
  });

  it('nunca produce un tramo negativo aunque los datos lleguen incoherentes', () => {
    const raro = { ...JORNADA, visitados: v(2), finalizados: v(9) };
    expect(dispatchStages(raro).every((t) => t.value >= 0)).toBe(true);
  });
});

describe('cumplimiento del dia', () => {
  it('no infla el porcentaje sumando finalizados dentro de visitados', () => {
    // 23 visitados (que ya incluyen las 8 finalizadas) sobre 49 = 47 %.
    // Sumar los 8 aparte daria 63 %, y el operador creeria ir mucho mejor.
    expect(dayCompletionRatio(JORNADA)).toBeCloseTo(23 / 49, 3);
  });

  it('cuenta como resuelto lo entregado y lo cerrado con incidencia', () => {
    // 12 visitados + 0 incidencias sobre 40 = 30 %.
    expect(dayCompletionRatio(PEDIDOS)).toBeCloseTo(0.3, 3);
  });

  it('devuelve null sin despachos, en vez de un 0 % o un 100 % que mienten', () => {
    expect(dayCompletionRatio({ ...PEDIDOS, despachosHoy: v(0) })).toBeNull();
  });

  it('nunca supera el 100 % aunque los datos lleguen incoherentes', () => {
    const solapado = { ...PEDIDOS, despachosHoy: v(10), visitados: v(9), conIncidencia: v(8) };
    expect(dayCompletionRatio(solapado)).toBe(1);
  });
});
