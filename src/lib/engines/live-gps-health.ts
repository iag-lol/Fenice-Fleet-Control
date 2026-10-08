import type { Position } from '@/types/core';
import type { OperationalSettings } from '@/config/operational';
import type { DeviceConnectionState } from '@/types/core';

/** La antigüedad depende del fix, no de cuándo se volvió a consultar. */
export function latestGpsTimestamp(positions: Position[], previous: string | null, now = Date.now()): string | null {
  const timestamps = positions.filter((p) => p.valid && Number.isFinite(Date.parse(p.timestamp)) &&
    Date.parse(p.timestamp) <= now + 60_000).map((p) => p.timestamp);
  if (previous) timestamps.push(previous);
  return timestamps.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
}

export function liveGpsConnection(age: number | null, sourceResponding: boolean, hasError: boolean,
  thresholds: OperationalSettings['gps']): DeviceConnectionState {
  if (!sourceResponding && hasError) return 'offline';
  if (age === null) return 'unknown';
  if (age >= thresholds.offlineSeconds) return 'offline';
  if (age >= thresholds.signalLostSeconds) return 'lost';
  if (age >= thresholds.staleSeconds) return 'stale';
  return 'online';
}
