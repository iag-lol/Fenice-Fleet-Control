import { bearingDegrees, haversineMeters, interpolate, isUsableCoordinate, polylineLengthMeters } from '@/lib/geo';
import type { LatLng, Position } from '@/types/core';

export function roadPathForTransition(previous: Position, next: Position): LatLng[] | null {
  const road = next.roadMatch;
  const seconds = (Date.parse(next.timestamp) - Date.parse(previous.timestamp)) / 1000;
  if (!previous.valid || !next.valid || previous.vehicleId !== next.vehicleId || previous.deviceId !== next.deviceId || next.historyGapBefore ||
    !isUsableCoordinate(previous) || !isUsableCoordinate(next) ||
    !road || road.fromTimestamp !== previous.timestamp || !Number.isFinite(seconds) || seconds <= 0 || seconds > 60 ||
    !Number.isFinite(road.confidence) || road.confidence < 0.8 || road.confidence > 1 ||
    road.path.length < 2 || !road.path.every(isUsableCoordinate)) return null;
  const direct = haversineMeters(previous, next);
  const length = polylineLengthMeters(road.path);
  if (haversineMeters(previous, road.path[0]!) > 35 || haversineMeters(next, road.path.at(-1)!) > 35 ||
    length > Math.max(direct * 3, 150) || length / seconds > 55) return null;
  return road.path;
}

/** Never silently connect endpoints from independent road matches. */
export function joinContinuousPaths(paths: LatLng[][]): LatLng[][] {
  const segments: LatLng[][] = [];
  let segment: LatLng[] = [];
  const flush = () => { if (segment.length >= 2) segments.push(segment); segment = []; };
  for (const path of paths) {
    if (path.length < 2) { flush(); continue; }
    const last = segment.at(-1), first = path[0]!;
    if (last && (last.lat !== first.lat || last.lng !== first.lng)) flush();
    if (!segment.length) segment.push(...path);
    else segment.push(...path.slice(1));
  }
  flush();
  return segments;
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
