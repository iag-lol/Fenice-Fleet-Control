import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, readdir, appendFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PositionArchive } from './position-archive';
import type { Position } from '@/types/core';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
describe('durable GPS samples', () => {
  it('survives recreation, serializes concurrent writes and keeps original coordinates', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gps-archive-')); dirs.push(dir);
    const position: Position = { vehicleId: 'v1' as Position['vehicleId'], deviceId: 'd1' as Position['deviceId'],
      timestamp: '2026-09-12T12:00:00Z', lat: -33.45, lng: -70.66, speed: 30, heading: 90, ignition: 'on', valid: true,
      roadMatch: { fromTimestamp: '2026-09-12T11:59:45Z', confidence: .9, path: [{ lat: -33.449, lng: -70.66 }] } };
    const archive = new PositionArchive(dir, 'test');
    await Promise.all([archive.record([position]), archive.record([position])]);
    const file = join(dir, (await readdir(dir))[0]!);
    await appendFile(file, '{incomplete');
    const restored = await new PositionArchive(dir, 'test').read({ vehicleId: position.vehicleId,
      from: '2026-09-12T00:00:00Z', to: '2026-09-13T00:00:00Z' });
    expect(restored).toHaveLength(1);
    expect(restored[0]?.lat).toBe(position.lat);
    expect(restored[0]?.roadMatch?.confidence).toBe(.9);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await new PositionArchive(dir, 'another-source').read({ vehicleId: position.vehicleId,
      from: '2026-09-12T00:00:00Z', to: '2026-09-13T00:00:00Z' })).toEqual([]);
  });
});

it('does not append the same remote history every time an operator reopens a journey', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gps-archive-')); dirs.push(dir);
  const sample: Position = { vehicleId: 'v1' as Position['vehicleId'], deviceId: 'd1' as Position['deviceId'],
    timestamp: '2026-09-12T12:00:00Z', lat: -33.45, lng: -70.66, speed: 30, heading: 90, ignition: 'on', valid: true };
  const archive = new PositionArchive(dir, 'test');
  const { withPositionArchive } = await import('./position-archive');
  const provider = {
    info: { id: 'traccar' as const, label: 'GPS', simulated: false, preferredTransport: 'polling' as const },
    getVehicles: async () => [], getDeviceStatus: async () => [], getVehicleEvents: async () => [],
    getAllCurrentPositions: async () => [], getVehiclePosition: async () => null,
    getPositionHistory: async () => [sample], subscribeToPositions: () => () => {},
  };
  const wrapped = withPositionArchive(provider, archive);
  const query = { vehicleId: sample.vehicleId, from: '2026-09-12T00:00:00Z', to: '2026-09-13T00:00:00Z' };
  await wrapped.getPositionHistory(query);
  const file = join(dir, (await readdir(dir))[0]!);
  const firstSize = (await stat(file)).size;
  await wrapped.getPositionHistory(query);
  expect((await stat(file)).size).toBe(firstSize);
});
