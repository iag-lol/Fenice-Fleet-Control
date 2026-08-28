'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Fuel,
  MapPin,
  Maximize2,
  Minimize2,
  Navigation,
  Route as RouteIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { DetailList } from '@/components/common/detail-list';
import { Stat } from '@/components/common/kpi';
import { PageHeader } from '@/components/common/page-header';
import { RouteProgress } from '@/components/common/progress';
import {
  ConnectionBadge,
  DeliveryConfirmationBadge,
  VehicleStatusBadge,
  WorkOrderStatusBadge,
} from '@/components/common/status';
import { Timeline } from '@/components/common/timeline';
import { FleetMap } from '@/components/map/fleet-map';
import { Button, LinkButton } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { QueryError } from '@/components/ui/query-state';
import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';
import { useLiveFleet } from '@/hooks/use-live-fleet';
import {
  formatCoordinates,
  formatDuration,
  formatElapsed,
  formatEta,
  formatHeading,
  formatKm,
  formatNumber,
  formatSmartDateTime,
  formatSpeed,
  formatTime,
} from '@/lib/format';
import { cn } from '@/lib/cn';
import { VEHICLE_TYPE_LABEL } from '@/lib/fuel-domain';
import { useMapStore } from '@/stores/map-store';
import type { VehicleDetail } from '@/types/views';

