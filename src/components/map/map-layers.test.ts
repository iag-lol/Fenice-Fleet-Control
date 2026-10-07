import { describe, expect, it } from 'vitest';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { validateStyleMin, type StyleSpecification } from '@maplibre/maplibre-gl-style-spec';

import { registerLayers, SOURCE, updateAlerts, updateCommunes, updateFollowTrail, updateGeofences, updateRoutes } from '@/components/map/map-layers';
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
  it('registra todas las capas con expresiones válidas para MapLibre', () => {
    const style: StyleSpecification = { version: 8, glyphs: 'https://example.test/fonts/{fontstack}/{range}.pbf', sources: {}, layers: [] };
    const map = { addSource: (id: string, source: StyleSpecification['sources'][string]) => { style.sources[id] = source; },
      addLayer: (layer: StyleSpecification['layers'][number]) => { style.layers.push(layer); } } as unknown as MapLibreMap;
    registerLayers(map);
    expect(validateStyleMin(style).map((error) => error.message)).toEqual([]);
  });
  it('la estela en vivo conserva vértices de giro y separa los cortes', () => {
    const { map, data } = sourceRecorder();
    const paths = [
      [{ lat: -33.45, lng: -70.7 }, { lat: -33.45, lng: -70.699 }, { lat: -33.449, lng: -70.699 }],
      [],
      [{ lat: -33.44, lng: -70.68 }, { lat: -33.439, lng: -70.68 }],
    ];
    updateFollowTrail(map, paths);
    expect(data.get(SOURCE.followTrail)!.features.map((f) => (f.geometry as GeoJSON.LineString).coordinates))
      .toEqual([paths[0], paths[2]].map((path) => path!.map((p) => [p.lng, p.lat])));
  });
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

  it('parte la geometría inválida sin dibujar un puente entre sus extremos', () => {
    const { map, data } = sourceRecorder();
    const broken = [path[0]!, path[1]!, { lat: 0, lng: 0 }, path[1]!, path[2]!];
    updateRoutes(map, [route({ plannedPath: broken, executedPath: broken })], null);
    for (const source of [SOURCE.routesPlanned, SOURCE.routesExecuted]) {
      const features = data.get(source)!.features;
      expect(features).toHaveLength(2);
      expect(features.map((f) => (f.geometry as GeoJSON.LineString).coordinates)).toEqual([
        path.slice(0, 2).map((p) => [p.lng, p.lat]), path.slice(1).map((p) => [p.lng, p.lat]),
      ]);
    }
  });

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

it('distingue traza de contexto, perfil de velocidad y extremos sin unir cortes', () => {
  const { map, data } = sourceRecorder();
  const route: RouteGeometry = { routeId: 'gps', code: '', name: 'GPS', vehicleId: 'v1', vehiclePlate: 'RBDC59', status: 'completada', plannedPath: [], executedPath: [],
    executedSegments: [[{ lat: -33.45, lng: -70.66 }, { lat: -33.449, lng: -70.66 }], [{ lat: -33.44, lng: -70.65 }, { lat: -33.439, lng: -70.65 }]],
    speedSections: [{ path: [{ lat: -33.45, lng: -70.66 }, { lat: -33.449, lng: -70.66 }], color: '#0891b2' }, { path: [{ lat: -33.44, lng: -70.65 }, { lat: -33.439, lng: -70.65 }], color: '#dc2626' }], showEndpoints: true, visualRole: 'preview', stops: [] };
  updateRoutes(map, [route], 'gps');
  const features = data.get(SOURCE.routesExecuted)?.features ?? [];
  expect(features).toHaveLength(2);
  expect(features[1]?.properties).toMatchObject({ color: '#dc2626', preview: true, highlighted: true });
  expect(data.get(SOURCE.routeEndpoints)?.features).toHaveLength(2);
  expect(data.get(SOURCE.routeEndpoints)?.features[0]?.properties?.start).toBe(true);
});
