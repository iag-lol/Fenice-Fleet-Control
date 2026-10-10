import type { OperationalSettings } from '@/config/operational';
import type { DeviceStatus, Position } from '@/types/core';
import { secondsSince } from './gps-health';
import { latestTelemetry } from '@/lib/gps-telemetry';

/** Heartbeats y recepcion son evidencia de comunicacion, nunca un fix nuevo.
 * El margen cubre el sondeo y los equipos con heartbeat de diez minutos. */
export function gpsCommunication(device: Pick<DeviceStatus, 'lastCommunicationAt' | 'telemetry'> | null | undefined,
  position: Partial<Pick<Position, 'receivedAt' | 'ignition' | 'speed' | 'speedKnown' | 'valid' | 'telemetry'>> | null | undefined, gps: OperationalSettings['gps'], now = new Date()) {
  const offlineAfterSeconds = gps.offlineSeconds + Math.max(60, Math.ceil(gps.refreshIntervalMs / 1000) * 2);
  const dates = [device?.lastCommunicationAt, position?.receivedAt]
    .filter((at): at is string => !!at && secondsSince(at, now) !== null)
    .sort((a, b) => Date.parse(b) - Date.parse(a));
  const lastCommunicationAt = dates[0] ?? null;
  const ageSeconds = secondsSince(lastCommunicationAt, now);
  const powerFailure = latestTelemetry(position, device)?.externalPowerFailure === true;
  const parked = !powerFailure && position?.ignition === 'off' && position.valid === true && position.speedKnown !== false &&
    typeof position.speed === 'number' && Number.isFinite(position.speed) && position.speed >= 0 && position.speed < Math.max(1, gps.movingSpeedThresholdKmh);
  const parkedAfterSeconds = Math.max(offlineAfterSeconds, gps.parkedCommunicationSeconds);
  const state: 'online' | 'offline' | 'unknown' | 'standby' = ageSeconds === null ? 'unknown'
    : ageSeconds < offlineAfterSeconds ? 'online'
    : parked && ageSeconds < parkedAfterSeconds ? 'standby' : 'offline';
  return { state, lastCommunicationAt, ageSeconds, offlineAfterSeconds: parked ? parkedAfterSeconds : offlineAfterSeconds, parked };
}
