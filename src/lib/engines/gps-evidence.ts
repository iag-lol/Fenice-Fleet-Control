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
    const endMs = Date.parse(samples[i]!.timestamp);
    let start = i - 2;
    // A 1–5 Hz hacen falta más de tres puntos para observar 20 segundos.
    // Se limita la ventana para mantener acotado el trabajo por muestra.
    while (start > 0 && i - start < 127 && endMs - Date.parse(samples[start]!.timestamp) < 20_000) start--;
    const window = samples.slice(start, i + 1);
    const first = window[0]!, last = window.at(-1)!;
    const intervals = window.slice(1).map((p, j) => (Date.parse(p.timestamp) - Date.parse(window[j]!.timestamp)) / 1000);
    if (window.some((p) => !p.valid || p.vehicleId !== first.vehicleId || p.deviceId !== first.deviceId ||
      p.speedKnown === false || !Number.isFinite(p.speed) || p.speed < 0 || p.speed > 160 ||
      (p.accuracy !== undefined && (!Number.isFinite(p.accuracy) || p.accuracy < 0 || p.accuracy > 30))) ||
      window.slice(1).some((p) => p.historyGapBefore) || intervals.some((s) => s <= 0 || s > 60) ||
      endMs - Date.parse(first.timestamp) < 20_000) continue;
    const distances = window.slice(1).map((p, j) => haversineMeters(window[j]!, p));
    const displacement = haversineMeters(first, last);
    const moving = window.every((p) => p.speed >= 3) && displacement >= 25 &&
      displacement >= distances.reduce((sum, d) => sum + d, 0) * 0.4 &&
      distances.every((meters, j) => {
        const implied = meters / intervals[j]! * 3.6;
        const reported = (window[j]!.speed + window[j + 1]!.speed) / 2;
        return implied <= 160 && Math.abs(implied - reported) <= Math.max(15, reported * 0.6);
      });
    const stationary = window.every((p) => p.speed < 3) && haversineMeters(
      { lat: Math.min(...window.map((p) => p.lat)), lng: Math.min(...window.map((p) => p.lng)) },
      { lat: Math.max(...window.map((p) => p.lat)), lng: Math.max(...window.map((p) => p.lng)) },
    ) <= 15;
    if (!moving && !stationary) continue;
    for (let edge = start; edge < i; edge++) evidence[edge] = moving ? 'moving' : 'stationary';
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
