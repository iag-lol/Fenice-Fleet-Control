import { describe, expect, it } from 'vitest';
import type { Map as MapLibreMap } from 'maplibre-gl';

import { SOURCE, updateAlerts, updateCommunes, updateGeofences } from '@/components/map/map-layers';
import type { Geofence } from '@/types/core';
import type { AlertMapPoint } from '@/types/views';

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
