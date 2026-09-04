import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WINDOW,
  isWithinWindow,
  operatingMinutesPerMonth,
  planTrafficPolling,
  requestsPerMinute,
} from './traffic-quota';

describe('jornada de despacho', () => {
  it('acepta un martes a media manana', () => {
    expect(isWithinWindow(new Date('2026-09-08T10:30:00'))).toBe(true);
  });

  it('rechaza antes de las 08:00 y desde las 19:00', () => {
    expect(isWithinWindow(new Date('2026-09-08T07:59:00'))).toBe(false);
    expect(isWithinWindow(new Date('2026-09-08T08:00:00'))).toBe(true);
    expect(isWithinWindow(new Date('2026-09-08T18:59:00'))).toBe(true);
    // Las 19:00 ya estan fuera: la jornada termina, no empieza.
    expect(isWithinWindow(new Date('2026-09-08T19:00:00'))).toBe(false);
  });

  it('rechaza sabado y domingo aunque sea horario de oficina', () => {
    expect(isWithinWindow(new Date('2026-09-12T10:00:00'))).toBe(false); // sabado
    expect(isWithinWindow(new Date('2026-09-13T10:00:00'))).toBe(false); // domingo
  });

  it('acepta lunes y viernes, los extremos de la semana', () => {
    expect(isWithinWindow(new Date('2026-09-07T09:00:00'))).toBe(true); // lunes
    expect(isWithinWindow(new Date('2026-09-11T09:00:00'))).toBe(true); // viernes
  });
});

describe('minutos utiles del mes', () => {
  it('cuenta solo la jornada, no el mes entero', () => {
    // 11 h x 60 x 23 dias habiles = 15.180 minutos, frente a los 43.200 del
    // mes completo: concentrar la cuota ahi triplica el presupuesto por minuto.
    expect(operatingMinutesPerMonth()).toBe(15_180);
  });

  it('una ventana vacia no consume nada', () => {
    expect(operatingMinutesPerMonth({ startHour: 8, endHour: 8, weekdays: [1] })).toBe(0);
    expect(operatingMinutesPerMonth({ ...DEFAULT_WINDOW, weekdays: [] })).toBe(0);
  });

  it('una operacion de siete dias tiene mas minutos utiles', () => {
    const siete = operatingMinutesPerMonth({ ...DEFAULT_WINDOW, weekdays: [1, 2, 3, 4, 5, 6, 7] });
    expect(siete).toBeGreaterThan(operatingMinutesPerMonth());
  });
});

describe('presupuesto por minuto', () => {
  it('reserva margen en vez de repartir la cuota completa', () => {
    // Agotarla a mitad de mes dejaria la operacion sin trafico justo cuando
    // mas se usa.
    const conMargen = requestsPerMinute(200_000);
    const sinMargen = 200_000 / 15_180;
    expect(conMargen).toBeLessThan(sinMargen);
    expect(conMargen).toBeCloseTo(11.2, 1);
  });

  it('no reparte nada sin cuota', () => {
    expect(requestsPerMinute(0)).toBe(0);
  });
});

describe('plan de consulta', () => {
  it('espacia mas las consultas cuanto mayor es la flota', () => {
    const a = planTrafficPolling(10).intervalSeconds;
    const b = planTrafficPolling(30).intervalSeconds;
    expect(b).toBeGreaterThan(a);
  });

  it('mantiene el consumo dentro de la cuota para una flota tipica', () => {
    for (const flota of [5, 10, 12, 15, 20, 30, 50]) {
      const plan = planTrafficPolling(flota);
      expect(plan.monthlyRequests).toBeLessThanOrEqual(200_000);
      expect(plan.quotaUsage).toBeLessThanOrEqual(1);
    }
  });

  it('redondea el intervalo hacia arriba, nunca hacia abajo', () => {
    // Redondear hacia abajo produciria un exceso silencioso de cuota.
    const plan = planTrafficPolling(12);
    expect(plan.intervalSeconds % 15).toBe(0);
    const exacto = (12 / requestsPerMinute(200_000)) * 60;
    expect(plan.intervalSeconds).toBeGreaterThanOrEqual(exacto);
  });

  it('nunca baja de 15 segundos, aunque sobre cuota', () => {
    // Mas frecuencia no daria mas informacion: el dato de origen no cambia
    // tan rapido.
    expect(planTrafficPolling(1).intervalSeconds).toBe(15);
  });

  it('no planifica nada sin vehiculos', () => {
    expect(planTrafficPolling(0).intervalSeconds).toBe(0);
    expect(planTrafficPolling(0).monthlyRequests).toBe(0);
  });

  it('una cuota mayor permite consultar mas seguido', () => {
    const gratis = planTrafficPolling(20, 200_000).intervalSeconds;
    const pagada = planTrafficPolling(20, 2_000_000).intervalSeconds;
    expect(pagada).toBeLessThan(gratis);
  });
});
