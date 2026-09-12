import { circleToPolygon, isUsableCoordinate } from '@/lib/geo';
import type { BoundingBox, Geofence, LatLng } from '@/types/core';
import type { MapSnapshot } from '@/types/views';

/** Excludes absent GPS fixes so they cannot pull the camera away from the operation. */
export function boundsForPoints(points: LatLng[]): BoundingBox | null {
  const valid = points.filter(isUsableCoordinate);
  if (!valid.length) return null;
  return valid.reduce<BoundingBox>((bounds, point) => ({
    minLat: Math.min(bounds.minLat, point.lat), maxLat: Math.max(bounds.maxLat, point.lat),
    minLng: Math.min(bounds.minLng, point.lng), maxLng: Math.max(bounds.maxLng, point.lng),
  }), { minLat: valid[0]!.lat, maxLat: valid[0]!.lat, minLng: valid[0]!.lng, maxLng: valid[0]!.lng });
}

export function geofencePoints(geofence: Geofence): LatLng[] {
  return geofence.geometry.shape === 'circle'
    ? circleToPolygon(geofence.geometry.center, geofence.geometry.radiusMeters)
    : geofence.geometry.vertices;
}

export function operationPoints(snapshot: MapSnapshot): LatLng[] {
  return [
    ...snapshot.vehicles.flatMap((v) => v.position ? [v.position] : []),
    ...snapshot.clients,
    ...snapshot.pendingWorkOrders,
    ...snapshot.alerts,
    ...snapshot.routes.flatMap((r) => [...r.plannedPath, ...r.executedPath, ...r.stops]),
    ...snapshot.geofences.filter((g) => g.active).flatMap(geofencePoints),
  ];
}

/** GeoJSON requires closed polygon rings, even when the editor stores open vertices. */
export function closedRing(points: LatLng[]): number[][] {
  if (points.length < 3 || points.some((p) => !isUsableCoordinate(p))) return [];
  const ring = points.map((p) => [p.lng, p.lat]);
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (first.lat !== last.lat || first.lng !== last.lng) ring.push([first.lng, first.lat]);
  return ring;
}
