import { bearingDegrees, haversineMeters, interpolate, isUsableCoordinate } from '@/lib/geo';
import type { LatLng, Position } from '@/types/core';

export function roadPathForTransition(previous: Position, next: Position): LatLng[] | null {
  const road = next.roadMatch;
  const seconds = (Date.parse(next.timestamp) - Date.parse(previous.timestamp)) / 1000;
  if (!road || road.fromTimestamp !== previous.timestamp || seconds <= 0 || seconds > 60 ||
    road.confidence < 0.8 || road.path.length < 2 || !road.path.every(isUsableCoordinate)) return null;
  return road.path;
}

/** Avanza por la geometria vial, incluidos sus giros; nunca corta la esquina. */
export function pointOnRoad(path: LatLng[], progress: number): LatLng & { heading: number } {
  const distances = path.slice(1).map((p, i) => haversineMeters(path[i]!, p));
  const total = distances.reduce((sum, distance) => sum + distance, 0);
  let remaining = Math.max(0, Math.min(1, progress)) * total;
  for (let i = 0; i < distances.length; i++) {
    const distance = distances[i]!;
    if (remaining <= distance || i === distances.length - 1) {
      return { ...interpolate(path[i]!, path[i + 1]!, distance > 0 ? remaining / distance : 0),
        heading: bearingDegrees(path[i]!, path[i + 1]!) };
    }
    remaining -= distance;
  }
  return { ...path[0]!, heading: 0 };
}