/** Ficha completa del vehiculo, con mapa propio, recorrido e historial. */
export function VehicleDetailView({ vehicleId }: { vehicleId: string }) {
  const router = useRouter();
  const { positions } = useLiveFleet();
  const focusOn = useMapStore((s) => s.focusOn);
  const followVehicle = useMapStore((s) => s.followVehicle);
  // El mapa puede ocupar toda la altura util cuando el operador lo necesita.
  const [mapExpanded, setMapExpanded] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['vehicle', vehicleId],
    refetchInterval: 30_000,
    queryFn: async (): Promise<VehicleDetail> => {
      const response = await fetch(`/api/fleet/${vehicleId}`);
      if (response.status === 404) throw new Error('El vehiculo solicitado no existe.');
      if (!response.ok) throw new Error('No fue posible obtener el detalle del vehiculo.');
      return (await response.json()) as VehicleDetail;
    },
  });

  if (isError) {
    return (
      <>
        <PageHeader
          title="Detalle de vehiculo"
          breadcrumb={
            <Link href="/flota" className="inline-flex items-center gap-1 hover:text-ink">
              <ArrowLeft className="h-3 w-3" /> Volver a flota
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
        <PageHeader title="Detalle de vehiculo" />
        <div className="space-y-4">
          <Skeleton className="h-64 w-full" />
          <SkeletonRows rows={6} />
        </div>
      </>
    );
  }

  const { vehicle, driver, snapshot, route, journey, eta, currentWorkOrder, nextWorkOrder } = data;
  const position = positions.get(vehicleId) ?? snapshot.position;

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/flota" className="inline-flex items-center gap-1 hover:text-ink">
            <ArrowLeft className="h-3 w-3" /> Flota
          </Link>
        }
        title={`${vehicle.plate} · ${vehicle.fleetCode}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5">
              <Fuel className="h-3.5 w-3.5 text-ink-faint" />
              {VEHICLE_TYPE_LABEL[vehicle.type]} · {vehicle.brand} {vehicle.model} {vehicle.year}
            </span>
            <span className="text-ink-faint">{vehicle.depotName}</span>
            <VehicleStatusBadge status={snapshot.status} />
            {snapshot.device ? <ConnectionBadge state={snapshot.device.connection} /> : null}
          </span>
        }
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={<Navigation className="h-3.5 w-3.5" />}
              disabled={!position}
              onClick={() => {
                followVehicle(vehicleId);
                router.push('/control');
              }}
            >
              Seguir en el mapa
            </Button>

            {route ? (
              <LinkButton
                href={`/rutas/${route.routeId}`}
                variant="secondary"
                size="sm"
                icon={<RouteIcon className="h-3.5 w-3.5" />}
              >
                Ver ruta {route.code}
              </LinkButton>
            ) : null}
          </>
        }
      />

      <div className="space-y-4">
        {/* --- Cifras de la jornada --- */}
        <Card>
          <CardBody className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
            <Stat label="Velocidad" value={formatSpeed(position?.speed ?? null)} tone="brand" />
            <Stat
              label="Capacidad estanque"
              value={`${formatNumber(vehicle.capacityLiters)} L`}
            />
            <Stat label="Compartimentos" value={String(vehicle.compartments)} />
            <Stat label="Kilometros" value={formatKm(journey.distanceKm)} />
            <Stat label="En movimiento" value={formatDuration(journey.movingSeconds)} />
            <Stat
              label="Entregas"
              value={`${journey.deliveriesCompleted} / ${journey.deliveriesCompleted + journey.deliveriesPending}`}
              tone="active"
            />
            <Stat
              label="Ultima posicion"
              value={formatElapsed(snapshot.device?.secondsSinceLastPosition ?? null)}
            />
          </CardBody>
        </Card>

        {/* --- Mapa: es lo primero que mira el operador, ocupa la pantalla --- */}
        <Card className="overflow-hidden">
          <CardHeader
            title="Posicion y recorrido"
            description={
              journey.communeName ? `Comuna aproximada: ${journey.communeName}` : 'Comuna sin determinar'
            }
            icon={<MapPin className="h-4 w-4" />}
            action={
              <Button
                size="sm"
                variant="ghost"
                icon={mapExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                onClick={() => setMapExpanded((value) => !value)}
              >
                {mapExpanded ? 'Reducir' : 'Ampliar'}
              </Button>
            }
          />
          <div
            className={cn(
              'relative transition-[height] duration-200',
              mapExpanded ? 'h-[calc(var(--app-vh)-9rem)]' : 'h-[420px] sm:h-[560px]',
            )}
          >
              <ErrorBoundary section="el mapa del vehiculo">
                <FleetMap
                  className="absolute inset-0"
                  autoFit
                    layerOverride={{ camiones: true, rutas: true, clientes: false, geocercas: false, calor: false, pedidos: false, alertas: false, comunas: false }}
                  minimalControls={false}
                  vehicles={[
                    {
                      vehicleId,
                      plate: vehicle.plate,
                      fleetCode: vehicle.fleetCode,
                      status: snapshot.activityStatus,
                      position,
                    },
                  ]}
                  clients={[]}
                  routes={route ? [route] : []}
                  geofences={[]}
                  alerts={[]}
                  workOrders={[]}
                  communes={[]}
                  heatmapPoints={[]}
                />
            </ErrorBoundary>
          </div>
        </Card>

        <div className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-4">
            {/* --- Telemetria --- */}
            <Card>
              <CardHeader title="Telemetria" description="Ultimo reporte del equipo" />
              <CardBody>
                <DetailList
                  items={[
                    { label: 'Ignicion', value: position?.ignition === 'on' ? 'Encendida' : position?.ignition === 'off' ? 'Apagada' : 'Sin dato' },
                    { label: 'Rumbo', value: formatHeading(position?.heading) },
                    {
                      label: 'Odometro',
                      value: position?.odometerKm ? `${formatNumber(position.odometerKm)} km` : 'Sin dato',
                    },
                    { label: 'Precision', value: position?.accuracy ? `${position.accuracy} m` : 'Sin dato' },
                    {
                      label: 'Coordenadas',
                      value: position ? (
                        <span className="numeric text-xs">
                          {formatCoordinates(position.lat, position.lng)}
                        </span>
                      ) : (
                        'Sin posicion'
                      ),
                      full: true,
                    },
                    {
                      label: 'Ultimo reporte',
                      value: formatSmartDateTime(position?.timestamp ?? null),
                      full: true,
                    },
                  ]}
                />
              </CardBody>
            </Card>

            {/* --- Asignacion --- */}
            <Card>
              <CardHeader title="Asignacion" description="Conductor y orden en curso" />
              <CardBody className="space-y-3">
                <DetailList
                  columns={1}
                  items={[
                    { label: 'Conductor', value: driver?.fullName ?? 'Sin conductor asignado' },
                    { label: 'Documento', value: driver ? <span className="numeric">{driver.documentId}</span> : '--' },
                    { label: 'Telefono', value: driver ? <span className="numeric">{driver.phone}</span> : '--' },
                    { label: 'Licencia', value: driver ? `Clase ${driver.licenseClass}` : '--' },
                  ]}
                />

                {currentWorkOrder ?? nextWorkOrder ? (
                  <div className="rounded-md border border-line bg-surface-800 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-2xs uppercase tracking-wider text-ink-faint">
                          {currentWorkOrder ? 'Orden en curso' : 'Proxima orden'}
                        </p>
                        <Link
                          prefetch={false}
                          href={`/ordenes/${(currentWorkOrder ?? nextWorkOrder)!.id}`}
                          className="numeric mt-0.5 flex min-h-11 items-center truncate text-[13px] font-semibold text-brand-700 hover:underline sm:block sm:min-h-0"
                        >
                          {(currentWorkOrder ?? nextWorkOrder)!.number}
                        </Link>
                      </div>
                      <WorkOrderStatusBadge status={(currentWorkOrder ?? nextWorkOrder)!.status} />
                    </div>

                    <p className="mt-1.5 truncate text-[13px] text-ink">
                      {(currentWorkOrder ?? nextWorkOrder)!.clientName}
                    </p>
                    <p className="truncate text-2xs text-ink-faint">
                      {(currentWorkOrder ?? nextWorkOrder)!.addressLine},{' '}
                      {(currentWorkOrder ?? nextWorkOrder)!.communeName}
                    </p>

                    <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-line pt-2">
                      <span className="text-2xs text-ink-faint">
                        Hora prevista{' '}
                        <span className="numeric text-ink">
                          {formatTime((currentWorkOrder ?? nextWorkOrder)!.scheduledWindowStart)}
                        </span>
                      </span>
                      <span className="text-2xs text-ink-faint">
                        ETA <span className="numeric text-brand-700">{formatEta(eta?.minutes ?? null)}</span>
                      </span>
                    </div>

                    <DeliveryConfirmationBadge
                      source={(currentWorkOrder ?? nextWorkOrder)!.deliveryConfirmation}
                    />
                  </div>
                ) : (
                  <p className="rounded-md border border-line bg-surface-800 px-3 py-2.5 text-xs text-ink-faint">
                    Este vehiculo no tiene ordenes de trabajo asignadas para hoy.
                  </p>
                )}
              </CardBody>
            </Card>
          </div>
        </div>

        {/* --- Ruta e historial --- */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Avance de ruta"
              description={route ? `${route.code} · ${route.name}` : 'Sin ruta asignada'}
              icon={<RouteIcon className="h-4 w-4" />}
            />
            <CardBody>
              {route ? (
                <>
                  <RouteProgress
                    completed={data.routeProgress.completedStops}
                    total={data.routeProgress.totalStops}
                  />

                  <ol className="mt-4 space-y-2">
                    {route.stops.map((stop) => {
                      const visited = stop.status === 'visita_detectada' || stop.status === 'completada';
                      const isNext = stop.status === 'proxima' || stop.status === 'en_cliente';

                      return (
                        <li key={stop.workOrderId} className="flex items-start gap-3">
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
                            <Link
                              prefetch={false}
                              href={`/ordenes/${stop.workOrderId}`}
                              className="flex min-h-11 items-center truncate text-[13px] text-ink hover:text-brand-700 sm:block sm:min-h-0"
                            >
                              {stop.clientName}
                            </Link>
                            <p className="truncate text-2xs text-ink-faint">{stop.addressLine}</p>
                          </div>

                          <span className="numeric shrink-0 text-2xs text-ink-faint">
                            {visited
                              ? formatTime(stop.actualArrivalAt)
                              : isNext
                                ? 'Proximo'
                                : formatTime(stop.plannedArrivalAt)}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                </>
              ) : (
                <EmptyState
                  compact
                  icon={<RouteIcon className="h-5 w-5" />}
                  title="Sin ruta planificada"
                  description="Este vehiculo no tiene una ruta asignada para la jornada de hoy."
                />
              )}
            </CardBody>
          </Card>

          <Card id="historial">
            <CardHeader title="Historial de la jornada" description="Eventos de geocerca, detenciones y desvios" />
            <CardBody>
              <Timeline
                entries={data.timeline}
                onFocus={(entry) => {
                  if (entry.position) {
                    focusOn(entry.position, 16);
                    router.push('/control');
                  }
                }}
              />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
