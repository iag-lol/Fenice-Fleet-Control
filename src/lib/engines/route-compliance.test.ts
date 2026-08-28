import { describe, expect, it } from 'vitest';

import { DEFAULT_OPERATIONAL_SETTINGS } from '@/config/operational';
import { COMMUNES } from '@/data/communes';
import {
  detectStops,
  evaluateCommuneCompliance,
  evaluateRouteDeviation,
  evaluateRouteProgress,
  resolveCommune,
} from '@/lib/engines/route-compliance';
import { destinationPoint } from '@/lib/geo';
import {
  asDeviceId,
  asRouteId,
  asVehicleId,
  asWorkOrderId,
  asClientId,
  type LatLng,
  type Position,
  type Route,
  type RouteStop,
  type WorkOrderStatus,
} from '@/types/core';

const routeSettings = DEFAULT_OPERATIONAL_SETTINGS.route; // 300 m / 120 s

/** Corredor recto de oeste a este a la altura del centro de Santiago. */
const PLANNED_PATH: LatLng[] = [
  { lat: -33.45, lng: -70.7 },
  { lat: -33.45, lng: -70.68 },
  { lat: -33.45, lng: -70.66 },
  { lat: -33.45, lng: -70.64 },
];

function position(point: LatLng, isoTime: string, speed = 40): Position {
  return {
    vehicleId: asVehicleId('veh-001'),
    deviceId: asDeviceId('dev-001'),
    timestamp: isoTime,
    lat: point.lat,
    lng: point.lng,
    speed,
    heading: 90,
    ignition: 'on',
    valid: true,
  };
}

describe('evaluateRouteDeviation', () => {
  it('no reporta desvio cuando circula sobre el corredor', () => {
    const result = evaluateRouteDeviation({
      positions: [
        position({ lat: -33.45, lng: -70.69 }, '2026-08-27T10:00:00.000Z'),
        position({ lat: -33.45, lng: -70.67 }, '2026-08-27T10:05:00.000Z'),
      ],
      plannedPath: PLANNED_PATH,
      settings: routeSettings,
    });

    expect(result.outsideCorridor).toBe(false);
    expect(result.deviationConfirmed).toBe(false);
    expect(result.distanceMeters).toBeLessThan(50);
  });

  it('no confirma desvio por una sola muestra fuera del corredor', () => {
    // Un unico punto alejado es dispersion GPS o una maniobra, no un desvio.
    const result = evaluateRouteDeviation({
      positions: [
        position({ lat: -33.45, lng: -70.68 }, '2026-08-27T10:00:00.000Z'),
        position(destinationPoint({ lat: -33.45, lng: -70.67 }, 0, 600), '2026-08-27T10:00:30.000Z'),
      ],
      plannedPath: PLANNED_PATH,
      settings: routeSettings,
    });

    expect(result.outsideCorridor).toBe(true);
    // Una sola muestra fuera no acredita duracion alguna: el conteo parte en la
    // primera muestra consecutiva fuera, no en la ultima muestra dentro.
    expect(result.continuousSecondsOutside).toBe(0);
    expect(result.deviationConfirmed).toBe(false);
  });

  it('confirma desvio tras superar distancia Y tiempo', () => {
    const away = destinationPoint({ lat: -33.45, lng: -70.67 }, 0, 700);

    const result = evaluateRouteDeviation({
      positions: [
        position({ lat: -33.45, lng: -70.68 }, '2026-08-27T10:00:00.000Z'),
        position(away, '2026-08-27T10:01:00.000Z'),
        position(away, '2026-08-27T10:02:00.000Z'),
        position(away, '2026-08-27T10:03:30.000Z'),
      ],
      plannedPath: PLANNED_PATH,
      settings: routeSettings,
    });

    expect(result.deviationConfirmed).toBe(true);
    expect(result.continuousSecondsOutside).toBe(150);
    expect(result.deviationStartedAt).toBe('2026-08-27T10:01:00.000Z');
    expect(result.maxDeviationMeters).toBeGreaterThan(600);
  });

  it('reinicia el conteo al volver al corredor', () => {
    const away = destinationPoint({ lat: -33.45, lng: -70.67 }, 0, 700);

    const result = evaluateRouteDeviation({
      positions: [
        position(away, '2026-08-27T10:00:00.000Z'),
        position({ lat: -33.45, lng: -70.67 }, '2026-08-27T10:02:00.000Z'),
        position(away, '2026-08-27T10:02:30.000Z'),
      ],
      plannedPath: PLANNED_PATH,
      settings: routeSettings,
    });

    // Solo cuenta desde la ultima salida, no desde la primera.
    expect(result.continuousSecondsOutside).toBe(0);
    expect(result.deviationConfirmed).toBe(false);
  });

  it('respeta una tolerancia mas estricta', () => {
    const away = destinationPoint({ lat: -33.45, lng: -70.67 }, 0, 150);

    const result = evaluateRouteDeviation({
      positions: [
        position(away, '2026-08-27T10:00:00.000Z'),
        position(away, '2026-08-27T10:01:00.000Z'),
      ],
      plannedPath: PLANNED_PATH,
      settings: { ...routeSettings, deviationDistanceMeters: 100, deviationTimeSeconds: 30 },
    });

    expect(result.deviationConfirmed).toBe(true);
  });

  it('devuelve un resultado neutro sin corredor definido', () => {
    const result = evaluateRouteDeviation({
      positions: [position({ lat: -33.45, lng: -70.67 }, '2026-08-27T10:00:00.000Z')],
      plannedPath: [],
      settings: routeSettings,
    });

    expect(result.distanceMeters).toBeNull();
    expect(result.deviationConfirmed).toBe(false);
  });
});

