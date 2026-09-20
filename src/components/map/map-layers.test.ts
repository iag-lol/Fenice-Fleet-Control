import { describe, expect, it } from 'vitest';
import type { Map as MapLibreMap } from 'maplibre-gl';

import { SOURCE, updateAlerts, updateCommunes, updateGeofences, updateRoutes } from '@/components/map/map-layers';
import { polylineLengthMeters } from '@/lib/geo';
import type { Geofence } from '@/types/core';
import type { AlertMapPoint, RouteGeometry } from '@/types/views';

function sourceRecorder() {
  const data = new Map<string, GeoJSON.FeatureCollection>();
  const map = {
    getSource: (id: string) => ({ setData: (features: GeoJSON.FeatureCollection) => data.set(id, features) }),
  } as unknown as MapLibreMap;
  return { map, data };
}

describe('capas territoriales del mapa', () => {
  it('muestra geocercas inactivas, resalta la seleccionada y descarta geometria invalida', () => {
    const { map, data } = sourceRecorder();
    const geofences = [
      {
        id: 'zona-inactiva', name: 'Zona inactiva', kind: 'cliente', color: '#0088aa', active: false,
        geometry: { shape: 'polygon', vertices: [
          { lat: -33.4, lng: -70.6 }, { lat: -33.5, lng: -70.6 }, { lat: -33.5, lng: -70.7 },
        ] },
      },
      {
        id: 'zona-invalida', name: 'Zona invalida', kind: 'cliente', color: '#0088aa', active: true,
        geometry: { shape: 'circle', center: { lat: 0, lng: 0 }, radiusMeters: 500 },
      },
    ] as unknown as Geofence[];

    updateGeofences(map, geofences, 'zona-inactiva');

    const features = data.get(SOURCE.geofences)?.features ?? [];
    expect(features).toHaveLength(1);
    expect(features[0]?.properties).toMatchObject({ geofenceId: 'zona-inactiva', active: false, selected: true });
    expect(features[0]?.geometry).toMatchObject({ type: 'Polygon', coordinates: [[
      [-70.6, -33.4], [-70.6, -33.5], [-70.7, -33.5], [-70.6, -33.4],
    ]] });
  });

  it('conserva los IDs de comunas cuando cambia el orden de los datos', () => {
    const { map, data } = sourceRecorder();
    const boundary = [
      { lat: -33.4, lng: -70.6 }, { lat: -33.5, lng: -70.6 }, { lat: -33.5, lng: -70.7 },
    ];
    const first = { code: '13101', name: 'Santiago', center: boundary[0]!, boundary };
    const second = { code: '13102', name: 'Cerrillos', center: boundary[0]!, boundary };

    updateCommunes(map, [first, second]);
    const initial = data.get(SOURCE.communes)?.features.map((feature) => feature.id);
    updateCommunes(map, [second, first]);
    const reordered = data.get(SOURCE.communes)?.features.map((feature) => feature.id);

    expect(initial).toEqual(['13101', '13102']);
    expect(reordered).toEqual(['13102', '13101']);
  });

  it('mantiene la alerta seleccionada y elimina puntos sin posicion GPS', () => {
    const { map, data } = sourceRecorder();
    const alerts = [
      { alertId: 'a1', severity: 'critical', title: 'Desvio', lat: -33.4, lng: -70.6 },
      { alertId: 'a2', severity: 'warning', title: 'Sin GPS', lat: 0, lng: 0 },
    ] as AlertMapPoint[];

    updateAlerts(map, alerts, 'a1');

    const features = data.get(SOURCE.alerts)?.features ?? [];
    expect(features).toHaveLength(1);
    expect(features[0]?.properties).toMatchObject({ alertId: 'a1', selected: true });
  });
});

describe('updateRoutes: difuminado del tramo ya recorrido', () => {
  const path = [
    { lat: -33.45, lng: -70.7 },
    { lat: -33.45, lng: -70.65 },
    { lat: -33.45, lng: -70.6 },
  ];
  const totalMeters = polylineLengthMeters(path);

  function route(overrides: Partial<RouteGeometry> = {}): RouteGeometry {
    return {
      routeId: 'r1',
      code: 'R-001',
      name: 'Ruta de prueba',
      vehicleId: 'veh-1',
      vehiclePlate: 'AA1111',
      status: 'en_curso',
      plannedPath: path,
      executedPath: [],
      stops: [],
      ...overrides,
    };
  }

  it('sin progreso conocido, dibuja el corredor completo sin difuminar nada', () => {
    const { map, data } = sourceRecorder();
    updateRoutes(map, [route({ plannedProgressMeters: null })], null);

    const features = data.get(SOURCE.routesPlanned)?.features ?? [];
    expect(features).toHaveLength(1);
    expect(features[0]?.properties).toMatchObject({ covered: false });
  });

  it('con progreso a mitad de camino, parte el corredor en recorrido y restante', () => {
    const { map, data } = sourceRecorder();
    updateRoutes(map, [route({ plannedProgressMeters: totalMeters / 2 })], null);

    const features = data.get(SOURCE.routesPlanned)?.features ?? [];
    expect(features).toHaveLength(2);

    const covered = features.find((f) => f.properties?.covered === true);
    const remaining = features.find((f) => f.properties?.covered === false);
    expect(covered).toBeDefined();
    expect(remaining).toBeDefined();

    // El punto de inicio queda en el tramo recorrido y el punto final en el
    // restante: la particion respeta el sentido del corredor.
    const coveredCoords = (covered!.geometry as GeoJSON.LineString).coordinates;
    const remainingCoords = (remaining!.geometry as GeoJSON.LineString).coordinates;
    expect(coveredCoords[0]).toEqual([path[0]!.lng, path[0]!.lat]);
    expect(remainingCoords.at(-1)).toEqual([path.at(-1)!.lng, path.at(-1)!.lat]);
  });

  it('con progreso mas alla del final, el corredor completo queda marcado como recorrido', () => {
    const { map, data } = sourceRecorder();
    updateRoutes(map, [route({ plannedProgressMeters: totalMeters + 1_000 })], null);

    const features = data.get(SOURCE.routesPlanned)?.features ?? [];
    expect(features).toHaveLength(1);
    expect(features[0]?.properties).toMatchObject({ covered: true });
  });
});
