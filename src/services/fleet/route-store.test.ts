import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/eta/eta-service', () => ({
  planDrivingRoute: vi.fn(),
}));

import { planDrivingRoute } from '@/services/eta/eta-service';
import { ensureRealPlannedPath } from '@/services/fleet/route-store';
import { asClientId, asWorkOrderId, type LatLng, type RouteStop } from '@/types/core';

/**
 * `ensureRealPlannedPath` es lo que hace que una ruta cargada solo con las
 * direcciones de sus paradas (sin trazado precalculado) SIGA mostrando un
 * camino real por calles: se completa sola al leerla, sin que nadie tenga
 * que llamar a /api/rutas/planificar a mano.
 */

function stop(sequence: number, coordinates: LatLng | null): RouteStop {
  return {
    sequence,
    workOrderId: asWorkOrderId(`ot-${sequence}`),
    clientId: asClientId(`cli-${sequence}`),
    clientName: `Cliente ${sequence}`,
    addressLine: `Direccion ${sequence}`,
    communeName: 'Pudahuel',
    coordinates,
    plannedArrivalAt: null,
    actualArrivalAt: null,
    status: 'pendiente',
  };
}

const STOPS: RouteStop[] = [
  stop(1, { lat: -33.45, lng: -70.7 }),
  stop(2, { lat: -33.44, lng: -70.68 }),
  stop(3, { lat: -33.43, lng: -70.66 }),
];

const REAL_PATH: LatLng[] = Array.from({ length: 40 }, (_, i) => ({
  lat: -33.45 + i * 0.0003,
  lng: -70.7 + i * 0.0009,
}));

describe('ensureRealPlannedPath', () => {
  beforeEach(() => {
    vi.mocked(planDrivingRoute).mockReset();
  });

  it('no vuelve a calcular si el trazado guardado ya tiene mas puntos que las paradas', async () => {
    const stored: LatLng[] = Array.from({ length: 10 }, (_, i) => ({ lat: -33.45 + i, lng: -70.7 + i }));
    const persist = vi.fn();

    const result = await ensureRealPlannedPath(stored, STOPS, persist);

    expect(result).toBe(stored);
    expect(persist).not.toHaveBeenCalled();
    expect(planDrivingRoute).not.toHaveBeenCalled();
  });

  it('calcula y guarda un trazado real cuando lo guardado son solo las paradas', async () => {
    vi.mocked(planDrivingRoute).mockResolvedValueOnce({
      path: REAL_PATH,
      distanceKm: 12.3,
      durationMinutes: 25,
      source: 'routing_provider',
    });
    const persist = vi.fn();

    // "Guardado" = las mismas 3 paradas en linea recta: exactamente el caso
    // que reporto el usuario (trazado_planificado con tantos puntos como
    // paradas, sin curva real).
    const stored = STOPS.map((s) => s.coordinates!);
    const result = await ensureRealPlannedPath(stored, STOPS, persist);

    expect(planDrivingRoute).toHaveBeenCalledWith(STOPS.map((s) => s.coordinates));
    expect(result).toEqual(REAL_PATH);
    expect(persist).toHaveBeenCalledWith(REAL_PATH, 12.3);
  });

  it('calcula tambien cuando no hay nada guardado (trazado vacio)', async () => {
    vi.mocked(planDrivingRoute).mockResolvedValueOnce({
      path: REAL_PATH,
      distanceKm: 12.3,
      durationMinutes: 25,
      source: 'routing_provider',
    });
    const persist = vi.fn();

    const result = await ensureRealPlannedPath([], STOPS, persist);

    expect(result).toEqual(REAL_PATH);
    expect(persist).toHaveBeenCalledOnce();
  });

  it('sin proveedor de ruteo real, no guarda una linea recta como si fuera el trazado calculado', async () => {
    const directPath = STOPS.map((s) => s.coordinates!);
    vi.mocked(planDrivingRoute).mockResolvedValueOnce({
      path: directPath,
      distanceKm: 5,
      durationMinutes: 10,
      source: 'direct',
    });
    const persist = vi.fn();

    const result = await ensureRealPlannedPath([], STOPS, persist);

    // Se devuelve igual (para no dejar el mapa sin nada que dibujar), pero
    // NUNCA se persiste: la proxima lectura debe volver a intentarlo, no
    // quedarse para siempre con la version sin calles reales.
    expect(result).toEqual(directPath);
    expect(persist).not.toHaveBeenCalled();
  });

  it('ignora paradas sin coordenadas utilizables al armar los waypoints', async () => {
    vi.mocked(planDrivingRoute).mockResolvedValueOnce({
      path: REAL_PATH,
      distanceKm: 12.3,
      durationMinutes: 25,
      source: 'routing_provider',
    });
    const persist = vi.fn();
    const stopsWithGap = [stop(1, { lat: -33.45, lng: -70.7 }), stop(2, null), stop(3, { lat: -33.43, lng: -70.66 })];

    await ensureRealPlannedPath([], stopsWithGap, persist);

    expect(planDrivingRoute).toHaveBeenCalledWith([
      { lat: -33.45, lng: -70.7 },
      { lat: -33.43, lng: -70.66 },
    ]);
  });

  it('no calcula nada con menos de dos paradas con coordenadas', async () => {
    const persist = vi.fn();
    const result = await ensureRealPlannedPath([], [stop(1, { lat: -33.45, lng: -70.7 })], persist);

    expect(result).toEqual([]);
    expect(persist).not.toHaveBeenCalled();
    expect(planDrivingRoute).not.toHaveBeenCalled();
  });
});
