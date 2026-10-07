import { isContinuous, type ReplayTimeline } from './route-replay';
import { joinContinuousPaths } from '@/lib/gps-motion';
import type { LatLng } from '@/types/core';

export const JOURNEY_COLORS = {
  stopped: '#64748b',
  urban: '#0891b2',
  cruise: '#2563eb',
  speeding: '#dc2626',
};
export function speedColor(speed: number, limit: number): string {
  return speed > limit
    ? JOURNEY_COLORS.speeding
    : speed < 3
      ? JOURNEY_COLORS.stopped
      : speed < 30
        ? JOURNEY_COLORS.urban
        : JOURNEY_COLORS.cruise;
}
export interface JourneyGap {
  from: string;
  to: string;
  seconds: number;
  position: LatLng;
}
export interface JourneySummary {
  movingSeconds: number;
  stoppedSeconds: number;
  idleSeconds: number;
  unobservedSeconds: number;
  maxSpeed: number;
  averageMovingSpeed: number | null;
  coverage: number;
  gaps: JourneyGap[];
  speedSections: {
    path: LatLng[];
    color: string;
    startIndex: number;
    endIndex: number;
  }[];
}
/** Los tiempos solo se acumulan entre muestras continuas, nunca durante un corte. */
export function analyzeJourney(
  timeline: ReplayTimeline,
  limit: number,
): JourneySummary {
  const summary: JourneySummary = {
    movingSeconds: 0,
    stoppedSeconds: 0,
    idleSeconds: 0,
    unobservedSeconds: 0,
    maxSpeed: Math.max(...timeline.samples.map((p) => p.speed)),
    averageMovingSpeed: null,
    coverage: 0,
    gaps: [],
    speedSections: [],
  };
  let weightedSpeed = 0;
  for (let i = 1; i < timeline.samples.length; i++) {
    const previous = timeline.samples[i - 1]!,
      current = timeline.samples[i]!;
    const seconds =
      (Date.parse(current.timestamp) - Date.parse(previous.timestamp)) / 1000;
    if (!isContinuous(previous, current)) {
      summary.unobservedSeconds += seconds;
      summary.gaps.push({
        from: previous.timestamp,
        to: current.timestamp,
        seconds,
        position: { lat: previous.lat, lng: previous.lng },
      });
      continue;
    }
    if (previous.speed >= 3) {
      summary.movingSeconds += seconds;
      weightedSpeed += previous.speed * seconds;
    } else {
      summary.stoppedSeconds += seconds;
      if (previous.ignition === 'on') summary.idleSeconds += seconds;
    }
    const color = speedColor(previous.speed, limit);
    const path = timeline.continuousPaths[i - 1]!;
    const last = summary.speedSections.at(-1);
    if (
      last?.color === color &&
      last.endIndex === i - 1 &&
      last.path.at(-1)?.lat === path[0]?.lat &&
      last.path.at(-1)?.lng === path[0]?.lng
    ) {
      last.path.push(...path.slice(1));
      last.endIndex = i;
    } else
      summary.speedSections.push({
        path: [...path],
        color,
        startIndex: i - 1,
        endIndex: i,
      });
  }
  const observed = summary.movingSeconds + summary.stoppedSeconds;
  summary.coverage = observed / (timeline.durationMs / 1000);
  summary.averageMovingSpeed = summary.movingSeconds
    ? weightedSpeed / summary.movingSeconds
    : null;
  return summary;
}

export function exportJourneyGeoJson(timeline: ReplayTimeline, plate: string) {
  const segments = joinContinuousPaths(timeline.continuousPaths);
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          plate,
          from: new Date(timeline.startMs).toISOString(),
          to: new Date(timeline.endMs).toISOString(),
          samples: timeline.samples.length,
        },
        geometry: {
          type: 'MultiLineString',
          coordinates: segments.map((path) => path.map((p) => [p.lng, p.lat])),
        },
      },
    ],
  };
}

/** Recorta solo por muestras ya observadas; no agrega posiciones inferidas. */
export function sectionsThroughSample(
  timeline: ReplayTimeline,
  summary: JourneySummary,
  index: number,
) {
  return summary.speedSections.flatMap((section) => {
    if (section.endIndex <= index) return [section];
    if (section.startIndex >= index) return [];
    const paths = timeline.continuousPaths.slice(section.startIndex, index);
    return joinContinuousPaths(paths).map((path) => ({
            path,
            color: section.color,
            startIndex: section.startIndex,
            endIndex: index,
          }));
  });
}

/** Reduce el grafico conservando los picos y los cortes de continuidad. */
export function buildSpeedProfile(timeline: ReplayTimeline, budget = 600) {
  const segments: (typeof timeline.samples)[] = [];
  let segment: typeof timeline.samples = [];
  timeline.samples.forEach((sample, i) => {
    if (i && !timeline.continuousPaths[i - 1]?.length) {
      if (segment.length) segments.push(segment);
      segment = [];
    }
    segment.push(sample);
  });
  if (segment.length) segments.push(segment);
  const step = Math.max(
    1,
    Math.ceil(timeline.samples.length / Math.max(1, budget)),
  );
  return segments.map((samples) => {
    const indices = new Set([0, samples.length - 1]);
    for (let i = 0; i < samples.length; i += step) {
      let low = i,
        high = i;
      for (let j = i; j < Math.min(samples.length, i + step); j++) {
        if (samples[j]!.speed < samples[low]!.speed) low = j;
        if (samples[j]!.speed > samples[high]!.speed) high = j;
      }
      indices.add(low);
      indices.add(high);
    }
    return [...indices].sort((a, b) => a - b).map((index) => samples[index]!);
  });
}
