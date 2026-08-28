import { describe, expect, it } from 'vitest';

import { EstimatedRoutingProvider } from '@/services/eta/eta-service';
import { destinationPoint } from '@/lib/geo';
import type { LatLng } from '@/types/core';

/**
 * El ETA es la cifra que ve el cliente final en /seguimiento. Un valor
 * incoherente (un camion en la puerta con 45 minutos de espera) destruye la
 * confianza en la plataforma, asi que se verifica cada caso limite.
 */

const provider = new EstimatedRoutingProvider();
const NOW = new Date('2026-08-27T12:00:00.000Z');

const ORIGIN: LatLng = { lat: -33.45, lng: -70.7 };
const CORRIDOR: LatLng[] = [
  { lat: -33.45, lng: -70.72 },
  { lat: -33.45, lng: -70.68 },
  { lat: -33.45, lng: -70.64 },
  { lat: -33.45, lng: -70.6 },
];

describe('EstimatedRoutingProvider', () => {
  it('estima un ETA coherente para una entrega cercana', async () => {
    const result = await provider.estimate({
      origin: ORIGIN,
      destination: destinationPoint(ORIGIN, 90, 2_000),
      currentSpeedKmh: 30,
      now: NOW,
    });

    expect(result.minutes).toBeGreaterThan(2);
    expect(result.minutes).toBeLessThan(20);
    expect(result.distanceKm).toBeGreaterThan(2);
    expect(result.source).toBe('estimated');
  });

  it('devuelve "llegando" cuando el vehiculo ya esta en el domicilio', async () => {
    const result = await provider.estimate({
      origin: ORIGIN,
      destination: destinationPoint(ORIGIN, 45, 20),
      currentSpeedKmh: 0,
      now: NOW,
    });

    expect(result.minutes).toBe(1);
  });

  it('NO mide hasta el final de la ruta cuando el vehiculo ya paso el destino', async () => {
    // Caso que producia un ETA absurdo: el vehiculo esta sobre el domicilio
    // pero su proyeccion en el corredor va POR DELANTE de la del destino. La
    // distancia correcta es la que falta hasta la entrega (casi cero), no la
    // que resta del corredor completo.
    const destination = { lat: -33.45, lng: -70.6605 };
    const origin = { lat: -33.4501, lng: -70.66 };

    const result = await provider.estimate({
      origin,
      destination,
      path: CORRIDOR,
      currentSpeedKmh: 0,
      now: NOW,
    });

    // El corredor continua ~6 km mas alla; medir hasta su final daria 6 km.
    expect(result.distanceKm).toBeLessThan(0.5);
    expect(result.minutes).toBeLessThanOrEqual(3);
    expect(result.basis).toContain('directa');
  });

  it('usa el corredor planificado cuando el avance es coherente', async () => {
    const result = await provider.estimate({
      origin: { lat: -33.45, lng: -70.7 },
      destination: { lat: -33.45, lng: -70.66 },
      path: CORRIDOR,
      currentSpeedKmh: 40,
      now: NOW,
    });

    expect(result.basis).toContain('corredor');
    expect(result.distanceKm).toBeGreaterThan(3);
    expect(result.distanceKm).toBeLessThan(5);
  });

  it('descarta el corredor si su recorrido es desproporcionado', async () => {
    // Corredor que da un rodeo enorme para llegar a un destino contiguo.
    const detour: LatLng[] = [
      { lat: -33.45, lng: -70.7 },
      { lat: -33.2, lng: -70.7 },
      { lat: -33.2, lng: -70.69 },
      { lat: -33.45, lng: -70.69 },
    ];

    const result = await provider.estimate({
      origin: { lat: -33.45, lng: -70.7 },
      destination: { lat: -33.45, lng: -70.69 },
      path: detour,
      currentSpeedKmh: 30,
      now: NOW,
    });

    expect(result.basis).toContain('directa');
    expect(result.distanceKm).toBeLessThan(3);
  });

  it('suma tiempo de servicio por cada entrega intermedia pendiente', async () => {
    const base = await provider.estimate({
      origin: ORIGIN,
      destination: destinationPoint(ORIGIN, 90, 4_000),
      currentSpeedKmh: 30,
      now: NOW,
    });

    const withStops = await provider.estimate({
      origin: ORIGIN,
      destination: destinationPoint(ORIGIN, 90, 4_000),
      currentSpeedKmh: 30,
      remainingStops: 3,
      now: NOW,
    });

    expect(withStops.minutes!).toBeGreaterThan(base.minutes!);
    // Tres paradas intermedias suman aproximadamente 27 minutos de servicio.
    expect(withStops.minutes! - base.minutes!).toBeGreaterThanOrEqual(25);
    expect(withStops.basis).toContain('entrega');
  });

  it('entrega una hora de llegada consistente con los minutos estimados', async () => {
    const result = await provider.estimate({
      origin: ORIGIN,
      destination: destinationPoint(ORIGIN, 90, 5_000),
      currentSpeedKmh: 35,
      now: NOW,
    });

    const arrival = new Date(result.arrivalAt!).getTime();
    expect(arrival - NOW.getTime()).toBe(result.minutes! * 60_000);
  });

  it('no depende de la velocidad instantanea para dar un ETA util', async () => {
    // Un camion detenido en un semaforo no implica un ETA infinito.
    const result = await provider.estimate({
      origin: ORIGIN,
      destination: destinationPoint(ORIGIN, 90, 6_000),
      currentSpeedKmh: 0,
      now: NOW,
    });

    expect(result.minutes).not.toBeNull();
    expect(result.minutes!).toBeLessThan(60);
  });
});
