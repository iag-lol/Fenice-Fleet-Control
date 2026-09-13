'use client';

import { useQuery } from '@tanstack/react-query';
import { Gauge, Pause, Play, RotateCcw, SkipBack, SkipForward, Square } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { FleetMap } from '@/components/map/fleet-map';
import { toRouteGeometryClient } from '@/components/routes/route-geometry';
import { Card, CardHeader } from '@/components/ui/card';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  buildReplayTimeline,
  findStops,
  frameAt,
  type ReplayFrame,
} from '@/lib/engines/route-replay';
import { formatDistance, formatDuration, formatSpeed, formatTimeWithSeconds } from '@/lib/format';
import type { Position, Route, Vehicle } from '@/types/core';

/**
 * Reproduccion de la jornada de una ruta.
 *
 * Responde a la pregunta que la operacion hace todos los dias: "¿que paso
 * realmente con este camion?". Por eso el eje es el tiempo y no la secuencia
 * de muestras, y por eso las detenciones son saltos directos: lo que se
 * revisa son las paradas, no los tramos en marcha.
 */

const SPEEDS = [1, 2, 4, 8, 16] as const;
type Speed = (typeof SPEEDS)[number];

/** Cada segundo real avanza estos minutos de jornada a velocidad 1x. */
const MINUTES_PER_SECOND = 1;