describe('evaluateRouteProgress', () => {
  function buildRoute(statuses: WorkOrderStatus[]): Route {
    const stops: RouteStop[] = statuses.map((status, index) => ({
      sequence: index + 1,
      workOrderId: asWorkOrderId(`wo-${index}`),
      clientId: asClientId(`cli-${index}`),
      clientName: `Cliente ${index + 1}`,
      addressLine: 'Direccion',
      communeName: 'Santiago Centro',
      coordinates: { lat: -33.45, lng: -70.7 + index * 0.02 },
      plannedArrivalAt: null,
      actualArrivalAt: null,
      status,
    }));

    return {
      id: asRouteId('rt-001'),
      code: 'R-001',
      name: 'Ruta de prueba',
      date: '2026-08-27T00:00:00.000Z',
      vehicleId: asVehicleId('veh-001'),
      driverId: null,
      status: 'en_curso',
      authorizedCommuneCodes: [],
      stops,
      plannedPath: PLANNED_PATH,
      executedPath: [],
      plannedDistanceKm: 5,
      startedAt: null,
      completedAt: null,
    };
  }

  it('cuenta como completadas las paradas visitadas', () => {
    const route = buildRoute(['visita_detectada', 'completada', 'proxima', 'en_ruta', 'en_ruta']);
    const progress = evaluateRouteProgress(route, null);

    expect(progress.totalStops).toBe(5);
    expect(progress.completedStops).toBe(2);
    expect(progress.completionRatio).toBeCloseTo(0.4);
  });

  it('identifica la parada en curso como proxima', () => {
    const route = buildRoute(['completada', 'en_cliente', 'en_ruta']);
    const progress = evaluateRouteProgress(route, null);

    expect(progress.nextStop?.sequence).toBe(2);
  });

  it('cae a la primera parada abierta si ninguna esta en curso', () => {
    const route = buildRoute(['completada', 'asignada', 'asignada']);
    const progress = evaluateRouteProgress(route, null);

    expect(progress.nextStop?.sequence).toBe(2);
  });

  it('marca la ruta completa cuando todas las paradas estan cerradas', () => {
    const route = buildRoute(['completada', 'visita_detectada', 'incidencia']);
    const progress = evaluateRouteProgress(route, null);

    expect(progress.complete).toBe(true);
    expect(progress.incidentStops).toBe(1);
    // Una incidencia cierra la parada pero NO cuenta como entrega exitosa.
    expect(progress.completedStops).toBe(2);
  });

  it('calcula el avance geometrico sobre el corredor', () => {
    const route = buildRoute(['asignada', 'asignada']);
    const progress = evaluateRouteProgress(route, { lat: -33.45, lng: -70.67 });

    expect(progress.pathRatio).toBeGreaterThan(0.4);
    expect(progress.pathRatio).toBeLessThan(0.6);
    expect(progress.distanceAlongKm).toBeGreaterThan(0);
  });

  it('omite el avance geometrico sin posicion valida', () => {
    const route = buildRoute(['asignada']);
    const progress = evaluateRouteProgress(route, { lat: 0, lng: 0 });

    expect(progress.pathRatio).toBeNull();
  });
});

