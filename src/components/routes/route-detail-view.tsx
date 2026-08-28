'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, MapPin, Truck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { DetailList } from '@/components/common/detail-list';
import { Stat } from '@/components/common/kpi';
import { PageHeader } from '@/components/common/page-header';
import { RouteProgress } from '@/components/common/progress';
import { WorkOrderStatusBadge } from '@/components/common/status';
import { FleetMap } from '@/components/map/fleet-map';
import { toRouteGeometryClient } from '@/components/routes/route-geometry';
import { FeatureGate } from '@/components/product/feature-gate';
import { DriverLinkAction } from '@/features/medium/driver-portal/driver-link-action';
import { RouteReplay } from '@/features/medium/route-replay/route-replay';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { QueryError } from '@/components/ui/query-state';
import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';
import { useLiveFleet } from '@/hooks/use-live-fleet';
import { formatKm, formatSmartDateTime, formatTime } from '@/lib/format';
import { useMapStore } from '@/stores/map-store';
import type { Driver, Route, Vehicle, WorkOrder } from '@/types/core';

interface RouteDetailResponse {
  route: Route;
  vehicle: Vehicle | null;
  driver: Driver | null;
  workOrders: WorkOrder[];
}

/** Ruta completa: corredor planificado, traza ejecutada y avance por parada. */
export function RouteDetailView({ routeId }: { routeId: string }) {
  const router = useRouter();
  const { positions } = useLiveFleet();
  const focusOn = useMapStore((s) => s.focusOn);
  const highlightRoute = useMapStore((s) => s.highlightRoute);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['route', routeId],
    refetchInterval: 45_000,
    queryFn: async (): Promise<RouteDetailResponse> => {
      const response = await fetch(`/api/rutas/${routeId}`);
      if (response.status === 404) throw new Error('La ruta solicitada no existe.');
      if (!response.ok) throw new Error('No fue posible obtener la ruta.');
      return (await response.json()) as RouteDetailResponse;
    },
  });

  if (isError) {
    return (
      <>
        <PageHeader
          title="Detalle de ruta"
          breadcrumb={
            <Link href="/rutas" className="inline-flex items-center gap-1 hover:text-ink">
              <ArrowLeft className="h-3 w-3" /> Volver a rutas
            </Link>
          }
        />
        <QueryError
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => void refetch()}
        />
      </>
    );
  }

  if (isLoading || !data) {
    return (
      <>
        <PageHeader title="Detalle de ruta" />
        <div className="space-y-4">
          <Skeleton className="h-72 w-full" />
          <SkeletonRows rows={6} />
        </div>
      </>
    );
  }

  const { route, vehicle, driver } = data;
  const geometry = toRouteGeometryClient(route, vehicle?.plate ?? null);
  const completed = route.stops.filter((s) =>
    ['visita_detectada', 'completada'].includes(s.status),
  ).length;

  const position = vehicle ? (positions.get(vehicle.id) ?? null) : null;

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/rutas" className="inline-flex items-center gap-1 hover:text-ink">
            <ArrowLeft className="h-3 w-3" /> Rutas
          </Link>
        }
        title={`${route.code} · ${route.name}`}
        description={`${route.stops.length} paradas · ${formatKm(route.plannedDistanceKm)} planificados · ${formatSmartDateTime(route.date)}`}
        actions={
          <div className="flex flex-wrap items-start justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<MapPin className="h-3.5 w-3.5" />}
              onClick={() => {
                highlightRoute(route.id);
                const first = route.plannedPath[0];
                if (first) focusOn(first, 12);
                router.push('/mapa');
              }}
            >
              Ver en mapa operacional
            </Button>
            <FeatureGate featureId="driver-portal">
              <DriverLinkAction routeId={route.id} />
            </FeatureGate>
          </div>
        }
      />

      <div className="space-y-4">
        <Card>
          <CardBody className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Camion" value={vehicle?.plate ?? 'Sin asignar'} tone="brand" />
            <Stat label="Conductor" value={driver?.fullName ?? 'Sin conductor'} />
            <Stat label="Inicio" value={formatTime(route.startedAt)} />
            <Stat label="Entregas" value={`${completed} / ${route.stops.length}`} tone="active" />
            <Stat label="Distancia" value={formatKm(route.plannedDistanceKm)} />
          </CardBody>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <Card className="overflow-hidden">
            <CardHeader
              title="Corredor de la ruta"
              description="Planificada, ejecutada y paradas numeradas"
            />
            <div className="relative h-[380px] sm:h-[480px]">
              <ErrorBoundary section="el mapa de la ruta">
                <FleetMap
                  className="absolute inset-0"
                    layerOverride={{ rutas: true, camiones: true, clientes: false, geocercas: false, calor: false, pedidos: false, alertas: false, comunas: false }}
                  vehicles={
                    vehicle
                      ? [
                          {
                            vehicleId: vehicle.id,
                            plate: vehicle.plate,
                            fleetCode: vehicle.fleetCode,
                            status: position && position.speed > 3 ? 'moving' : 'stopped',
                            position,
                          },
                        ]
                      : []
                  }
                  clients={[]}
                  routes={[geometry]}
                  geofences={[]}
                  alerts={[]}
                  workOrders={[]}
                  communes={[]}
                  heatmapPoints={[]}
                />
              </ErrorBoundary>
            </div>
            <CardBody className="flex flex-wrap items-center gap-4 border-t border-line text-2xs text-ink-faint">
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-5 rounded bg-brand-300/70" style={{ borderTop: '2px dashed' }} />
                Ruta planificada
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-5 rounded bg-status-moving" />
                Ruta ejecutada
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-status-active" />
                Parada visitada
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-status-warning" />
                Proxima parada
              </span>
            </CardBody>
          </Card>

          <FeatureGate featureId="route-replay">
            <RouteReplay route={route} vehicle={vehicle} />
          </FeatureGate>

          <div className="space-y-4">
            <Card>
              <CardHeader title="Avance de entregas" />
              <CardBody>
                <RouteProgress completed={completed} total={route.stops.length} />
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Paradas"
                description="Secuencia planificada y estado real"
                icon={<Truck className="h-4 w-4" />}
              />
              <CardBody className="p-0">
                <ol className="divide-y divide-line">
                  {route.stops.map((stop) => {
                    const visited = ['visita_detectada', 'completada'].includes(stop.status);
                    const isNext = stop.status === 'proxima' || stop.status === 'en_cliente';

                    return (
                      <li key={stop.workOrderId}>
                        <Link
                          prefetch={false}
                          href={`/ordenes/${stop.workOrderId}`}
                          className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-800"
                        >
                          <span
                            className={
                              visited
                                ? 'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-status-active/20 text-[11px] font-semibold text-status-active'
                                : isNext
                                  ? 'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-status-warning/20 text-[11px] font-semibold text-status-warning'
                                  : 'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line text-[11px] text-ink-faint'
                            }
                          >
                            {visited ? '✓' : stop.sequence}
                          </span>

                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] text-ink">{stop.clientName}</p>
                            <p className="truncate text-2xs text-ink-faint">
                              {stop.addressLine}, {stop.communeName}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <WorkOrderStatusBadge status={stop.status} />
                              <span className="numeric text-2xs text-ink-faint">
                                {visited
                                  ? `Llegada ${formatTime(stop.actualArrivalAt)}`
                                  : `Prevista ${formatTime(stop.plannedArrivalAt)}`}
                              </span>
                            </div>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Zona autorizada" description="Comunas que la ruta puede recorrer" />
              <CardBody>
                <DetailList
                  columns={1}
                  items={[
                    {
                      label: 'Comunas autorizadas',
                      value: route.authorizedCommuneCodes.length,
                    },
                    {
                      label: 'Control por comuna',
                      value:
                        'Si el vehiculo permanece fuera de estas comunas mas alla de la tolerancia configurada, se genera una alerta automatica.',
                    },
                  ]}
                />
              </CardBody>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
