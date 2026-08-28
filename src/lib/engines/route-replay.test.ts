import { describe, expect, it } from 'vitest';

import { buildReplayTimeline, findStops, frameAt } from './route-replay';
import type { DeviceId, Position, VehicleId } from '@/types/core';

const BASE = Date.parse('2026-08-27T12:00:00.000Z');

function pos(minutes: number, lat: number, lng: number, speed: number): Position {
  return {
    vehicleId: 'veh-1' as VehicleId,
    deviceId: 'dev-1' as DeviceId,
    timestamp: new Date(BASE + minutes * 60_000).toISOString(),
    lat,
    lng,
    speed,
    heading: 90,
    ignition: speed > 0 ? 'on' : 'off',
    valid: true,
  };
}

describe('reproduccion de ruta', () => {
  it('descarta las muestras que el equipo marco invalidas', () => {
    const sospechosa: Position = { ...pos(5, -20.0, -50.0, 40), valid: false };
    const timeline = buildReplayTimeline([
      pos(0, -33.45, -70.66, 40),
      sospechosa,
      pos(10, -33.44, -70.66, 40),
    ])!;

    expect(timeline.samples).toHaveLength(2);
    // Sin el descarte, el salto a -20/-50 sumaria miles de kilometros.
    expect(timeline.totalMeters).toBeLessThan(2000);
  });

  it('no arma linea de tiempo con menos de dos muestras', () => {
    expect(buildReplayTimeline([])).toBeNull();
    expect(buildReplayTimeline([pos(0, -33.45, -70.66, 0)])).toBeNull();
  });

  it('ordena las muestras aunque lleguen desordenadas', () => {
    const timeline = buildReplayTimeline([
      pos(10, -33.45, -70.64, 40),
      pos(0, -33.45, -70.66, 30),
      pos(5, -33.45, -70.65, 50),
    ]);

    expect(timeline).not.toBeNull();
    expect(timeline!.samples.map((s) => s.speed)).toEqual([30, 50, 40]);
    expect(timeline!.durationMs).toBe(10 * 60_000);
  });

  it('interpola la posicion entre dos muestras en vez de saltar', () => {
    const timeline = buildReplayTimeline([
      pos(0, -33.45, -70.66, 20),
      pos(10, -33.45, -70.64, 60),
    ])!;

    const mitad = frameAt(timeline, BASE + 5 * 60_000);

    // A mitad de camino, no en el extremo.
    expect(mitad.position.lng).toBeGreaterThan(-70.66);
    expect(mitad.position.lng).toBeLessThan(-70.64);
    expect(mitad.speed).toBeCloseTo(40, 0);
  });

  it('el eje es el tiempo, no el numero de muestra', () => {
    // Cinco muestras en el primer minuto y una a la hora: el instante medio
    // debe caer en la hora parada, no en la quinta muestra.
    const timeline = buildReplayTimeline([
      pos(0, -33.45, -70.66, 40),
      pos(0.25, -33.451, -70.66, 40),
      pos(0.5, -33.452, -70.66, 40),
      pos(0.75, -33.453, -70.66, 40),
      pos(1, -33.454, -70.66, 0),
      pos(61, -33.454, -70.66, 0),
    ])!;

    const medio = frameAt(timeline, timeline.startMs + timeline.durationMs / 2);
    expect(medio.sampleIndex).toBe(4);
    expect(medio.stopped).toBe(true);
  });

  it('acota el instante a los extremos de la jornada', () => {
    const timeline = buildReplayTimeline([
      pos(0, -33.45, -70.66, 10),
      pos(10, -33.44, -70.66, 10),
    ])!;

    expect(frameAt(timeline, timeline.startMs - 999_999).timestamp).toBe(
      new Date(timeline.startMs).toISOString(),
    );
    const fin = frameAt(timeline, timeline.endMs + 999_999);
    expect(fin.timestamp).toBe(new Date(timeline.endMs).toISOString());
    expect(fin.traveledMeters).toBeCloseTo(timeline.totalMeters, 0);
  });

  it('acumula la distancia recorrida de forma monotona', () => {
    const timeline = buildReplayTimeline([
      pos(0, -33.45, -70.66, 40),
      pos(5, -33.44, -70.66, 40),
      pos(10, -33.43, -70.66, 40),
    ])!;

    let previo = -1;
    for (let m = 0; m <= 10; m += 1) {
      const frame = frameAt(timeline, BASE + m * 60_000);
      expect(frame.traveledMeters).toBeGreaterThanOrEqual(previo);
      previo = frame.traveledMeters;
    }
    expect(previo).toBeCloseTo(timeline.totalMeters, 0);
  });

  it('la traza crece con el tiempo y nunca retrocede', () => {
    const timeline = buildReplayTimeline([
      pos(0, -33.45, -70.66, 40),
      pos(5, -33.44, -70.66, 40),
      pos(10, -33.43, -70.66, 40),
    ])!;

    const temprano = frameAt(timeline, BASE + 2 * 60_000).traveledPath.length;
    const tarde = frameAt(timeline, BASE + 9 * 60_000).traveledPath.length;
    expect(tarde).toBeGreaterThan(temprano);
  });

  it('detecta las detenciones largas y descarta las breves', () => {
    const timeline = buildReplayTimeline([
      pos(0, -33.45, -70.66, 40),
      pos(2, -33.45, -70.65, 0),
      pos(3, -33.45, -70.65, 40), // detencion de 1 minuto: se descarta
      pos(10, -33.44, -70.64, 0),
      pos(25, -33.44, -70.64, 0),
      pos(26, -33.44, -70.64, 30), // detencion de 15 minutos: se conserva
    ])!;

    const stops = findStops(timeline, 180);
    expect(stops).toHaveLength(1);
    expect(stops[0]?.durationSeconds).toBe(15 * 60);
  });

  it('cierra una detencion que sigue abierta al final de la jornada', () => {
    const timeline = buildReplayTimeline([
      pos(0, -33.45, -70.66, 40),
      pos(5, -33.45, -70.65, 0),
      pos(30, -33.45, -70.65, 0),
    ])!;

    const stops = findStops(timeline, 180);
    expect(stops).toHaveLength(1);
    expect(stops[0]?.durationSeconds).toBe(25 * 60);
  });
});
