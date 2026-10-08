import { containsPoint } from './geofence-engine';
import { buildEvidenceTimeline } from './gps-evidence';
import { isContinuous } from './route-replay';
import { normalizeGpsHistory } from '@/lib/gps-history';
import { isUsableCoordinate } from '@/lib/geo';
import { secondsSince } from './gps-health';
import type { OperationalSettings } from '@/config/operational';
import { DEFAULT_GEOFENCE_RULES, type Geofence, type Position, type WorkOrder } from '@/types/core';
import type { ActiveDelivery } from '@/types/views';

export function deliveryGeofence(workOrder: WorkOrder, geofences: Geofence[], radius: number): Geofence | null {
  const linked = workOrder.geofenceId ? geofences.find((g) => g.id === workOrder.geofenceId) : null;
  if (linked) return linked.active && (!linked.clientId || linked.clientId === workOrder.clientId) ? linked : null;
  if (!isUsableCoordinate(workOrder.coordinates)) return null;
  return { id: (workOrder.geofenceId ?? `delivery-${workOrder.id}`) as Geofence['id'], name: workOrder.clientName,
    description: null, kind: 'cliente', geometry: { shape: 'circle', center: workOrder.coordinates!, radiusMeters: radius },
    referenceId: workOrder.id, clientId: workOrder.clientId, routeId: workOrder.routeId, vehicleId: workOrder.vehicleId,
    communeCode: workOrder.communeCode, minDwellSeconds: null, rules: DEFAULT_GEOFENCE_RULES,
    active: true, color: '#15803d', createdAt: workOrder.scheduledDate, updatedAt: null, origin: 'sistema' };
}

/** Cheap filter before requesting history or product data. */
export function deliveryCandidates(position: Position, workOrders: WorkOrder[], geofences: Geofence[], settings: OperationalSettings) {
  if (position.motionEvidence === 'uncertain' || !position.valid || !isUsableCoordinate(position) || !Number.isFinite(position.speed) || position.speed >= settings.gps.movingSpeedThresholdKmh) return [];
  return workOrders.filter((w) => w.vehicleId === position.vehicleId && w.status !== 'cancelada' && !w.actualDepartureAt)
    .map((workOrder) => ({ workOrder, geofence: deliveryGeofence(workOrder, geofences, settings.geofence.defaultRadiusMeters) }))
    .filter((entry): entry is { workOrder: WorkOrder; geofence: Geofence } => entry.geofence !== null && containsPoint(entry.geofence, position))
    .sort((a, b) => Number(b.workOrder.status === 'en_cliente') - Number(a.workOrder.status === 'en_cliente') ||
      Number(a.workOrder.status === 'completada') - Number(b.workOrder.status === 'completada') ||
      (a.workOrder.stopSequence ?? Infinity) - (b.workOrder.stopSequence ?? Infinity) || a.workOrder.id.localeCompare(b.workOrder.id));
}

/** Reconstructs the current stay only; earlier visits and signal gaps cannot inflate it. */
export function findActiveDelivery(input: {
  position: Position | null; history: Position[]; workOrders: WorkOrder[]; geofences: Geofence[];
  settings: OperationalSettings; now: Date;
}) {
  const { position, workOrders, geofences, settings, now } = input;
  const age = position ? secondsSince(position.timestamp, now) : null;
  if (!position || age === null || age >= settings.gps.offlineSeconds) return null;
  const sampleMs = Date.parse(position.timestamp);
  const samples = normalizeGpsHistory([...input.history.filter((p) => p.vehicleId === position.vehicleId && Date.parse(p.timestamp) <= sampleMs), position]);
  const timeline = buildEvidenceTimeline(samples);
  if (position.simulated !== true && !timeline) return null;
  const evidence = timeline?.evidence;
  if (evidence && evidence.at(-1) !== 'stationary') return null;
  for (const { workOrder, geofence } of deliveryCandidates(position, workOrders, geofences, settings)) {
    let enteredIndex = samples.length - 1;
    while (enteredIndex > 0 && (!evidence || evidence[enteredIndex - 1] !== 'uncertain') && isContinuous(samples[enteredIndex - 1]!, samples[enteredIndex]!) && containsPoint(geofence, samples[enteredIndex - 1]!)) enteredIndex--;
    let stoppedIndex = samples.length - 1;
    while (stoppedIndex > enteredIndex && (!evidence || evidence[stoppedIndex - 1] === 'stationary') && samples[stoppedIndex - 1]!.speed < settings.gps.movingSpeedThresholdKmh &&
      isContinuous(samples[stoppedIndex - 1]!, samples[stoppedIndex]!)) stoppedIndex--;
    const enteredSample = samples[enteredIndex]!;
    const stoppedSample = samples[stoppedIndex]!;
    const stoppedSeconds = (sampleMs - Date.parse(stoppedSample.timestamp)) / 1000;
    const reportedArrival = workOrder.actualArrivalAt ? Date.parse(workOrder.actualArrivalAt) : NaN;
    const arrivalObserved = enteredIndex > 0 && (!evidence || evidence[enteredIndex - 1] !== 'uncertain') && isContinuous(samples[enteredIndex - 1]!, enteredSample) && !containsPoint(geofence, samples[enteredIndex - 1]!);
    const useReportedArrival = !arrivalObserved && Number.isFinite(reportedArrival) && (evidence ? reportedArrival >= Date.parse(enteredSample.timestamp) : reportedArrival <= Date.parse(enteredSample.timestamp)) && reportedArrival <= sampleMs;
    const required = geofence.rules.minDwellSeconds ?? geofence.minDwellSeconds ?? settings.geofence.minDwellSeconds;
    if (stoppedSeconds < required && (evidence || !(workOrder.status === 'en_cliente' && useReportedArrival))) continue;
    return { workOrder, geofence, enteredAt: useReportedArrival ? workOrder.actualArrivalAt! : enteredSample.timestamp,
      stoppedAt: stoppedSeconds > 0 ? stoppedSample.timestamp : null, observedAt: position.timestamp,
      arrivalObserved: arrivalObserved || useReportedArrival };
  }
  return null;
}

/** New GPS reports close the card immediately, even while the map response is cached. */
export function deliveryStillPresent(delivery: ActiveDelivery, position: Position | null | undefined): boolean {
  return Boolean(position && position.vehicleId === delivery.vehicleId && position.motionEvidence !== 'uncertain' && position.valid && isUsableCoordinate(position) &&
    Number.isFinite(position.speed) && position.speed < delivery.movingSpeedThresholdKmh && containsPoint(delivery.geofence, position));
}

export function deliveryClock(delivery: ActiveDelivery, nowMs: number, observedAt = delivery.observedAt) {
  const observedMs = Date.parse(observedAt);
  const stale = nowMs - observedMs >= delivery.staleSeconds * 1000;
  const until = Math.min(nowMs, observedMs + delivery.staleSeconds * 1000);
  return { stale, stoppedSeconds: delivery.stoppedAt ? Math.max(0, Math.floor((until - Date.parse(delivery.stoppedAt)) / 1000)) : null };
}
