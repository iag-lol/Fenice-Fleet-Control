import { describe, expect, it } from 'vitest';
import {
  analyzeJourney,
  buildSpeedProfile,
  exportJourneyGeoJson,
  sectionsThroughSample,
  speedColor,
} from './journey-analysis';
import {
  buildReplayTimeline,
  findStops,
  findSpeedingEvents,
  frameAt,
} from './route-replay';
import type { Position } from '@/types/core';
import { polylineLengthMeters } from '@/lib/geo';
const start = Date.parse('2026-10-07T12:00:00Z');
function position(seconds: number, speed = 0, lat = -33.45): Position {
  return {
    vehicleId: 'v1' as Position['vehicleId'],
    deviceId: 'd1' as Position['deviceId'],
    timestamp: new Date(start + seconds * 1000).toISOString(),
    lat,
    lng: -70.66,
    speed,
    heading: 90,
    ignition: 'on',
    valid: true,
  };
}
describe('analisis de recorridos observados', () => {
  it('no recorta el primer vértice ajustado ni une ajustes con extremos distintos', () => {
    const a = position(0, 30);
    const b = { ...position(30, 30, -33.449), lng: -70.659 };
    b.roadMatch = { fromTimestamp: a.timestamp, confidence: .95, path: [
      { lat: a.lat, lng: a.lng + .0001 }, { lat: a.lat, lng: b.lng }, { lat: b.lat, lng: b.lng },
    ] };
    const c = { ...position(60, 30, -33.448), lng: -70.658, roadMatch: {
      fromTimestamp: b.timestamp, confidence: .95, path: [
        { lat: b.lat + .0001, lng: b.lng }, { lat: b.lat + .0001, lng: -70.658 }, { lat: -33.448, lng: -70.658 },
      ],
    } };
    const timeline = buildReplayTimeline([a, b, c])!;
    const expected = [b.roadMatch.path, c.roadMatch.path];
    expect(frameAt(timeline, timeline.endMs).traveledSegments).toEqual(expected);
    expect(timeline.totalMeters).toBeCloseTo(expected.reduce((sum, path) => sum + polylineLengthMeters(path), 0));
    expect(timeline.roadMatchedMeters).toBe(timeline.totalMeters);
    expect(exportJourneyGeoJson(timeline, 'RBDC59').features[0]!.geometry.coordinates)
      .toEqual(expected.map((path) => path.map((p) => [p.lng, p.lat])));
    expect(frameAt(timeline, timeline.startMs + 15000).traveledSegments[0]?.[0]).toEqual(b.roadMatch.path[0]);
  });
  it('no agrega kilómetros por deriva estacionaria, pero conserva desplazamientos lentos', () => {
    const a = position(0), b = position(15, 0, -33.45005);
    expect(buildReplayTimeline([a, b])!.totalMeters).toBe(0);
    expect(buildReplayTimeline([{ ...a, speed: 2 }, { ...b, speed: 2 }])!.totalMeters).toBeGreaterThan(5);
  });
  it('un fix inválido intermedio corta el trazo aunque el intervalo sea corto', () => {
    const timeline = buildReplayTimeline([position(0, 30), { ...position(15, 30), valid: false }, position(30, 30, -33.449)])!;
    expect(timeline.samples).toHaveLength(2);
    expect(timeline.totalMeters).toBe(0);
    expect(analyzeJourney(timeline, 60).unobservedSeconds).toBe(30);
    expect(frameAt(timeline, timeline.endMs).traveledSegments).toEqual([]);
  });
  it('no considera una detención prolongada si las coordenadas recorren más de 50 metros', () => {
    const positions = Array.from({ length: 15 }, (_, i) => position(i * 30, 0, -33.45 + i * .0003));
    expect(findStops(buildReplayTimeline(positions)!)).toEqual([]);
  });
  it('distingue movimiento, detencion y periodos sin datos', () => {
    const timeline = buildReplayTimeline([
      position(0),
      position(15, 20),
      position(30, 80),
      { ...position(600), ignition: 'off' },
      position(615),
    ])!;
    const summary = analyzeJourney(timeline, 60);
    expect(summary).toMatchObject({
      movingSeconds: 15,
      stoppedSeconds: 30,
      idleSeconds: 15,
      unobservedSeconds: 570,
      maxSpeed: 80,
      averageMovingSpeed: 20,
    });
    expect(summary.coverage).toBeCloseTo(45 / 615);
    expect(summary.gaps).toHaveLength(1);
  });
  it('no cuenta un corte como una detencion ni como exceso continuo', () => {
    expect(
      findStops(
        buildReplayTimeline([position(0), position(600), position(615)])!,
      ),
    ).toEqual([]);
    expect(
      findSpeedingEvents(
        buildReplayTimeline([
          position(0, 80),
          position(600, 80),
          position(615, 0),
        ])!,
        60,
      ),
    ).toEqual([]);
  });
  it('un salto GPS imposible no suma distancia y aparece como falta de continuidad', () => {
    const timeline = buildReplayTimeline([
      position(0, 40),
      position(15, 40, -25),
    ])!;
    expect(timeline.totalMeters).toBe(0);
    expect(frameAt(timeline, start + 5000).signalGap).toBe(true);
    expect(analyzeJourney(timeline, 60).coverage).toBe(0);
  });
  it('conserva giros y distancia de un ajuste vial confiable', () => {
    const first = position(0, 30);
    const next = {
      ...position(30, 30, -33.449),
      lng: -70.659,
      roadMatch: {
        fromTimestamp: first.timestamp,
        confidence: 0.95,
        path: [
          { lat: first.lat, lng: first.lng },
          { lat: -33.45, lng: -70.659 },
          { lat: -33.449, lng: -70.659 },
        ],
      },
    };
    const timeline = buildReplayTimeline([first, next])!;
    expect(frameAt(timeline, timeline.endMs).traveledSegments[0]).toHaveLength(
      3,
    );
    expect(frameAt(timeline, start + 15000).traveledMeters).toBeCloseTo(
      timeline.totalMeters / 2,
    );
  });
  it('el GeoJSON conserva los cortes sin unir coordenadas alejadas', () => {
    const timeline = buildReplayTimeline([
      position(0, 10),
      position(15, 10, -33.4499),
      position(600, 10, -33.44),
      position(615, 10, -33.4399),
    ])!;
    const geo = exportJourneyGeoJson(timeline, 'RBDC59');
    expect(geo.features[0]?.geometry.coordinates).toHaveLength(2);
    expect(geo.features[0]?.geometry.coordinates[0]?.[0]).toEqual([
      -70.66, -33.45,
    ]);
  });
  it('recorta los colores al instante observado sin cambiar la geometria completa', () => {
    const timeline = buildReplayTimeline([
      position(0, 40),
      position(15, 40, -33.4499),
      position(30, 40, -33.4498),
    ])!;
    const summary = analyzeJourney(timeline, 60);
    expect(sectionsThroughSample(timeline, summary, 0)).toEqual([]);
    expect(sectionsThroughSample(timeline, summary, 1)[0]?.path).toHaveLength(
      2,
    );
    expect(summary.speedSections[0]?.path).toHaveLength(3);
  });
  it('el grafico conserva el pico aun al reducir muchas muestras', () => {
    const timeline = buildReplayTimeline(
      Array.from({ length: 30 }, (_, i) => position(i * 15, i === 7 ? 96 : 30)),
    )!;
    expect(
      buildSpeedProfile(timeline, 2)
        .flat()
        .some((sample) => sample.speed === 96),
    ).toBe(true);
    expect(buildSpeedProfile(timeline, 2).flat().length).toBeLessThan(30);
  });
  it('respeta el umbral configurado y no marca su valor exacto como exceso', () => {
    expect(speedColor(60, 60)).not.toBe(speedColor(61, 60));
    expect(speedColor(61, 80)).toBe(speedColor(60, 60));
  });
});
