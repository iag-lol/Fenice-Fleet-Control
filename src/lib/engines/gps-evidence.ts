import { haversineMeters, polylineLengthMeters } from '@/lib/geo';
import { buildReplayTimeline, type ReplayTimeline } from './route-replay';
import type { Position } from '@/types/core';

export type MotionEvidence = 'moving' | 'stationary' | 'uncertain';

/** Política conservadora de consistencia, no certificación de la ubicación física.
 * Tres fixes distintos, al menos 20 s, sin cortes mayores de 60 s.
 * Nunca ajusta puntos a calles ni rellena el trayecto entre reportes.
 */
export function buildEvidenceTimeline(positions: Position[]): ReplayTimeline | null {
  const timeline = buildReplayTimeline(positions);
  if (!timeline || timeline.samples.every((p) => p.simulated === true)) return timeline;
  const { samples } = timeline;
  const evidence: MotionEvidence[] = Array(samples.length - 1).fill('uncertain');
  for (let i = 2; i < samples.length; i++) {
    const triple = samples.slice(i - 2, i + 1);
    const [a, b, c] = triple as [Position, Position, Position];
    const intervals = [b, c].map((p, j) => (Date.parse(p.timestamp) - Date.parse(triple[j]!.timestamp)) / 1000);
    if (triple.some((p) => !p.valid || p.vehicleId !== a.vehicleId || p.deviceId !== a.deviceId ||
      !Number.isFinite(p.speed) || p.speed < 0 || p.speed > 160 ||
      (p.accuracy !== undefined && (!Number.isFinite(p.accuracy) || p.accuracy < 0 || p.accuracy > 30))) ||
      b.historyGapBefore || c.historyGapBefore || intervals.some((s) => s <= 0 || s > 60) ||
      intervals[0]! + intervals[1]! < 20) continue;
    const distances = [haversineMeters(a, b), haversineMeters(b, c)];
    const displacement = haversineMeters(a, c);
    const moving = triple.every((p) => p.speed >= 3) && displacement >= 25 &&
      displacement >= (distances[0]! + distances[1]!) * 0.4 &&
      distances.every((meters, j) => {
        const implied = meters / intervals[j]! * 3.6;
        const reported = (triple[j]!.speed + triple[j + 1]!.speed) / 2;
        return implied <= 160 && Math.abs(implied - reported) <= Math.max(15, reported * 0.6);
      });
    const stationary = triple.every((p) => p.speed < 3) &&
      Math.max(...distances, displacement) <= 15;
    if (!moving && !stationary) continue;
    for (const edge of [i - 2, i - 1]) evidence[edge] = moving ? 'moving' : 'stationary';
  }
  // Sólo se representan segmentos de movimiento consistentes. El reposo no
  // genera geometría ni distancia; lo incierto conserva sus registros crudos.
  const paths = evidence.map((state, i) => state === 'moving'
    ? [{ lat: samples[i]!.lat, lng: samples[i]!.lng }, { lat: samples[i + 1]!.lat, lng: samples[i + 1]!.lng }] : []);
  let distance = 0;
  const cumulativeMeters = [0];
  for (const path of paths) { distance += polylineLengthMeters(path); cumulativeMeters.push(distance); }
  return { ...timeline, evidence, continuousPaths: paths, cumulativeMeters, totalMeters: distance, roadMatchedMeters: 0 };
}

export function hasJourneyEvidence(timeline: ReplayTimeline): boolean {
  return !timeline.evidence || timeline.evidence.some((state) => state !== 'uncertain');
}
