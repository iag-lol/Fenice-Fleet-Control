'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { CalendarDays, RefreshCw, Route } from 'lucide-react';
import { JourneyExplorer } from '@/components/gps/journey-explorer';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { systemModeQuery } from '@/hooks/use-control-data';
import type { Position, Vehicle } from '@/types/core';
import type { RouteGeometry } from '@/types/views';

function localTime(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}
function recentRange() {
  const to = new Date();
  return {
    from: new Date(to.getTime() - 8 * 3_600_000).toISOString(),
    to: to.toISOString(),
  };
}

export function VehicleHistory({
  vehicle,
  plannedRoute,
}: {
  vehicle: Vehicle;
  plannedRoute?: RouteGeometry;
}) {
  const { data: mode } = useQuery(systemModeQuery);
  const [range, setRange] = useState(recentRange);
  const [from, setFrom] = useState(() => localTime(new Date(range.from)));
  const [to, setTo] = useState(() => localTime(new Date(range.to)));
  const [validation, setValidation] = useState<string | null>(null);
  const { data, isFetching, isLoading, error, refetch } = useQuery({
    queryKey: ['vehicle-history', vehicle.id, range],
    staleTime: 60_000,
    queryFn: async ({ signal }): Promise<Position[]> => {
      const params = new URLSearchParams({
        desde: range.from,
        hasta: range.to,
        limite: '20000',
      });
      const response = await fetch(
        `/api/gps/history/${encodeURIComponent(vehicle.id)}?${params}`,
        { signal },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(
          body?.error ?? 'No se pudo consultar el historial GPS.',
        );
      }
      return response.json();
    },
  });
  const chooseRange = (start: Date, end: Date) => {
    setFrom(localTime(start));
    setTo(localTime(end));
    setValidation(null);
    setRange({ from: start.toISOString(), to: end.toISOString() });
  };
  const preset = (name: 'today' | 'yesterday' | '2h' | '8h') => {
    const now = new Date();
    if (name === '2h' || name === '8h')
      chooseRange(
        new Date(now.getTime() - (name === '2h' ? 2 : 8) * 3_600_000),
        now,
      );
    else {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      if (name === 'today') chooseRange(start, now);
      else {
        const end = new Date(start);
        start.setDate(start.getDate() - 1);
        chooseRange(start, end);
      }
    }
  };
  const load = () => {
    const start = Date.parse(from),
      end = Date.parse(to);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start >= end ||
      end - start > 72 * 3_600_000
    ) {
      setValidation('Elige un rango válido de hasta 72 horas.');
      return;
    }
    setValidation(null);
    const next = {
      from: new Date(start).toISOString(),
      to: new Date(end).toISOString(),
    };
    if (range.from === next.from && range.to === next.to) void refetch();
    else setRange(next);
  };
  return (
    <Card id="historial-gps" className="scroll-mt-20 overflow-hidden">
      <CardHeader
        title="Historial y análisis GPS"
        description="Explora la jornada, cruza velocidad y eventos y reproduce el movimiento sobre el mapa."
        icon={<Route className="h-4 w-4" />}
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            className="flex flex-wrap gap-1.5"
            role="group"
            aria-label="Periodos del historial"
          >
            {(
              [
                ['today', 'Hoy'],
                ['yesterday', 'Ayer'],
                ['2h', 'Últimas 2 h'],
                ['8h', 'Últimas 8 h'],
              ] as const
            ).map(([key, label]) => (
              <Button
                key={key}
                size="sm"
                variant="secondary"
                disabled={isFetching}
                onClick={() => preset(key)}
              >
                {label}
              </Button>
            ))}
          </div>
          <p className="flex items-center gap-1.5 text-[10px] text-ink-faint">
            <CalendarDays className="h-3.5 w-3.5" />
            Horario de {Intl.DateTimeFormat().resolvedOptions().timeZone}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface-900 p-3">
          <label className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">
            Desde
            <input
              type="datetime-local"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 block h-9 rounded border border-line bg-surface-850 px-2 text-xs text-ink"
            />
          </label>
          <label className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">
            Hasta
            <input
              type="datetime-local"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 block h-9 rounded border border-line bg-surface-850 px-2 text-xs text-ink"
            />
          </label>
          <Button
            size="sm"
            onClick={load}
            loading={isFetching}
            icon={<RefreshCw className="h-3.5 w-3.5" />}
          >
            Consultar recorrido
          </Button>
          {isFetching && !isLoading ? (
            <p role="status" className="text-xs text-ink-faint">
              Actualizando el periodo…
            </p>
          ) : null}
        </div>
        {validation || error ? (
          <p
            role="alert"
            className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"
          >
            {validation ?? (error as Error).message}
          </p>
        ) : null}
        {isLoading ? (
          <Skeleton className="h-[500px]" />
        ) : data ? (
          <JourneyExplorer
            key={`${vehicle.id}:${range.from}:${range.to}`}
            positions={data}
            vehicle={vehicle}
            plannedRoute={plannedRoute}
            speedLimit={mode?.settings.route.maxLegalSpeedKmh ?? 60}
          />
        ) : null}
      </CardBody>
    </Card>
  );
}
