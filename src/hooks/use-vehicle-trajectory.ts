'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  buildReplayTimeline,
  findIgnitionEvents,
  findSpeedingEvents,
  findStops,
  frameAt,
} from '@/lib/engines/route-replay';
import type { LatLng, Position } from '@/types/core';
import type { RouteGeometry } from '@/types/views';

/**
 * Trayecto completo del dia (00:00 a 23:59) de un vehiculo seleccionado en el
 * mapa, con sus eventos (detenciones, exceso de velocidad, encendido y
 * apagado), listo para dibujarse sobre el mapa operacional en vivo.
 *
 * Reutiliza el mismo motor puro que la reproduccion de jornada
 * (`route-replay.ts`, ya usado en `/flota/[id]` y en la reproduccion de
 * ruta): la linea de tiempo y los eventos son siempre los mismos datos, se
 * miren desde donde se miren. `frameAt(timeline, timeline.endMs)` da el
 * recorrido completo del dia partido en tramos continuos (corta en cada
 * corte de señal, nunca dibuja una diagonal sobre casas o terrenos sin
 * evidencia vial: ver route-replay.ts).
 */

export type TrajectoryEventType = 'stop' | 'speeding' | 'ignition_on' | 'ignition_off';

export interface TrajectoryEvent {
  id: string;
  type: TrajectoryEventType;
  at: string;
  endedAt: string | null;
  position: LatLng;
  title: string;
  detail: string;
}

export interface VehicleTrajectory {
  route: RouteGeometry;
  events: TrajectoryEvent[];
  sampleCount: number;
  totalMeters: number;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function useVehicleTrajectory(
  vehicleId: string | null,
  vehiclePlate: string | null,
  maxLegalSpeedKmh: number,
) {
  const from = useMemo(() => startOfDay(new Date()).toISOString(), []);
  const to = useMemo(() => endOfDay(new Date()).toISOString(), []);

  const query = useQuery({
    queryKey: ['vehicle-trajectory', vehicleId, from],
    enabled: vehicleId !== null,
    staleTime: 30_000,
    // La jornada en curso sigue creciendo: se refresca sola sin que el
    // operador tenga que volver a seleccionar el vehiculo.
    refetchInterval: 60_000,
    queryFn: async ({ signal }): Promise<Position[]> => {
      const params = new URLSearchParams({ desde: from, hasta: to, limite: '20000' });
      const response = await fetch(
        `/api/gps/history/${encodeURIComponent(vehicleId!)}?${params.toString()}`,
        { signal },
      );
      if (!response.ok) throw new Error('No fue posible obtener el recorrido del vehiculo.');
      return (await response.json()) as Position[];
    },
  });

  const trajectory = useMemo((): VehicleTrajectory | null => {
    if (!vehicleId || !query.data) return null;
    const timeline = buildReplayTimeline(query.data);
    if (!timeline) return null;

    const frame = frameAt(timeline, timeline.endMs);

    const events: TrajectoryEvent[] = [];

    for (const stop of findStops(timeline)) {
      events.push({
        id: `stop:${stop.startedAt}`,
        type: 'stop',
        at: stop.startedAt,
        endedAt: stop.endedAt,
        position: stop.position,
        title: 'Detencion',
        detail: `Detenido ${Math.round(stop.durationSeconds / 60)} min`,
      });
    }

    for (const event of findIgnitionEvents(timeline)) {
      events.push({
        id: `${event.type}:${event.at}`,
        type: event.type,
        at: event.at,
        endedAt: null,
        position: event.position,
        title: event.type === 'ignition_on' ? 'Encendido' : 'Apagado',
        detail: event.type === 'ignition_on' ? 'Motor encendido' : 'Motor apagado',
      });
    }

    for (const event of findSpeedingEvents(timeline, maxLegalSpeedKmh)) {
      events.push({
        id: `speeding:${event.startedAt}`,
        type: 'speeding',
        at: event.startedAt,
        endedAt: event.endedAt,
        position: event.position,
        title: 'Exceso de velocidad',
        detail: `${event.maxSpeedKmh} km/h (limite ${maxLegalSpeedKmh} km/h)`,
      });
    }

    events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

    return {
      route: {
        routeId: `trayecto-${vehicleId}`,
        code: 'GPS',
        name: 'Trayecto del dia',
        vehicleId,
        vehiclePlate,
        status: 'en_curso',
        plannedPath: [],
        executedPath: frame.traveledPath,
        executedSegments: frame.traveledSegments,
        stops: [],
      },
      events,
      sampleCount: timeline.samples.length,
      totalMeters: frame.traveledMeters,
    };
  }, [vehicleId, vehiclePlate, maxLegalSpeedKmh, query.data]);

  return {
    trajectory,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
}
