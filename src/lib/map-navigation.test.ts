import { describe, expect, it } from 'vitest';
import { boundsForPoints, closedRing, geofencePoints, operationPoints } from '@/lib/map-navigation';
import { DEFAULT_GEOFENCE_RULES, asGeofenceId, type Geofence } from '@/types/core';
import type { MapSnapshot } from '@/types/views';

const circle: Geofence = {
  id: asGeofenceId('test'), name: 'Zona', description: null, kind: 'carga',
  geometry: { shape: 'circle', center: { lat: -33.4, lng: -70.6 }, radiusMeters: 500 },
  referenceId: null, clientId: null, routeId: null, vehicleId: null, communeCode: null,
  minDwellSeconds: null, rules: DEFAULT_GEOFENCE_RULES, active: true, color: '#123456',
  createdAt: '2026-09-12T12:00:00Z', updatedAt: null, origin: 'manual',
};

describe('operational camera and perimeter geometry', () => {
  it('ignores missing and invalid GPS fixes when fitting the fleet', () => {
    expect(boundsForPoints([{ lat: 0, lng: 0 }, { lat: NaN, lng: -70 }, { lat: 100, lng: -70 }])).toBeNull();
    expect(boundsForPoints([{ lat: 0, lng: 0 }, { lat: -33, lng: -70 }, { lat: -34, lng: -71 }])).toEqual({ minLat: -34, maxLat: -33, minLng: -71, maxLng: -70 });
  });
  it('fits the whole circular perimeter instead of only its center', () => {
    const bounds = boundsForPoints(geofencePoints(circle))!;
    expect(bounds.minLat).toBeLessThan(-33.4);
    expect(bounds.maxLat).toBeGreaterThan(-33.4);
    expect(bounds.minLng).toBeLessThan(-70.6);
    expect(bounds.maxLng).toBeGreaterThan(-70.6);
  });
  it('closes an editor polygon without changing the stored vertices', () => {
    const vertices = [{ lat: -33, lng: -70 }, { lat: -34, lng: -70 }, { lat: -34, lng: -71 }];
    expect(closedRing(vertices)).toEqual([[-70, -33], [-70, -34], [-71, -34], [-70, -33]]);
    expect(vertices).toHaveLength(3);
    expect(closedRing([...vertices, vertices[0]!])).toHaveLength(4);
    expect(closedRing(vertices.slice(0, 2))).toEqual([]);
  });
  it('includes active geofences in an operation that has no vehicles or clients', () => {
    const snapshot: MapSnapshot = { generatedAt: '', vehicles: [], clients: [], routes: [], geofences: [circle], alerts: [], pendingWorkOrders: [], communes: [] };
    expect(boundsForPoints(operationPoints(snapshot))).not.toBeNull();
    expect(operationPoints({ ...snapshot, geofences: [{ ...circle, active: false }] })).toEqual([]);
  });
});
