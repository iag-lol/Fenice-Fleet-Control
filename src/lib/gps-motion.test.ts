import { describe, expect, it } from 'vitest';
import { pointOnRoad, roadPathForTransition } from './gps-motion';
import { normalizeGpsHistory } from './gps-history';
import type { Position } from '@/types/core';
export const sample = (second: number, lng = -70.66): Position => ({
  vehicleId: 'v1' as Position['vehicleId'], deviceId: 'd1' as Position['deviceId'],
  lat: -33.45, lng, timestamp: new Date(Date.UTC(2026, 8, 12, 12, 0, second)).toISOString(),
  speed: 30, heading: 90, ignition: 'on', valid: true,
});
describe('GPS evidence and road geometry', () => {
  it('follows the corner instead of its diagonal', () => {
    const path = [{ lat: -33.45, lng: -70.66 }, { lat: -33.45, lng: -70.659 }, { lat: -33.449, lng: -70.659 }];
    for (const t of [.1, .3, .5, .8]) {
      const p = pointOnRoad(path, t);
      expect(p.lat === path[0]!.lat || p.lng === path[1]!.lng).toBe(true);
    }
    expect(pointOnRoad(path, 1).lat).toBeCloseTo(path[2]!.lat);
  });
  it('does not invent a road for raw positions, mismatched reports or long gaps', () => {
    const a = sample(0), b = sample(20, -70.659);
    expect(roadPathForTransition(a, b)).toBeNull();
    b.roadMatch = { fromTimestamp: a.timestamp, confidence: .95, path: [a, b] };
    expect(roadPathForTransition(a, b)).toHaveLength(2);
    expect(roadPathForTransition(sample(1), b)).toBeNull();
    expect(roadPathForTransition(a, { ...b, timestamp: sample(100).timestamp })).toBeNull();
    expect(roadPathForTransition(a, { ...b, roadMatch: { ...b.roadMatch, confidence: .4 } })).toBeNull();
  });
  it('keeps both endpoints when sampling and rejects invalid/out-of-order samples', () => {
    const raw = [sample(3), sample(0), sample(2), sample(1), { ...sample(4), lat: 0, lng: 0 }];
    expect(normalizeGpsHistory(raw, 2).map((p) => p.timestamp)).toEqual([sample(0).timestamp, sample(3).timestamp]);
    expect(raw[0]?.timestamp).toBe(sample(3).timestamp);
  });
});
