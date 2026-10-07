import { afterEach, describe, expect, it, vi } from 'vitest';
import { addRoadMatches, matchRoadSegment } from './road-matching';
vi.mock('@/config/env', () => ({ getServerEnv: () => ({ OSRM_BASE_URL: process.env.OSRM_BASE_URL }) }));
import type { Position } from '@/types/core';
const a: Position = { vehicleId: 'v1' as Position['vehicleId'], deviceId: 'd1' as Position['deviceId'],
  timestamp: '2026-09-12T12:00:00Z', lat: -33.45, lng: -70.66, speed: 30, heading: 90, ignition: 'on', valid: true };
const b = { ...a, lng: -70.659, lat: -33.449, timestamp: '2026-09-12T12:00:30Z' };
const matched = { code: 'Ok', tracepoints: [{ matchings_index: 0 }, { matchings_index: 0 }],
  matchings: [{ confidence: .95, geometry: { coordinates: [[a.lng, a.lat], [b.lng, a.lat], [b.lng, b.lat]] } }] };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('road matching preserves GPS evidence', () => {
  it('ordena las muestras del mismo vehículo sin carreras y conserva el orden de la respuesta', async () => {
    vi.stubEnv('OSRM_BASE_URL', 'https://routing.example.test');
    const first = { ...a, vehicleId: 'concurrent-vehicle' as Position['vehicleId'] };
    const second = { ...b, vehicleId: first.vehicleId };
    const third = { ...second, lat: -33.448, timestamp: '2026-09-12T12:01:00Z' };
    const fetch = vi.fn(async (url: string) => {
      await Promise.resolve();
      const coordinates = new URL(url).pathname.split('/').at(-1)!.split(';').map((point) => point.split(',').map(Number));
      return Response.json({ code: 'Ok', tracepoints: [{ matchings_index: 0 }, { matchings_index: 0 }], matchings: [{ confidence: .95, geometry: { coordinates } }] });
    });
    vi.stubGlobal('fetch', fetch);
    const result = await addRoadMatches([third, first, second]);
    expect(result.map((p) => p.timestamp)).toEqual([third.timestamp, first.timestamp, second.timestamp]);
    expect(result[2]?.roadMatch?.fromTimestamp).toBe(first.timestamp);
    expect(result[0]?.roadMatch?.fromTimestamp).toBe(second.timestamp);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
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