describe('detectStops', () => {
  it('agrupa muestras consecutivas por debajo del umbral', () => {
    const stops = detectStops({
      positions: [
        position({ lat: -33.45, lng: -70.7 }, '2026-08-27T10:00:00.000Z', 40),
        position({ lat: -33.45, lng: -70.69 }, '2026-08-27T10:01:00.000Z', 0),
        position({ lat: -33.45, lng: -70.69 }, '2026-08-27T10:05:00.000Z', 1),
        position({ lat: -33.45, lng: -70.68 }, '2026-08-27T10:06:00.000Z', 35),
      ],
      movingSpeedThresholdKmh: 3,
      prolongedStopSeconds: 900,
    });

    expect(stops).toHaveLength(1);
    expect(stops[0]?.durationSeconds).toBe(300);
    expect(stops[0]?.prolonged).toBe(false);
  });

  it('marca como prolongada la detencion que supera el umbral', () => {
    const stops = detectStops({
      positions: [
        position({ lat: -33.45, lng: -70.7 }, '2026-08-27T10:00:00.000Z', 0),
        position({ lat: -33.45, lng: -70.7 }, '2026-08-27T10:20:00.000Z', 0),
      ],
      movingSpeedThresholdKmh: 3,
      prolongedStopSeconds: 900,
    });

    expect(stops[0]?.prolonged).toBe(true);
  });

  it('cierra la detencion abierta al final del trayecto', () => {
    const stops = detectStops({
      positions: [
        position({ lat: -33.45, lng: -70.7 }, '2026-08-27T10:00:00.000Z', 30),
        position({ lat: -33.45, lng: -70.69 }, '2026-08-27T10:02:00.000Z', 0),
        position({ lat: -33.45, lng: -70.69 }, '2026-08-27T10:08:00.000Z', 0),
      ],
      movingSpeedThresholdKmh: 3,
      prolongedStopSeconds: 900,
    });

    expect(stops).toHaveLength(1);
    expect(stops[0]?.endedAt).toBeNull();
    expect(stops[0]?.durationSeconds).toBe(360);
  });

  it('no reporta detenciones si nunca baja del umbral', () => {
    const stops = detectStops({
      positions: [
        position({ lat: -33.45, lng: -70.7 }, '2026-08-27T10:00:00.000Z', 40),
        position({ lat: -33.45, lng: -70.68 }, '2026-08-27T10:02:00.000Z', 38),
      ],
      movingSpeedThresholdKmh: 3,
      prolongedStopSeconds: 900,
    });

    expect(stops).toHaveLength(0);
  });
});

describe('resolveCommune', () => {
  it('resuelve exactamente una comuna por coordenada', () => {
    const matches = COMMUNES.filter((c) =>
      resolveCommune({ lat: -33.4448, lng: -70.6505 }, [c]) !== null,
    );
    // La teselacion garantiza cobertura sin solapamiento.
    expect(matches).toHaveLength(1);
  });

  it('devuelve null fuera del area operacional', () => {
    expect(resolveCommune({ lat: -20, lng: -70 }, [...COMMUNES])).toBeNull();
  });
});

describe('evaluateCommuneCompliance', () => {
  const santiago = COMMUNES.find((c) => c.code === '13101')!;
  const quilicura = COMMUNES.find((c) => c.code === '13125')!;

  it('no restringe cuando la ruta no declara comunas autorizadas', () => {
    const result = evaluateCommuneCompliance({
      positions: [position(quilicura.center, '2026-08-27T10:00:00.000Z')],
      communes: [...COMMUNES],
      authorizedCommuneCodes: [],
      toleranceSeconds: 300,
    });

    expect(result.authorized).toBe(true);
    expect(result.violationConfirmed).toBe(false);
    expect(result.currentCommune?.code).toBe('13125');
  });

  it('acepta la circulacion dentro de la zona autorizada', () => {
    const result = evaluateCommuneCompliance({
      positions: [position(santiago.center, '2026-08-27T10:00:00.000Z')],
      communes: [...COMMUNES],
      authorizedCommuneCodes: ['13101'],
      toleranceSeconds: 300,
    });

    expect(result.authorized).toBe(true);
  });

  it('no alerta por un cruce breve de limite comunal', () => {
    const result = evaluateCommuneCompliance({
      positions: [
        position(santiago.center, '2026-08-27T10:00:00.000Z'),
        position(quilicura.center, '2026-08-27T10:01:00.000Z'),
      ],
      communes: [...COMMUNES],
      authorizedCommuneCodes: ['13101'],
      toleranceSeconds: 300,
    });

    expect(result.authorized).toBe(false);
    // Igual criterio que el desvio: con una unica muestra fuera de zona no se
    // puede afirmar cuanto tiempo lleva alli.
    expect(result.continuousSecondsOutside).toBe(0);
    expect(result.violationConfirmed).toBe(false);
  });

  it('confirma la violacion al superar la tolerancia', () => {
    const result = evaluateCommuneCompliance({
      positions: [
        position(santiago.center, '2026-08-27T10:00:00.000Z'),
        position(quilicura.center, '2026-08-27T10:01:00.000Z'),
        position(quilicura.center, '2026-08-27T10:08:00.000Z'),
      ],
      communes: [...COMMUNES],
      authorizedCommuneCodes: ['13101'],
      toleranceSeconds: 300,
    });

    expect(result.violationConfirmed).toBe(true);
    expect(result.currentCommune?.name).toBe('Quilicura');
  });

  it('no alerta cuando la posicion cae fuera de la cartografia conocida', () => {
    const result = evaluateCommuneCompliance({
      positions: [position({ lat: -20, lng: -70 }, '2026-08-27T10:00:00.000Z')],
      communes: [...COMMUNES],
      authorizedCommuneCodes: ['13101'],
      toleranceSeconds: 300,
    });

    // Falta de cobertura cartografica no es una infraccion operacional.
    expect(result.violationConfirmed).toBe(false);
    expect(result.currentCommune).toBeNull();
  });
});
