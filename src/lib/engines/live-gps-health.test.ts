import { expect, it } from 'vitest';
import { DEFAULT_OPERATIONAL_SETTINGS } from '@/config/operational';
import type { Position } from '@/types/core';
import { latestGpsTimestamp, liveGpsConnection } from './live-gps-health';
const gps = DEFAULT_OPERATIONAL_SETTINGS.gps;
it('consultar nuevamente una posición no renueva la hora del fix', () => {
  const timestamp = '2026-10-08T14:03:46Z';
  expect(latestGpsTimestamp([{ valid: true, timestamp } as Position], null, Date.parse('2026-10-08T14:07:00Z'))).toBe(timestamp);
  expect(latestGpsTimestamp([{ valid: true, timestamp: '2026-10-08T14:02:00Z' } as Position], timestamp)).toBe(timestamp);
});
it.each([[59, 'online'], [60, 'stale'], [179, 'stale'], [180, 'lost'], [599, 'lost'], [600, 'offline']] as const)
  ('aplica los umbrales reales a un fix de %i segundos aunque la fuente avise que no es reciente', (age, state) => {
    expect(liveGpsConnection(age, true, true, gps)).toBe(state);
  });
it('distingue un fallo de consulta de la posición antigua y respeta umbrales personalizados', () => {
  expect(liveGpsConnection(30, false, true, gps)).toBe('offline');
  expect(liveGpsConnection(180, true, true, { ...gps, signalLostSeconds: 300 })).toBe('stale');
});