export function RouteReplay({
  route,
  vehicle,
}: {
  route: Route;
  vehicle: Vehicle | null;
}) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(4);
  const [cursorMs, setCursorMs] = useState<number | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['route-replay', route.id, vehicle?.id],
    enabled: vehicle !== null,
    // El historial de una jornada cerrada no cambia; el de una en curso se
    // refresca solo cuando el usuario vuelve a la pantalla.
    staleTime: 60_000,
    queryFn: async (): Promise<Position[]> => {
      const to = route.completedAt ?? new Date().toISOString();
      const from = route.startedAt ?? new Date(Date.parse(to) - 12 * 3_600_000).toISOString();
      const params = new URLSearchParams({ desde: from, hasta: to, limite: '1500' });
      const response = await fetch(`/api/gps/history/${vehicle!.id}?${params.toString()}`);
      if (!response.ok) throw new Error('No fue posible obtener el historial.');
      return (await response.json()) as Position[];
    },
  });

  const timeline = useMemo(() => (data ? buildReplayTimeline(data) : null), [data]);
  const stops = useMemo(() => (timeline ? findStops(timeline) : []), [timeline]);

  // Al cargar, el cursor arranca al principio de la jornada.
  useEffect(() => {
    if (timeline) setCursorMs(timeline.startMs);
  }, [timeline]);

  const frame: ReplayFrame | null =
    timeline && cursorMs !== null ? frameAt(timeline, cursorMs) : null;

  // --- Bucle de reproduccion ------------------------------------------------
  //
  // Se avanza por tiempo real transcurrido y no por numero de cuadros: si el
  // navegador se ralentiza o la pestana pasa a segundo plano, la
  // reproduccion no se descompensa respecto al reloj.
  const lastTick = useRef<number>(0);
  useEffect(() => {
    if (!playing || !timeline) return;

    let raf = 0;
    lastTick.current = performance.now();

    const step = (now: number) => {
      const elapsed = now - lastTick.current;
      lastTick.current = now;

      setCursorMs((current) => {
        if (current === null) return current;
        const next = current + (elapsed / 1000) * MINUTES_PER_SECOND * 60_000 * speed;
        if (next >= timeline.endMs) {
          setPlaying(false);
          return timeline.endMs;
        }
        return next;
      });
      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, timeline]);

  const jumpToStop = useCallback(
    (direction: 1 | -1) => {
      if (!timeline || cursorMs === null || stops.length === 0) return;
      const times = stops.map((stop) => Date.parse(stop.startedAt));
      const target =
        direction === 1
          ? times.find((t) => t > cursorMs + 1000)
          : [...times].reverse().find((t) => t < cursorMs - 1000);
      setCursorMs(target ?? (direction === 1 ? timeline.endMs : timeline.startMs));
    },
    [cursorMs, stops, timeline],
  );

  if (vehicle === null) {
    return (
      <Card>
        <CardHeader title="Reproduccion de la jornada" />
        <div className="p-4">
          <EmptyState
            compact
            title="Esta ruta no tiene vehiculo asignado"
            description="La reproduccion se construye con el historial GPS del camion que la ejecuta."
          />
        </div>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader title="Reproduccion de la jornada" />
        <Skeleton className="m-4 h-[380px]" />
      </Card>
    );
  }

  if (isError || !timeline || !frame || cursorMs === null) {
    return (
      <Card>
        <CardHeader title="Reproduccion de la jornada" />
        <div className="p-4">
          <EmptyState
            compact
            title="Todavia no hay recorrido que reproducir"
            description={
              isError
                ? 'No fue posible leer el historial GPS de este vehiculo.'
                : 'Se necesitan al menos dos posiciones registradas en la ventana de la ruta.'
            }
          />
        </div>
      </Card>
    );
  }

  const progress = (cursorMs - timeline.startMs) / timeline.durationMs;

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Reproduccion de la jornada"
        description={`${formatTimeWithSeconds(new Date(timeline.startMs).toISOString())} a ${formatTimeWithSeconds(new Date(timeline.endMs).toISOString())} · ${timeline.samples.length} posiciones · ${stops.length} detenciones`}
      />

      <div className="relative h-[340px] sm:h-[420px]">
        <ErrorBoundary section="la reproduccion de la ruta">
          <FleetMap
            className="absolute inset-0"
            autoFit
            minimalControls
            layerOverride={{
              rutas: true,
              camiones: true,
              clientes: false,
              geocercas: true,
              calor: false,
              pedidos: true,
              alertas: false,
              comunas: false,
            }}
            vehicles={[
              {
                vehicleId: vehicle.id,
                plate: vehicle.plate,
                fleetCode: vehicle.fleetCode,
                status: frame.stopped ? 'stopped' : 'moving',
                position: {
                  ...timeline.samples[frame.sampleIndex]!,
                  lat: frame.position.lat,
                  lng: frame.position.lng,
                  speed: frame.speed,
                  timestamp: frame.timestamp,
                },
              },
            ]}
            routes={[
              {
                // La traza ejecutada se recorta al instante reproducido: ver
                // el recorrido completo desde el primer cuadro anularia el
                // sentido de reproducirlo.
                ...toRouteGeometryClient(route, vehicle.plate),
                executedPath: frame.traveledPath,
                executedSegments: frame.traveledSegments,
              },
            ]}
            clients={[]}
            geofences={[]}
            alerts={[]}
            workOrders={[]}
            communes={[]}
            heatmapPoints={[]}
          />
        </ErrorBoundary>
      </div>

      <div className="border-t border-line bg-surface-900 p-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px]">
          <span className="numeric font-semibold text-ink">
            {formatTimeWithSeconds(frame.timestamp)}
          </span>
          <span className="numeric text-ink-muted">{formatSpeed(frame.speed)}</span>
          <span className="numeric text-ink-muted">
            {formatDistance(frame.traveledMeters)}{' '}
            <span className="text-ink-faint">de {formatDistance(timeline.totalMeters)}</span>
          </span>
          {frame.signalGap ? <span className="text-status-warning">Sin muestras en este intervalo</span> : null}
          {frame.stopped ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-status-warning/12 px-2 py-0.5 text-2xs font-semibold text-status-warning">
              <Square className="h-3 w-3" /> Detenido
            </span>
          ) : null}
        </div>

        {/*
          Avance y detenciones van en franjas separadas.

          Superponerlos en la misma barra mezcla dos lecturas distintas — donde
          voy y donde estuvo parado — y el color resultante no significa nada.
        */}
        <div className="relative mt-2.5">
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-surface-750">
            <div
              className="h-full rounded-full bg-brand-500"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <input
            type="range"
            min={timeline.startMs}
            max={timeline.endMs}
            step={1000}
            value={cursorMs}
            onChange={(event) => {
              setPlaying(false);
              setCursorMs(Number(event.target.value));
            }}
            aria-label="Instante de la jornada"
            className="relative h-11 w-full cursor-pointer appearance-none bg-transparent sm:h-8 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-brand-600 [&::-webkit-slider-thumb]:shadow-card"
          />
        </div>

        {stops.length > 0 ? (
          <div className="-mt-1 mb-1.5 flex items-center gap-2">
            <span className="shrink-0 text-2xs text-ink-faint">Detenciones</span>
            <div className="relative h-3 flex-1">
              <div className="absolute inset-x-0 top-1 h-1 rounded-full bg-surface-800" />
            {stops.map((stop) => {
              const left = ((Date.parse(stop.startedAt) - timeline.startMs) / timeline.durationMs) * 100;
              const width = Math.max(
                0.8,
                ((Date.parse(stop.endedAt) - Date.parse(stop.startedAt)) / timeline.durationMs) * 100,
              );
              return (
                <span
                  key={stop.startedAt}
                  title={`Detenido ${formatDuration(stop.durationSeconds)}`}
                  className="absolute top-1 h-1 rounded-full bg-status-warning"
                  style={{ left: `${left}%`, width: `${width}%` }}
                />
              );
            })}
            </div>
          </div>
        ) : null}

        <div className="mt-1 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (cursorMs >= timeline.endMs) setCursorMs(timeline.startMs);
              setPlaying((p) => !p);
            }}
            aria-label={playing ? 'Pausar' : 'Reproducir'}
            className="flex h-11 w-11 items-center justify-center rounded-md bg-brand-600 text-white hover:bg-brand-700 sm:h-9 sm:w-9"
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={() => jumpToStop(-1)}
            disabled={stops.length === 0}
            aria-label="Detencion anterior"
            className="flex h-11 w-11 items-center justify-center rounded-md border border-line-strong text-ink-muted hover:text-ink disabled:opacity-40 sm:h-9 sm:w-9"
          >
            <SkipBack className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => jumpToStop(1)}
            disabled={stops.length === 0}
            aria-label="Detencion siguiente"
            className="flex h-11 w-11 items-center justify-center rounded-md border border-line-strong text-ink-muted hover:text-ink disabled:opacity-40 sm:h-9 sm:w-9"
          >
            <SkipForward className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setPlaying(false);
              setCursorMs(timeline.startMs);
            }}
            aria-label="Volver al inicio"
            className="flex h-11 w-11 items-center justify-center rounded-md border border-line-strong text-ink-muted hover:text-ink sm:h-9 sm:w-9"
          >
            <RotateCcw className="h-4 w-4" />
          </button>

          <div className="ml-auto flex items-center gap-1">
            <Gauge className="h-3.5 w-3.5 text-ink-faint" />
            {SPEEDS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setSpeed(option)}
                className={`numeric h-11 min-w-11 rounded-md border px-2 text-xs font-semibold transition-colors sm:h-8 sm:min-w-8 ${
                  speed === option
                    ? 'border-brand-500 bg-brand-500/10 text-ink'
                    : 'border-line-strong text-ink-faint hover:text-ink'
                }`}
              >
                {option}x
              </button>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}
