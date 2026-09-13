import { afterEach, describe, expect, it, vi } from 'vitest';
import { matchRoadSegment } from './road-matching';
import type { Position } from '@/types/core';
const a: Position = { vehicleId: 'v1' as Position['vehicleId'], deviceId: 'd1' as Position['deviceId'],
  timestamp: '2026-09-12T12:00:00Z', lat: -33.45, lng: -70.66, speed: 30, heading: 90, ignition: 'on', valid: true };
const b = { ...a, lng: -70.659, lat: -33.449, timestamp: '2026-09-12T12:00:30Z' };
const matched = { code: 'Ok', tracepoints: [{ matchings_index: 0 }, { matchings_index: 0 }],
  matchings: [{ confidence: .95, geometry: { coordinates: [[a.lng, a.lat], [b.lng, a.lat], [b.lng, b.lat]] } }] };
afterEach(() => vi.unstubAllGlobals());
describe('road matching preserves GPS evidence', () => {
  it('accepts a reliable corner without modifying raw coordinates', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(matched)));
    const result = await matchRoadSegment(a, b, 'https://routing.example.test');
    expect(result?.path).toHaveLength(3);
    expect(result?.fromTimestamp).toBe(a.timestamp);
    expect(b.roadMatch).toBeUndefined();
  });
  it('rejects ambiguous matches and unmatchable tracepoints', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...matched, tracepoints: [null, null] })));
    expect(await matchRoadSegment(a, b, 'https://routing.example.test')).toBeUndefined();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...matched, matchings: [{ ...matched.matchings[0], confidence: .3 }] })));
    expect(await matchRoadSegment(a, b, 'https://routing.example.test')).toBeUndefined();
  });
  it('does not request roads for gaps, invalid fixes or implausible jumps', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(await matchRoadSegment(a, { ...b, timestamp: '2026-09-12T12:10:00Z' }, 'https://routing.example.test')).toBeUndefined();
    expect(await matchRoadSegment(a, { ...b, valid: false }, 'https://routing.example.test')).toBeUndefined();
    expect(await matchRoadSegment(a, { ...b, lng: -71 }, 'https://routing.example.test')).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});
