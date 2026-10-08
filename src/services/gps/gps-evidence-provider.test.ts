import { expect, it } from 'vitest';
import { withGpsEvidence } from './gps-evidence-provider';
import type { GpsProvider } from './gps-provider';
import type { Position } from '@/types/core';
const baseTime = Date.parse('2026-10-08T12:00:00Z');
const p = (second: number, vehicleId = 'v1', deviceId = 'd1'): Position => ({
  vehicleId: vehicleId as Position['vehicleId'], deviceId: deviceId as Position['deviceId'],
  timestamp: new Date(baseTime + second * 1000).toISOString(), lat: -33.45, lng: -70.66,
  valid: true, speed: 0, ignition: 'on', heading: 0,
});
it('no corrobora repeticiones, separa equipos y conserva coordenada y fecha originales', async () => {
  let positions = [p(0)];
  const provider = withGpsEvidence({ info: { simulated: false }, getAllCurrentPositions: async () => positions } as GpsProvider);
  for (let i = 0; i < 5; i++) expect((await provider.getAllCurrentPositions())[0]!.motionEvidence).toBe('uncertain');
  positions = [p(15), p(15, 'v2')];
  expect((await provider.getAllCurrentPositions()).map((x) => x.motionEvidence)).toEqual(['uncertain', 'uncertain']);
  positions = [p(30), p(30, 'v2')];
  const result = await provider.getAllCurrentPositions();
  expect(result[0]).toEqual({ ...p(30), motionEvidence: 'stationary' });
  expect(result[1]!.motionEvidence).toBe('uncertain');
  positions = [p(45, 'v1', 'd2')];
  expect((await provider.getAllCurrentPositions())[0]!.motionEvidence).toBe('uncertain');
  positions = [p(600, 'v1', 'd2')];
  expect((await provider.getAllCurrentPositions())[0]!.motionEvidence).toBe('uncertain');
});

it('corrobora lecturas rápidas tras veinte segundos, sin convertir repeticiones en evidencia', async () => {
  let current = p(0);
  const provider = withGpsEvidence({ info: { simulated: false }, getAllCurrentPositions: async () => [current] } as GpsProvider);
  for (let second = 0; second <= 25; second += 5) {
    current = p(second);
    expect((await provider.getAllCurrentPositions())[0]!.motionEvidence).toBe(second < 20 ? 'uncertain' : 'stationary');
  }
});
