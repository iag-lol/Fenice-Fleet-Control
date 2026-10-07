'use client';
import { useQuery } from '@tanstack/react-query';
import { JourneyExplorer } from '@/components/gps/journey-explorer';
import { toRouteGeometryClient } from '@/components/routes/route-geometry';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { systemModeQuery } from '@/hooks/use-control-data';
import type { Position, Route, Vehicle } from '@/types/core';

export function RouteReplay({
  route,
  vehicle,
}: {
  route: Route;
  vehicle: Vehicle | null;
}) {
  const { data: mode } = useQuery(systemModeQuery);
  const { data, isLoading, error } = useQuery({
    queryKey: ['route-replay', route.id, vehicle?.id],
    enabled: vehicle !== null,
    staleTime: 60_000,
    queryFn: async ({ signal }): Promise<Position[]> => {
      const to = route.completedAt ?? new Date().toISOString();
      const from =
        route.startedAt ??
        new Date(Date.parse(to) - 12 * 3_600_000).toISOString();
      const params = new URLSearchParams({
        desde: from,
        hasta: to,
        limite: '20000',
      });
      const response = await fetch(
        `/api/gps/history/${encodeURIComponent(vehicle!.id)}?${params}`,
        { signal },
      );
      if (!response.ok)
        throw new Error('No fue posible obtener el historial GPS de la ruta.');
      return response.json();
    },
  });
  if (vehicle && data && !error)
    return (
      <JourneyExplorer
        positions={data}
        vehicle={vehicle}
        plannedRoute={toRouteGeometryClient(route, vehicle.plate)}
        speedLimit={mode?.settings.route.maxLegalSpeedKmh ?? 60}
      />
    );
  return (
    <Card>
      <CardHeader title="Explorador de la jornada" />
      <CardBody>
        {isLoading && vehicle ? (
          <Skeleton className="h-[440px]" />
        ) : (
          <EmptyState
            compact
            title={
              error
                ? 'No fue posible cargar el recorrido'
                : 'Esta ruta no tiene vehículo asignado'
            }
            description={
              error
                ? (error as Error).message
                : 'Asigna un vehículo para revisar su historial GPS y compararlo con la ruta planificada.'
            }
          />
        )}
      </CardBody>
    </Card>
  );
}
