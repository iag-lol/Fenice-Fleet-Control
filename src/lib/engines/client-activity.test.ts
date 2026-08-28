import { describe, expect, it } from 'vitest';

import { DEFAULT_OPERATIONAL_SETTINGS } from '@/config/operational';
import {
  buildClientSnapshot,
  calculateClientActivityStatus,
  classifyDormancy,
} from '@/lib/engines/client-activity';
import type { Client } from '@/types/core';
import { asClientId } from '@/types/core';

const NOW = new Date('2026-08-27T12:00:00.000Z');
const thresholds = DEFAULT_OPERATIONAL_SETTINGS.clients; // 21 / 60

/** Fecha ISO situada `days` dias antes de NOW. */
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

describe('calculateClientActivityStatus', () => {
  it('clasifica como activo dentro del umbral verde', () => {
    const result = calculateClientActivityStatus({
      lastPurchaseAt: daysAgo(5),
      lastVisitAt: null,
      thresholds,
      now: NOW,
    });

    expect(result.status).toBe('active');
    expect(result.daysSincePurchase).toBe(5);
    expect(result.basis).toBe('purchase');
  });

  it('trata el limite del umbral verde como activo (inclusivo)', () => {
    const result = calculateClientActivityStatus({
      lastPurchaseAt: daysAgo(21),
      lastVisitAt: null,
      thresholds,
      now: NOW,
    });
    expect(result.status).toBe('active');
  });

  it('pasa a observacion un dia despues del umbral verde', () => {
    const result = calculateClientActivityStatus({
      lastPurchaseAt: daysAgo(22),
      lastVisitAt: null,
      thresholds,
      now: NOW,
    });
    expect(result.status).toBe('warning');
  });

  it('trata el limite del umbral amarillo como observacion (inclusivo)', () => {
    const result = calculateClientActivityStatus({
      lastPurchaseAt: daysAgo(60),
      lastVisitAt: null,
      thresholds,
      now: NOW,
    });
    expect(result.status).toBe('warning');
  });

  it('pasa a dormido por encima del umbral amarillo', () => {
    const result = calculateClientActivityStatus({
      lastPurchaseAt: daysAgo(61),
      lastVisitAt: null,
      thresholds,
      now: NOW,
    });
    expect(result.status).toBe('dormant');
  });

  it('considera dormido a un cliente que nunca compro', () => {
    const result = calculateClientActivityStatus({
      lastPurchaseAt: null,
      lastVisitAt: null,
      thresholds,
      now: NOW,
    });

    expect(result.status).toBe('dormant');
    expect(result.basis).toBe('none');
    expect(result.effectiveDays).toBeNull();
  });

  it('ignora la visita cuando la senal de visita esta desactivada', () => {
    const result = calculateClientActivityStatus({
      lastPurchaseAt: daysAgo(90),
      lastVisitAt: daysAgo(2),
      thresholds: { ...thresholds, useVisitAsActivitySignal: false },
      now: NOW,
    });

    expect(result.status).toBe('dormant');
    expect(result.basis).toBe('purchase');
  });

  it('usa la visita reciente como senal de actividad cuando esta activada', () => {
    const result = calculateClientActivityStatus({
      lastPurchaseAt: daysAgo(90),
      lastVisitAt: daysAgo(2),
      thresholds: { ...thresholds, useVisitAsActivitySignal: true },
      now: NOW,
    });

    expect(result.status).toBe('active');
    expect(result.basis).toBe('visit');
    expect(result.effectiveDays).toBe(2);
  });

  it('no usa la visita si es mas antigua que la compra', () => {
    const result = calculateClientActivityStatus({
      lastPurchaseAt: daysAgo(10),
      lastVisitAt: daysAgo(200),
      thresholds: { ...thresholds, useVisitAsActivitySignal: true },
      now: NOW,
    });

    expect(result.basis).toBe('purchase');
    expect(result.effectiveDays).toBe(10);
  });

  it('responde a un cambio de umbral sin tocar el codigo del componente', () => {
    const strict = { ...thresholds, activeMaxDays: 7, warningMaxDays: 14 };
    const result = calculateClientActivityStatus({
      lastPurchaseAt: daysAgo(10),
      lastVisitAt: null,
      thresholds: strict,
      now: NOW,
    });

    expect(result.status).toBe('warning');
  });

  it('descarta fechas invalidas sin lanzar', () => {
    const result = calculateClientActivityStatus({
      lastPurchaseAt: 'no-es-una-fecha',
      lastVisitAt: null,
      thresholds,
      now: NOW,
    });

    expect(result.status).toBe('dormant');
    expect(result.daysSincePurchase).toBeNull();
  });

  it('nunca devuelve dias negativos ante una fecha futura', () => {
    const result = calculateClientActivityStatus({
      lastPurchaseAt: new Date(NOW.getTime() + 86_400_000).toISOString(),
      lastVisitAt: null,
      thresholds,
      now: NOW,
    });

    expect(result.daysSincePurchase).toBe(0);
    expect(result.status).toBe('active');
  });
});

