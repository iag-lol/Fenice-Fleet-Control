import { describe, expect, it } from 'vitest';
import { buildEvidenceTimeline, hasJourneyEvidence } from './gps-evidence';
import { frameAt, findStops, findSpeedingEvents } from './route-replay';
import { analyzeJourney, exportJourneyGeoJson } from './journey-analysis';
import type { Position } from '@/types/core';
const base = Date.parse('2026-10-08T12:00:00Z');
const p = (seconds: number, meters: number, speed = 0, extra: Partial<Position> = {}): Position => ({
  vehicleId: 'test' as Position['vehicleId'], deviceId: 'gps-test' as Position['deviceId'],
  timestamp: new Date(base + seconds * 1000).toISOString(), lat: -33.45 + meters / 111195, lng: -70.66,
  speed, ignition: 'on', heading: 0, valid: true, simulated: false, ...extra,
});

describe('evidencia de movimiento GPS', () => {
  it('conserva lecturas dispersas y dos velocidades aisladas sin convertirlas en recorrido, distancia o detenciones', () => {
    const samples = [p(0, 0), p(169, 200, 21), p(175, 162, 11), p(178, 143), p(238, 0),
      p(478, 30), p(658, 5), p(778, -20), p(898, 15), p(1018, -35), p(1138, -30), p(1198, -50)];
    const timeline = buildEvidenceTimeline(samples)!;
    expect(timeline.samples).toEqual(samples);
    expect(timeline.totalMeters).toBe(0);
    expect(hasJourneyEvidence(timeline)).toBe(false);
    expect(frameAt(timeline, timeline.endMs).traveledSegments).toEqual([]);
    expect(frameAt(timeline, timeline.endMs).traveledPath).toEqual([]);
    expect(frameAt(timeline, timeline.endMs).signalGap).toBe(true);
    expect(frameAt(timeline, timeline.endMs).stopped).toBe(false);
    expect(findStops(timeline)).toEqual([]);
    const summary = analyzeJourney(timeline, 60);
    expect(summary.movingSeconds).toBe(0);
    expect(summary.stoppedSeconds).toBe(0);
    expect(summary.coverage).toBe(0);
    expect(summary.unobservedSeconds).toBe(1198);
    expect(exportJourneyGeoJson(timeline, 'TEST').features[0]!.geometry.coordinates).toEqual([]);
  });
  it('acepta tres lecturas de marcha coherentes y calcula sólo distancia entre mediciones', () => {
    const timeline = buildEvidenceTimeline([p(0, 0, 36), p(15, 150, 36), p(30, 300, 36)])!;
    expect(timeline.evidence).toEqual(['moving', 'moving']);
    expect(timeline.totalMeters).toBeCloseTo(300, 0);
    expect(analyzeJourney(timeline, 60).movingSeconds).toBe(30);
    expect(timeline.roadMatchedMeters).toBe(0);
    expect(frameAt(timeline, base + 7000).position.lat).toBe(timeline.samples[0]!.lat);
  });
  it('acepta marcha sostenida con reportes cada cinco segundos sin exigir tres puntos separados artificialmente', () => {
    const timeline = buildEvidenceTimeline(Array.from({ length: 7 }, (_, i) => p(i * 5, i * 50, 36)))!;
    expect(timeline.evidence).toEqual(Array(6).fill('moving'));
    expect(timeline.totalMeters).toBeCloseTo(300, 0);
    expect(analyzeJourney(timeline, 60).movingSeconds).toBe(30);
  });
  it('reconoce reposo con reportes de un segundo y mantiene la deriva fuera de la distancia', () => {
    const timeline = buildEvidenceTimeline(Array.from({ length: 181 }, (_, i) => p(i, i % 3)))!;
    expect(timeline.evidence?.every((s) => s === 'stationary')).toBe(true);
    expect(findStops(timeline)[0]!.durationSeconds).toBe(180);
    expect(timeline.totalMeters).toBe(0);
  });
  it('el reposo consistente no suma deriva y un salto posterior no prolonga una detención', () => {
    const timeline = buildEvidenceTimeline([p(0, 0), p(30, 3), p(60, -2), p(90, 1), p(120, 2), p(150, 3), p(180, 0), p(210, 200)])!;
    expect(timeline.totalMeters).toBe(0);
    expect(findStops(timeline)).toHaveLength(1);
    expect(findStops(timeline)[0]!.durationSeconds).toBe(180);
    expect(analyzeJourney(timeline, 60).unobservedSeconds).toBe(30);
    expect(frameAt(timeline, timeline.endMs).traveledSegments).toEqual([]);
  });
  it.each([
    [p(0, 0, 36), p(15, 150, 36), p(30, 300, 36, { historyGapBefore: true })],
    [p(0, 0, 36), p(15, 150, 36), p(30, 300, 36, { accuracy: 80 })],
    [p(0, 0, 36), p(15, 150, 36), p(30, 300, 36, { deviceId: 'new' as Position['deviceId'] })],
    [p(0, 0, 36), p(15, 150, 36), p(90, 300, 36)],
    [p(0, 0, 36), p(15, 150, 36), p(30, 0, 36)],
    [p(0, 0, 36), p(15, 1500, 36), p(30, 3000, 36)],
    [p(0, 0, 36), p(15, 150, NaN), p(30, 300, 36)],
    [p(0, 0, 0, { speedKnown: false }), p(30, 0, 0, { speedKnown: false }), p(60, 0, 0, { speedKnown: false })],
  ])('rechaza cortes, mala precisión, cambio de equipo, retornos erráticos y velocidades incompatibles (%#)', (...samples) => {
    expect(buildEvidenceTimeline(samples)!.evidence).toEqual(['uncertain', 'uncertain']);
  });
  it('no transforma un pico aislado de velocidad en una infracción', () => {
    const timeline = buildEvidenceTimeline([p(0, 0), p(30, 2, 100), p(60, 0)])!;
    expect(findSpeedingEvents(timeline, 60)).toEqual([]);
  });
});
