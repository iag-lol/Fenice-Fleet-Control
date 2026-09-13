import { describe, expect, it } from 'vitest';

import { buildReplayTimeline, findIgnitionEvents, findStops, frameAt } from './route-replay';
import type { DeviceId, IgnitionState, Position, VehicleId } from '@/types/core';

const BASE = Date.parse('2026-08-27T12:00:00.000Z');

function pos(
  minutes: number,
  lat: number,
  lng: number,
  speed: number,
  ignition: IgnitionState = speed > 0 ? 'on' : 'off',
): Position {
  return {
    vehicleId: 'veh-1' as VehicleId,
    deviceId: 'dev-1' as DeviceId,
    timestamp: new Date(BASE + minutes * 60_000).toISOString(),
    lat,
    lng,
    speed,
    heading: 90,
    ignition,
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

  it('no interpola un corte de señal ni dibuja una diagonal entre muestras lejanas', () => {
    const timeline = buildReplayTimeline([
      pos(0, -33.45, -70.66, 20), pos(10, -33.45, -70.64, 60),
    ])!;
    const mitad = frameAt(timeline, BASE + 5 * 60_000);
    expect(mitad.position.lng).toBe(-70.66);
    expect(mitad.signalGap).toBe(true);
    expect(mitad.traveledSegments).toEqual([]);
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

  it('detecta encendido y apagado como transiciones, no como estado repetido', () => {
    const timeline = buildReplayTimeline([
      pos(0, -33.45, -70.66, 0, 'off'),
      pos(5, -33.45, -70.66, 0, 'on'), // encendido
      pos(6, -33.45, -70.66, 0, 'on'), // sigue encendido: no es un evento nuevo
      pos(20, -33.44, -70.65, 40, 'on'),
      pos(30, -33.44, -70.64, 0, 'off'), // apagado
    ])!;

    const eventos = findIgnitionEvents(timeline);
    expect(eventos).toHaveLength(2);
    expect(eventos[0]).toMatchObject({ type: 'ignition_on', at: new Date(BASE + 5 * 60_000).toISOString() });
    expect(eventos[1]).toMatchObject({ type: 'ignition_off', at: new Date(BASE + 30 * 60_000).toISOString() });
  });

  it('ignora las muestras sin dato de ignicion al buscar transiciones', () => {
    const timeline = buildReplayTimeline([
      pos(0, -33.45, -70.66, 0, 'off'),
      pos(5, -33.45, -70.66, 0, 'unknown'),
      pos(10, -33.45, -70.66, 40, 'on'), // primera confirmacion real: cuenta
    ])!;

    const eventos = findIgnitionEvents(timeline);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.type).toBe('ignition_on');
  });
});