describe('classifyDormancy', () => {
  it('marca en riesgo dentro del tramo amarillo', () => {
    expect(classifyDormancy(45, thresholds)).toBe('en_riesgo');
  });

  it('marca dormido hasta el doble del umbral de observacion', () => {
    expect(classifyDormancy(90, thresholds)).toBe('dormido');
    expect(classifyDormancy(120, thresholds)).toBe('dormido');
  });

  it('marca critico por encima del doble del umbral', () => {
    expect(classifyDormancy(121, thresholds)).toBe('critico');
  });

  it('marca critico a quien nunca compro', () => {
    expect(classifyDormancy(null, thresholds)).toBe('critico');
  });
});

describe('buildClientSnapshot', () => {
  const baseClient: Client = {
    id: asClientId('cli-0001'),
    code: 'F10001',
    legalName: 'Comercial Andina SpA',
    tradeName: 'Minimarket Andina',
    taxId: '76.123.456-7',
    segment: 'estacion_servicio',
    contactName: null,
    phone: null,
    email: null,
    salesRep: null,
    locations: [
      {
        id: 'loc-1',
        clientId: asClientId('cli-0001'),
        label: 'Bodega',
        addressLine: 'Av. Grecia 1200',
        communeCode: '13119',
        communeName: 'Nunoa',
        coordinates: { lat: -33.45, lng: -70.6 },
        coordinateSource: 'external',
        isPrimary: false,
        deliveryRadiusMeters: null,
      },
      {
        id: 'loc-2',
        clientId: asClientId('cli-0001'),
        label: 'Local principal',
        addressLine: 'Av. Irarrazaval 3400',
        communeCode: '13119',
        communeName: 'Nunoa',
        coordinates: { lat: -33.455, lng: -70.59 },
        coordinateSource: 'external',
        isPrimary: true,
        deliveryRadiusMeters: 100,
      },
    ],
    lastPurchaseAt: daysAgo(30),
    lastVisitAt: daysAgo(30),
    totalOrders: 24,
    lifetimeValue: 12_000_000,
    createdAt: daysAgo(800),
    active: true,
  };

  it('selecciona la direccion principal aunque no sea la primera', () => {
    const snapshot = buildClientSnapshot({ client: baseClient, now: NOW });
    expect(snapshot.primaryLocation?.id).toBe('loc-2');
  });

  it('cae a la primera direccion cuando ninguna es principal', () => {
    const snapshot = buildClientSnapshot({
      client: {
        ...baseClient,
        locations: baseClient.locations.map((l) => ({ ...l, isPrimary: false })),
      },
      now: NOW,
    });
    expect(snapshot.primaryLocation?.id).toBe('loc-1');
  });

  it('deriva el estado comercial desde el motor, no desde el componente', () => {
    const snapshot = buildClientSnapshot({ client: baseClient, now: NOW });
    expect(snapshot.activityStatus).toBe('warning');
    expect(snapshot.daysSincePurchase).toBe(30);
  });

  it('detecta que fue visitado hoy a partir de la ultima visita', () => {
    const snapshot = buildClientSnapshot({
      client: { ...baseClient, lastVisitAt: NOW.toISOString() },
      now: NOW,
    });
    expect(snapshot.visitedToday).toBe(true);
  });

  it('tolera un cliente sin direcciones registradas', () => {
    const snapshot = buildClientSnapshot({
      client: { ...baseClient, locations: [] },
      now: NOW,
    });
    expect(snapshot.primaryLocation).toBeNull();
  });
});
