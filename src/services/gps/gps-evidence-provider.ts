import 'server-only';
import { buildEvidenceTimeline } from '@/lib/engines/gps-evidence';
import type { GpsProvider, PositionSubscriptionHandlers } from './gps-provider';
import type { Position } from '@/types/core';

/** Repetir la misma respuesta de la API no aporta una segunda observación. */
export function withGpsEvidence(base: GpsProvider): GpsProvider {
  const windows = new Map<string, Position[]>();
  const assess = (position: Position): Position => {
    if (base.info.simulated || position.simulated === true) return position;
    let window = windows.get(position.vehicleId) ?? [];
    const last = window.at(-1);
    if (last && (last.deviceId !== position.deviceId || Date.parse(position.timestamp) < Date.parse(last.timestamp))) window = [];
    window = [...window.filter((p) => p.timestamp !== position.timestamp), position].slice(-128);
    windows.set(position.vehicleId, window);
    const timeline = buildEvidenceTimeline(window);
    return { ...position, motionEvidence: timeline?.samples.at(-1)?.timestamp === position.timestamp ? (timeline.evidence?.at(-1) ?? 'uncertain') : 'uncertain' };
  };
  return {
    info: base.info,
    getAvailabilityWarnings: base.getAvailabilityWarnings?.bind(base),
    getVehicles: () => base.getVehicles(),
    async getVehiclePosition(id) { const p = await base.getVehiclePosition(id); return p ? assess(p) : null; },
    async getAllCurrentPositions() { return (await base.getAllCurrentPositions()).map(assess); },
    getPositionHistory: (query) => base.getPositionHistory(query),
    getVehicleEvents: (query) => base.getVehicleEvents(query),
    getDeviceStatus: (id) => base.getDeviceStatus(id),
    subscribeToPositions(handlers: PositionSubscriptionHandlers) {
      return base.subscribeToPositions({ ...handlers, onPositions: (positions) => handlers.onPositions(positions.map(assess)) });
    },
    healthCheck: base.healthCheck?.bind(base),
  };
}
